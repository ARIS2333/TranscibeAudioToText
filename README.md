# Web端语音识别应用

这是一个基于浏览器的语音识别应用，允许用户通过麦克风录音并将语音转换为文字。应用使用讯飞语音识别服务（IAT）实现语音转文字功能。

## 功能特性

- 浏览器端麦克风录音
- 音频格式转换 (WebM to PCM)
- 实时语音识别 (使用讯飞IAT服务)
- 简洁的用户界面

## 系统架构

```
┌─────────────┐    语音输入    ┌──────────────┐    WebM格式    ┌─────────────┐
│             ├───────────────→│              ├───────────────→│             │
│   浏览器    │                │  前端页面    │                │   后端      │
│             │←───────────────┤              │←───────────────┤             │
└─────────────┘    控制指令    └──────────────┘    识别结果    └─────────────┘
                                                       │
                                                       │ PCM格式
                                                       ↓
                                            ┌─────────────────────┐
                                            │  讯飞语音识别服务   │
                                            │     (IAT API)       │
                                            └─────────────────────┘
```

## 快速开始

### 安装步骤

1. 克隆或下载此项目

2. 安装Node.js依赖:

   ```bash
   npm install
   ```

3. 安装ffmpeg:

   - Windows: 从 https://ffmpeg.org/download.html 下载并安装
   - macOS: 使用Homebrew安装 `brew install ffmpeg`
   - Ubuntu/Debian: 运行 `sudo apt update && sudo apt install ffmpeg`

### 配置

在 [sever.js](file:///Users/alice/Downloads/iat_ws_nodejs_demo/sever.js) 文件中更新以下配置信息:

- `appid`: 你的讯飞应用ID
- `apiSecret`: 你的讯飞API密钥
- `apiKey`: 你的讯飞API Key

### 运行应用

```bash
npm start
```

然后在浏览器中打开 `http://localhost:3000`

### 使用方法

1. 点击"开始录音"按钮
2. 允许浏览器访问麦克风
3. 开始说话
4. 再次点击按钮停止录音
5. 等待识别结果在页面上显示

## 工作原理详解

### 1. 浏览器端语音采集

浏览器通过 Web Audio API 和 MediaRecorder API 实现语音采集：

1. 用户点击"开始录音"按钮
2. 浏览器请求麦克风访问权限
3. 使用 `navigator.mediaDevices.getUserMedia()` 获取音频流
4. 使用 `MediaRecorder` 录制音频流，生成 WebM 格式音频文件

相关代码在 [index.html](file:///Users/alice/Downloads/iat_ws_nodejs_demo/index.html) 中：

```javascript
const stream = await navigator.mediaDevices.getUserMedia({ 
    audio: {
        sampleRate: 16000,  // 16kHz采样率
        channelCount: 1,    // 单声道
        echoCancellation: true
    }
});

mediaRecorder = new MediaRecorder(stream);
```

### 2. 音频格式转换

讯飞语音识别服务要求输入为 PCM 格式音频，而浏览器默认生成 WebM 格式，因此需要进行格式转换：

1. 浏览器将 WebM 文件发送到后端
2. 后端使用 FFmpeg 将 WebM 转换为 PCM 格式
   - 采样率: 16kHz
   - 位深度: 16位
   - 声道数: 单声道

相关代码在 [sever.js](file:///Users/alice/Downloads/iat_ws_nodejs_demo/sever.js) 中：

```javascript
const ffmpeg = spawn('ffmpeg', [
  '-y',           // 覆盖输出文件
  '-i', wavFilePath,     // 输入文件
  '-f', 's16le',         // 输出格式: 16位有符号小端PCM
  '-ar', '16000',        // 采样率: 16kHz
  '-ac', '1',            // 声道数: 单声道
  pcmFilePath            // 输出文件
]);
```

### 3. WebSocket连接构建

与讯飞语音识别服务通过WebSocket进行实时通信：

1. 构造带有认证信息的WebSocket URL
2. 建立WebSocket连接
3. 分块发送PCM音频数据
4. 接收并处理识别结果

相关代码在 [sever.js](file:///Users/alice/Downloads/iat_ws_nodejs_demo/sever.js) 中：

```javascript
// 构造WebSocket URL
let wssUrl = config.hostUrl + "?authorization=" + getAuthStr() + "&date=" + date + "&host=" + config.host;

// 建立连接
let ws = new WebSocket(wssUrl);

// 连接建立后的处理
ws.on('open', () => {
  // 开始发送音频数据
});

// 接收识别结果
ws.on('message', (data, err) => {
  // 处理识别结果
});

// 处理连接错误
ws.on('error', (err) => {
  // 错误处理
});
```

### 4. 音频数据传输

音频数据以帧的形式发送到讯飞服务：

1. **首帧**: 包含配置信息和首块音频数据
2. **中间帧**: 仅包含音频数据
3. **末帧**: 标记音频结束

```javascript
let frame = {
  // 首帧包含common和business配置
  common: {
    app_id: config.appid
  },
  business: {
    language: "zh_cn",     // 语言
    domain: "iat",         // 领域
    accent: "mandarin",    // 方言
    dwa: "wpgs"            // 动态修正
  },
  // 所有帧都包含data部分
  data: {
    "status": status,           // 帧状态
    "format": "audio/L16;rate=16000", // 音频格式
    "audio": data.toString('base64'), // 音频数据(base64编码)
    "encoding": "raw"           // 编码格式
  }
};
```

### 5. 语音识别API使用

讯飞语音识别服务返回流式识别结果：

1. 中间结果：随着音频输入逐步返回优化的识别结果
2. 最终结果：当音频结束时返回最终识别结果
3. 动态修正：支持对已识别内容进行修正

相关代码在 [sever.js](file:///Users/alice/Downloads/iat_ws_nodejs_demo/sever.js) 中：

```javascript
// 接收识别结果
ws.on('message', (data, err) => {
  let res = JSON.parse(data);
  
  // 处理识别结果
  if (res.code != 0) {
    // 错误处理
    return;
  }
  
  // 构建识别结果字符串
  let str = "";
  iatResult[res.data.result.sn] = res.data.result;
  
  // 如果是最终结果
  if (res.data.status == 2) {
    // 处理最终结果
  }
});
```

## 文件说明

### 核心文件

- **[index.html](file:///Users/alice/Downloads/iat_ws_nodejs_demo/index.html)**: 前端用户界面，实现录音功能
- **[sever.js](file:///Users/alice/Downloads/iat_ws_nodejs_demo/sever.js)**: 后端服务器，处理录音文件并调用语音识别
- **[package.json](file:///Users/alice/Downloads/iat_ws_nodejs_demo/package.json)**: 项目配置和依赖管理

### 详细文件功能

#### index.html

- 提供录音按钮和结果显示区域
- 使用 MediaRecorder API 进行录音
- 将录音文件通过 HTTP POST 发送到后端

#### sever.js

- 使用 Express.js 搭建Web服务器
- 接收前端上传的音频文件
- 使用 FFmpeg 进行音频格式转换
- 通过 WebSocket 连接讯飞语音识别服务
- 处理识别结果并返回给前端

## 系统要求

- Node.js (版本 14.x 或更高)
- ffmpeg (用于音频格式转换)
- 现代浏览器 (支持getUserMedia API)

## 技术细节

### 认证机制

讯飞服务使用 HMAC-SHA256 签名进行认证：

```javascript
function getAuthStr(date) {
  let signatureOrigin = `host: ${config.host}\ndate: ${date}\nGET ${config.uri} HTTP/1.1`;
  let signatureSha = CryptoJS.HmacSHA256(signatureOrigin, config.apiSecret);
  let signature = CryptoJS.enc.Base64.stringify(signatureSha);
  let authorizationOrigin = `api_key="${config.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  let authStr = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(authorizationOrigin));
  return authStr;
}
```

## 注意事项

- 需要有效的讯飞API凭证
- 由于浏览器安全限制，应用必须通过HTTPS或localhost访问才能使用麦克风
- 音频识别的准确性取决于录音质量和环境噪音
- FFmpeg 必须正确安装并可在命令行中访问