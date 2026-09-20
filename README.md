# Browser Recorder MCP

> **自用项目 / AI 生成警告**
>
> 本项目主要用于个人学习、实验和自用，代码与文档主要由 AI 生成和修改，可能包含错误、遗漏或未经验证的假设。不保证其他平台的兼容性、稳定性或安全性。使用前请自行审查代码并验证运行结果。

浏览器截图、鼠标点击和音视频录制 MCP 工具。容器内常驻 MCP Server，外部 agent 通过 HTTP 连接，首次浏览器操作时才启动 Chrome。录制保持 `tabCapture + MediaRecorder`，输出 WebM。

## Windows 快速使用

复制源码后，在项目根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\environments\wslc\build.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\environments\wslc\run.ps1 -Gpu NVIDIA -Port 3000
```

`-Gpu Intel` 可选择 Intel。容器后台运行，不随 agent 退出而停止。

```powershell
curl.exe http://127.0.0.1:3000/health
```

外部 agent 使用支持 Streamable HTTP 的 MCP 配置，示例如下（字段格式以客户端要求为准）：

```json
{
  "mcpServers": {
    "browser-recorder": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

其他机器上的 agent 将 `127.0.0.1` 替换为 Windows 主机的可达地址。外部 agent 不需要安装 Node、Chrome、FFmpeg 或启动 MCP 进程。服务不做 token 认证；能访问端口的客户端可以建立会话并操作浏览器。`Mcp-Session-Id` 仅用于协议会话路由。

详细构建参数和数据目录见 [Windows wslc 部署说明](environments/wslc/README.md)。

## 服务与会话

- `GET /health`：返回服务状态、是否有活动会话、Chrome 是否已启动；不占用会话，不启动 Chrome。
- `/mcp`：Streamable HTTP MCP 接口，支持 SDK 的 POST、GET/SSE、DELETE 会话流程。不是旧式 `/sse` 接口。
- 同时只允许一个活动会话；第二个初始化请求返回 HTTP 409，避免两个 agent 同时操作。
- 客户端通过 `DELETE /mcp` 结束会话后，服务关闭该会话的浏览器并释放占用；录制会先停止保存。
- 客户端直接断网不会立刻释放会话。默认无请求 30 分钟后回收；执行中的工具和录制不会被空闲回收中断。`/health` 请求不延长会话。
- 容器正常停止时会等待当前工具和录像清理。容器保持运行时，新客户端可以建立新的独立会话。

传输使用仓库锁定的 MCP TypeScript SDK 1.30.0，采用 initialize + session 的 Streamable HTTP 流程（[2025-11-25 协议](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)）。客户端需支持这一流程；没有实现仅支持 2026-07-28 无会话协议的新传输形态。

## 工具

| 工具 | 用途 |
| --- | --- |
| browser_open | 打开 HTTP(S) 网页 |
| browser_status | 当前网址、标题、尺寸及录制状态；需要时启动 Chrome |
| browser_screenshot | 返回 1280×720 PNG 供模型观察 |
| browser_click | 点击 x/y，默认返回更新后的截图 |
| recording_start | 开始录制；默认 30 fps 上限、6 Mbps、最长 300 秒 |
| recording_status | 查询状态、分片数及输出信息；不启动 Chrome |
| recording_stop | 传入 recordingId，等待上传、整理封装并验证音视频流 |

坐标原点在左上角，设备缩放为 1。录制中可以点击，切换网址前需要停止录制。最长录制时间可设为 1～600 秒。

输出保存在服务端：`<id>.webm`、`<id>.json` 和原始 `<id>.raw.webm`。容器的 `/data` 映射到 Windows 的录像目录。HTTP MCP 当前不提供录像文件下载接口。

## 配置

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| MCP_HOST | `0.0.0.0`；HTTP 监听地址 |
| MCP_PORT | `3000`；HTTP 监听端口 |
| MCP_SESSION_IDLE_SECONDS | `1800`；空闲会话回收时间，必须大于 0 |
| CHROME_PATH | 可选；Chrome 可执行文件路径，未设置时查找系统 Chrome stable |
| CHROME_ARGS | `[]`；额外启动参数的 JSON 字符串数组 |
| GAME_DATA_DIR | 项目内 `artifacts/recordings`；容器默认 `/data` |
| FFMPEG_PATH / FFPROBE_PATH | `ffmpeg` / `ffprobe`；可指定完整路径 |

工具代码位于 `src/`，录制扩展位于 `extension/`，Windows 的 GPU/显示配置位于 `environments/wslc/`。独立运行工具需要 Node 22.12+、Chrome、FFmpeg，以及适当的显示环境。启动命令 `npm start` 默认运行 HTTP 服务。

Chrome 使用独立临时 profile，由服务启动和关闭，不接管日常浏览器。通用工具不硬编码 GPU 后端；wslc 镜像设置 D3D12 和 Weston。原始录制分片通过独立的容器内回环服务上传，不对外开放该内部端口。

## 端到端测试

测试逻辑位于 [test/e2e.mjs](test/e2e.mjs)，通过 HTTP 连接 MCP 服务，检查以下流程：

1. 确认服务尚未启动 Chrome，再打开模拟游戏页面。
2. 获取 PNG 截图并执行鼠标点击。
3. 启动录制，继续点击，并确认录制中不能切换网址。
4. 停止录制，检查视频时长、1280×720 分辨率及音视频流。
5. 检查重复停止、再次录制和到时自动保存。

[fixtures/click-game.html](fixtures/click-game.html) 是测试素材：包含移动目标、开始按钮、点击计分，以及周期性闪白和提示音。它不是实际游戏，仅在 `GAME_TEST_FIXTURES=1` 时由服务提供访问，正常运行无需开启。

Windows 执行入口为 [test.ps1](environments/wslc/test.ps1)：它启动独立测试容器，由 [smoke.sh](environments/wslc/smoke.sh) 启动 HTTP 服务、启用测试页面，再运行 `test/e2e.mjs`。先构建镜像，然后在项目根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\environments\wslc\test.ps1 -Gpu NVIDIA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\environments\wslc\test.ps1 -Gpu Intel
```

默认产物保存在 `artifacts/wslc-test/`，包含录像、截图、媒体信息和服务日志；可通过 `-DataDir` 指定其他目录。测试结束后会关闭服务并删除测试容器，挂载目录中的产物会保留。

也可以对已启用测试页面的独立 HTTP 服务运行 `E2E_SERVER_URL` 指向该服务的 `npm run test:e2e`。该测试会操作浏览器并录制，应使用没有活动会话、尚未启动 Chrome 的测试服务。它验证基础操作与媒体流，不测量复杂游戏性能或精确音画同步误差。

## 许可证

本项目采用 [MIT License](LICENSE)，按“现状”提供，不作任何担保。第三方依赖、Chrome/Chromium 及容器中各组件仍遵循各自的许可证。
