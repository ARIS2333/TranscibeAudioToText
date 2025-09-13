const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const CryptoJS = require('crypto-js');
const WebSocket = require('ws');

const app = express();
const upload = multer({ dest: 'uploads/' });

// 系统配置 
const config = {
  // 请求地址
  hostUrl: "wss://iat-api.xfyun.cn/v2/iat",
  host: "iat-api.xfyun.cn",
  //在控制台-我的应用-语音听写（流式版）获取
  appid: "*",
  //在控制台-我的应用-语音听写（流式版）获取
  apiSecret: "*",
  //在控制台-我的应用-语音听写（流式版）获取
  apiKey: "*",
  uri: "/v2/iat"
};

// 帧定义
const FRAME = {
  STATUS_FIRST_FRAME: 0,
  STATUS_CONTINUE_FRAME: 1,
  STATUS_LAST_FRAME: 2
};

app.use(express.static('.'));

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 语音识别接口
app.post('/recognize', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有上传音频文件' });
  }

  console.log('接收到文件:', req.file);

  try {
    // 将WAV文件转换为PCM格式
    const pcmFilePath = await convertWavToPcm(req.file.path);
    console.log('转换后的PCM文件路径:', pcmFilePath);
    
    // 检查PCM文件是否存在且不为空
    if (!fs.existsSync(pcmFilePath)) {
      throw new Error('PCM文件未生成');
    }
    
    const stats = fs.statSync(pcmFilePath);
    if (stats.size === 0) {
      throw new Error('PCM文件为空');
    }
    
    console.log('PCM文件大小:', stats.size, '字节');
    
    // 进行语音识别
    const result = await recognizeSpeech(pcmFilePath);
    
    // 删除临时文件
    try {
      fs.unlinkSync(req.file.path);
      fs.unlinkSync(pcmFilePath);
    } catch (unlinkErr) {
      console.warn('删除临时文件时出错:', unlinkErr.message);
    }
    
    res.json({ text: result });
  } catch (error) {
    console.error('识别过程中出错:', error);
    res.status(500).json({ error: '识别失败: ' + error.message });
  }
});

// 将WAV文件转换为PCM格式
function convertWavToPcm(wavFilePath) {
  return new Promise((resolve, reject) => {
    // 生成PCM文件路径 - 更可靠的路径处理方式
    const wavFileName = path.basename(wavFilePath);
    const pcmFileName = path.parse(wavFileName).name + '.pcm';
    const pcmFilePath = path.join(path.dirname(wavFilePath), pcmFileName);
    
    console.log('开始转换音频格式:', wavFilePath, '->', pcmFilePath);
    
    // 使用ffmpeg将WAV转换为PCM (16kHz, 16位, 单声道)
    const ffmpeg = spawn('ffmpeg', [
      '-y', // 覆盖输出文件
      '-i', wavFilePath,
      '-f', 's16le',     // 16位有符号小端PCM
      '-ar', '16000',    // 16kHz采样率
      '-ac', '1',        // 单声道
      pcmFilePath
    ]);
    
    let stdout = '';
    let stderr = '';
    
    ffmpeg.stdout.on('data', (data) => {
      stdout += data;
    });
    
    ffmpeg.stderr.on('data', (data) => {
      stderr += data;
    });
    
    ffmpeg.on('close', (code) => {
      console.log('FFmpeg退出码:', code);
      console.log('FFmpeg输出:', stderr);
      
      if (code === 0) {
        if (fs.existsSync(pcmFilePath)) {
          resolve(pcmFilePath);
        } else {
          reject(new Error('FFmpeg执行成功但未生成PCM文件'));
        }
      } else {
        reject(new Error('音频转换失败: ' + stderr));
      }
    });
    
    ffmpeg.on('error', (error) => {
      console.error('FFmpeg启动失败:', error);
      reject(new Error('FFmpeg未安装或不可用: ' + error.message));
    });
  });
}

// 语音识别函数
function recognizeSpeech(pcmFilePath) {
  return new Promise((resolve, reject) => {
    console.log('开始语音识别，使用PCM文件:', pcmFilePath);
    
    // 获取当前时间 RFC1123格式
    let date = (new Date().toUTCString());
    
    // 鉴权签名
    function getAuthStr() {
      let signatureOrigin = `host: ${config.host}\ndate: ${date}\nGET ${config.uri} HTTP/1.1`;
      let signatureSha = CryptoJS.HmacSHA256(signatureOrigin, config.apiSecret);
      let signature = CryptoJS.enc.Base64.stringify(signatureSha);
      let authorizationOrigin = `api_key="${config.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
      let authStr = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(authorizationOrigin));
      return authStr;
    }
    
    let wssUrl = config.hostUrl + "?authorization=" + getAuthStr() + "&date=" + date + "&host=" + config.host;
    console.log('连接WebSocket URL:', wssUrl);
    
    let ws = new WebSocket(wssUrl);
    
    // 设置当前临时状态为初始化
    let status = FRAME.STATUS_FIRST_FRAME;
    // 识别结果
    let iatResult = [];
    let finalResult = "";
    let currentSid = "";
    
    // 连接建立完毕，读取数据进行识别
    ws.on('open', () => {
      console.log("WebSocket连接已建立");
      
      // 检查PCM文件是否存在
      if (!fs.existsSync(pcmFilePath)) {
        console.error("PCM文件不存在:", pcmFilePath);
        ws.close();
        reject(new Error("PCM文件不存在"));
        return;
      }
      
      var readerStream = fs.createReadStream(pcmFilePath, {
        highWaterMark: 1280
      });
      
      readerStream.on('data', function (chunk) {
        send(chunk);
      });
      
      readerStream.on('end', function () {
        console.log("音频数据读取完毕");
        status = FRAME.STATUS_LAST_FRAME;
        send("");
      });
      
      readerStream.on('error', function(err) {
        console.error("读取PCM文件时出错:", err);
        ws.close();
        reject(new Error("读取PCM文件时出错: " + err.message));
      });
      
      // 传输数据
      function send(data) {
        let frame = "";
        let frameDataSection = {
          "status": status,
          "format": "audio/L16;rate=16000",
          "audio": data.toString('base64'),
          "encoding": "raw"
        };
        
        switch (status) {
          case FRAME.STATUS_FIRST_FRAME:
            frame = {
              // 填充common
              common: {
                app_id: config.appid
              },
              //填充business
              business: {
                language: "en_us",
                domain: "iat",
                accent: "mandarin",
                dwa: "wpgs" // 可选参数，动态修正
              },
              //填充data
              data: frameDataSection
            };
            status = FRAME.STATUS_CONTINUE_FRAME;
            break;
          case FRAME.STATUS_CONTINUE_FRAME:
          case FRAME.STATUS_LAST_FRAME:
            //填充frame
            frame = {
              data: frameDataSection
            };
            break;
        }
        ws.send(JSON.stringify(frame));
      }
    });
    
    // 得到识别结果后进行处理
    ws.on('message', (data, err) => {
      if (err) {
        console.log(`错误:${err}`);
        return;
      }
      
      let res = JSON.parse(data);
      console.log('收到识别结果:', JSON.stringify(res, null, 2));
      
      if (res.code != 0) {
        console.log(`错误码 ${res.code}, 原因 ${res.message}`);
        ws.close();
        reject(new Error(`识别服务错误: ${res.message}`));
        return;
      }
      
      iatResult[res.data.result.sn] = res.data.result;
      
      if (res.data.result.pgs == 'rpl') {
        res.data.result.rg.forEach(i => {
          iatResult[i] = null;
        });
      }
      
      // 构建结果字符串
      let str = "";
      iatResult.forEach(i => {
        if (i != null) {
          i.ws.forEach(j => {
            j.cw.forEach(k => {
              str += k.w;
            });
          });
        }
      });
      
      console.log('当前识别结果:', str);
      
      // 如果是最终结果
      if (res.data.status == 2) {
        finalResult = str;
        currentSid = res.sid;
        console.log(`最终识别结果: ${finalResult}`);
        ws.close();
      }
    });
    
    // 资源释放
    ws.on('close', () => {
      console.log(`识别完成，sid：${currentSid}`);
      resolve(finalResult);
    });
    
    // 建连错误
    ws.on('error', (err) => {
      console.log("WebSocket连接错误: " + err);
      reject(new Error("WebSocket连接失败: " + err.message));
    });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`在浏览器中打开 http://localhost:${PORT} 来使用语音识别`);
});