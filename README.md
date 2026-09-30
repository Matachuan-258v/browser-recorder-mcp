# Browser Recorder MCP

> **自用项目 / AI 生成警告**
>
> 本项目主要用于个人学习、实验和自用，代码与文档主要由 AI 生成和修改，可能包含错误、遗漏或未经验证的假设。不保证其他平台的兼容性、稳定性或安全性。使用前请自行审查代码并验证运行结果。

基于 Chrome DevTools MCP 的浏览器操作与录制服务。外部 agent 通过带 token 认证的 HTTP 入口连接：浏览器工具交给 `chrome-devtools-mcp`，本项目只补充标签页音视频录制。Chrome 的启动、重连、临时 profile 和关闭均由 DevTools 管理；初始化、列工具和健康检查不会启动 Chrome。

## Windows 用户：推荐 WSL

建议在 WSL 2 的 Linux 环境中运行服务，使用 WSLg 提供 Chrome 所需的图形环境。在 WSL 内准备 Linux 版 Node 22.12+、Chrome/Chromium 和 FFmpeg（含 ffprobe），将源码放在 Linux 文件系统中，然后在项目根目录执行：

```bash
npm ci
# 使用 Chromium 或非默认安装位置时，设置 CHROME_PATH 为 Linux 可执行文件路径。
npm start
```

首次启动自动生成 token，保存在项目根目录 `.env`。服务启动后，在另一个 WSL 终端中读取其中的 `MCP_TOKEN` 值并设置同名 shell 变量，用于健康检查和客户端配置：

```bash
curl -H "Authorization: Bearer $MCP_TOKEN" http://127.0.0.1:3000/health
```

本项目不再提供 Windows PowerShell 包装脚本。已有 wslc 环境仍可使用保留的镜像、D3D12 GPU 配置和手动命令，见 [wslc 部署说明](environments/wslc/README.md)。下方原生 Linux NVIDIA 容器使用另一套 GPU 配置，不应直接视作 WSL 部署步骤。

## 连接客户端

外部 agent 使用支持 Streamable HTTP 的 MCP 配置，示例如下（字段格式以客户端要求为准）：

```json
{
  "mcpServers": {
    "browser-recorder": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer REPLACE_WITH_YOUR_MCP_TOKEN" }
    }
  }
}
```

其他机器上的 agent 将 `127.0.0.1` 替换为服务的可达地址；WSL 的远程访问还需按实际网络环境配置。也可使用下文的 hostc 隧道。外部 agent 不需要安装 Node、Chrome、FFmpeg 或启动 MCP 进程。服务要求 `Authorization: Bearer <MCP_TOKEN>`；将示例中的占位符替换为服务端配置的 token。`Mcp-Session-Id` 仅用于协议会话路由。

## 原生 Linux + NVIDIA

在装有 NVIDIA 专有驱动和 NVIDIA Container Toolkit 的 Linux 主机上：

```bash
./environments/linux-nvidia/build.sh
GPU=0 PORT=3000 ./environments/linux-nvidia/run.sh
```

与 wslc 的 GPU 接入方式不同（CDI 设备直通而非 WSL 的 D3D12），工具代码和录制扩展完全共用。
详见 [原生 Linux NVIDIA 部署说明](environments/linux-nvidia/README.md)。

## GHCR 镜像与自动发布

[镜像工作流](.github/workflows/images.yml) 先使用 Node 22.14.0 运行 `npm test`，通过后分别构建 `linux-nvidia` 和 `wslc` 两个 `linux/amd64` 镜像，发布到 `ghcr.io/matachuan-258v/browser-recorder-mcp`。PR 只测试和构建，不发布。普通 GitHub runner 不提供 NVIDIA/WSL GPU，工作流不运行 GPU 端到端测试。

| 触发方式 | 发布标签示例 |
| --- | --- |
| 推送到 `main` | `linux-nvidia`、`wslc`，以及 `sha-<完整提交 SHA>-<环境>` |
| 推送 `v*` Git 标签，如 `v0.1.0` | `v0.1.0-linux-nvidia`、`v0.1.0-wslc`，以及对应 SHA 标签 |
| Actions 页面手动运行 | 选择 `main` 或 `v*` 标签时发布；其他分支只构建 |

两个环境使用各自的标签，不设置通用 `latest`。版本标签不更新 `main` 对应的环境标签；需要固定部署版本时使用版本标签或镜像 digest。每次发布的完整镜像名和 digest 会显示在 Actions 运行摘要中。

原生 Linux NVIDIA 用户可以直接拉取预构建镜像，再通过现有启动脚本运行：

```bash
docker pull ghcr.io/matachuan-258v/browser-recorder-mcp:linux-nvidia
IMAGE=ghcr.io/matachuan-258v/browser-recorder-mcp:linux-nvidia GPU=0 PORT=3000 ./environments/linux-nvidia/run.sh
```

wslc 用户将手动部署命令中的镜像名替换为 `ghcr.io/matachuan-258v/browser-recorder-mcp:wslc`，见[部署说明](environments/wslc/README.md)。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，只在镜像构建任务授予 `packages: write`，无需额外配置 PAT 或仓库 secret。CI 为 wslc 覆盖基础镜像、apt 和 npm 的镜像源，使用官方源；本地构建的默认镜像源仍按 Dockerfile 配置。镜像带有源码仓库和提交的 OCI 标签，以关联 GitHub Package 与仓库。

GHCR 新建 Package 默认私有；需要匿名拉取时，仓库 owner 在该 Package 的 Settings 中将可见性设为 Public。私有镜像需先登录 GHCR，使用有 `read:packages` 权限的 PAT classic。发布权限与可见性规则参见 [GitHub Container registry 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

## Docker Compose

[compose.yaml](compose.yaml) 面向原生 Linux NVIDIA 主机，使用 GHCR 的 `linux-nvidia` 镜像。需要 Docker Compose 2.30+、Docker 的 CDI 支持，以及已配置 NVIDIA CDI 设备的 NVIDIA Container Toolkit；GPU 前提同[原生 Linux 部署说明](environments/linux-nvidia/README.md)。wslc 的镜像和手动命令继续保留在其部署目录中。

在项目根目录执行（私有 GHCR Package 需先登录）：

```bash
docker compose pull
docker compose up -d --wait
docker compose logs -f browser-recorder
```

默认仅将端口映射到宿主机 `127.0.0.1:3000`；客户端 URL 为 `http://127.0.0.1:3000/mcp`。录像和自动生成的 token 保存在宿主机 `artifacts/recordings/`，重建容器或执行 `docker compose down` 后仍保留。首次启动后读取该目录 `.env` 中的 `MCP_TOKEN` 配置客户端；容器写出的文件权限为 `0600`，需要宿主机相应读取权限。健康检查从显式环境变量或 `/data/.env` 读取 token，并访问受认证保护的 `/health`，不会启动 Chrome。

参数可以通过 shell 环境变量或项目根目录 `.env` 设置；根目录 `.env` 用于 Compose 配置，自动生成的服务 token 写入挂载目录下的 `.env`。

| 参数 | 默认值 / 用途 |
| --- | --- |
| `IMAGE` | `ghcr.io/matachuan-258v/browser-recorder-mcp:linux-nvidia`；可换成实际发布的版本标签或 digest |
| `GPU` | `0`；NVIDIA CDI 设备编号，也可设为 `all` |
| `MCP_BIND_ADDRESS` | `127.0.0.1`；设为 `0.0.0.0` 可监听宿主机所有 IPv4 接口 |
| `MCP_PORT` | `3000`；宿主机端口，容器内部保持 `3000` |
| `DATA_DIR` | `./artifacts/recordings`；宿主机持久化目录 |
| `MCP_TOKEN` | 留空时由服务自动生成并持久化，也可显式指定 |
| `MCP_HOSTC` | `0`；设为 `1` 启用 hostc 公网隧道，从 Compose 日志读取地址 |
| `MCP_SESSION_IDLE_SECONDS` | `1800`；会话空闲回收时间 |

例如选择 GPU、修改端口和启用 hostc：

```bash
GPU=1 MCP_PORT=3001 MCP_HOSTC=1 docker compose up -d --wait
```

更新镜像、停止或删除容器：

```bash
docker compose pull
docker compose up -d --wait
docker compose stop
docker compose down
```

服务退出时按 `unless-stopped` 策略重启；正常停止最多等待 3 分钟，让执行中的工具和录制完成清理。使用 `docker compose -p <项目名>` 和不同的端口、数据目录可运行多个独立实例。

需要从本地源码构建时叠加 [compose.build.yaml](compose.build.yaml)：

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build --wait
```

本地构建默认镜像名为 `game-browser-mcp:linux-nvidia`，可用 `IMAGE` 和 `BASE_IMAGE` 覆盖镜像名与基础镜像。之后管理该实例时使用相同的两个 `-f` 参数。

## Token 与 hostc.dev

直接启动即可：服务自动加载 `.env`，优先使用非空环境变量 `MCP_TOKEN`，其次使用文件中的值。两者均未配置或为空时，生成 32 字节随机 token，以 64 字符十六进制文本写入 `.env`，后续启动自动复用。已有的其他配置和注释会保留；新写入文件在 POSIX 系统上的权限为 `0600`。文件无法保存时拒绝启动，显式配置但格式不合法的 token 也会报错。

- 本机运行：默认保存在项目根目录 `.env`，与启动命令所在目录无关。
- 容器运行：保存在 `/data/.env`，即宿主机挂载的录像目录下；默认是 `artifacts/recordings/.env`。重建容器时保留该目录即可复用 token。
- 可通过 `MCP_ENV_FILE` 指定其他路径。环境变量优先于 `.env` 中的配置；显式传入的 token 不会自动写入文件。

启动日志会提示新生成 token 的保存路径，不输出 token 内容。请从文件读取 `MCP_TOKEN` 值用于客户端的 Authorization 请求头；`.env` 已被 Git 和镜像构建排除。也可以自行指定 token：

```bash
export MCP_TOKEN="$(openssl rand -hex 32)"
```

启用隧道（未配置 token 时也会自动生成并保存）：

```bash
# 原生 Linux 容器
MCP_HOSTC=1 ./environments/linux-nvidia/run.sh
# 或本机 Node 服务
MCP_HOSTC=1 npm start
```

wslc 容器在手动 `wslc run` 命令中添加 `-e MCP_HOSTC=1`，详见其部署说明。

从 `docker logs -f browser-recorder-mcp`、`wslc logs -f browser-recorder-mcp` 或本机服务输出读取 hostc 实际打印的 HTTPS 地址，在其末尾加 `/mcp` 作为客户端 URL；仍须配置上述 Authorization 请求头。`/health` 同样要求 token。公网连接使用 HTTPS，token 不要放进 URL。

服务在 HTTP 监听成功后运行 `npx --yes hostc@latest`，需要能访问 npm 和 hostc。容器内已包含 Node/npm，宿主机无需安装 hostc。按 [hostc 官方说明](https://hostc.dev/llms.txt)，不把 hostc 固定为项目依赖；短暂断网由 hostc 自动重连，离线过久可能更换地址，应以日志为准。停止服务会关闭隧道；hostc 进程意外退出则关闭 MCP 服务并以非零状态退出。重新启动隧道会生成新地址。

## 服务与会话

- `/health` 和 `/mcp` 的所有请求均须携带 Bearer token；缺失或错误返回 HTTP 401，token 不接受 URL 查询参数。
- `GET /health`：返回服务状态、是否有活动会话、Chrome 是否已启动；不占用会话，不启动 Chrome。
- `/mcp`：Streamable HTTP MCP 接口，支持 SDK 的 POST、GET/SSE、DELETE 会话流程。不是旧式 `/sse` 接口。
- 同时只允许一个活动会话；第二个初始化请求返回 HTTP 409，避免两个 agent 同时操作。
- 客户端通过 `DELETE /mcp` 结束会话后，服务先等待工具和录制保存，再由 DevTools 关闭该会话的 Chrome 并释放占用。
- 客户端直接断网不会立刻释放会话。默认无请求 30 分钟后回收；执行中的工具和录制不会被空闲回收中断。`/health` 请求不延长会话。
- 容器正常停止时会等待当前工具和录像清理。容器保持运行时，新客户端可以建立新的独立会话。

传输使用仓库锁定的 MCP TypeScript SDK 1.30.0，采用 initialize + session 的 Streamable HTTP 流程（[2025-11-25 协议](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)）。客户端需支持这一流程；没有实现仅支持 2026-07-28 无会话协议的新传输形态。

## 架构与工具

```mermaid
flowchart LR
  A[Agent] --> H[HTTP MCP：token 认证 / 会话 / 工具队列]
  H --> R[recording_*：标签页音视频录制]
  H --> D[Chrome DevTools MCP：工具与生命周期]
  D --> C[Chrome：独立临时 profile]
  R --> C
```

依赖锁定为 `chrome-devtools-mcp@1.10.1`。通过 SDK 内存传输连接官方 MCP 服务，按工具名转发请求；没有额外 HTTP 端口或第二个浏览器。官方 `BrowserManager` 是 Chrome 的唯一管理者，录制模块借用其浏览器对象，不调用 Chrome 的 launch、close 或 disconnect。此集成使用上游包内的 `BrowserManager` API，升级依赖时需重新验证兼容性。

**全量开放上游公开工具分类，不设置工具白名单。** 当前为 58 个 DevTools 工具，加上 3 个本地录制工具。工具名称、参数定义、图片、结构化结果及工具错误按上游协议传递；完整列表以 `tools/list` 为准。已开启公开的扩展、PWA、第三方工具、WebMCP、内存调试、坐标点击和 screencast 能力，不使用 slim 模式；隐藏的上游内部开发接口不属于此支持范围。

| 分类 | 示例工具 / 能力 |
| --- | --- |
| 页面管理 | `list_pages`、`new_page`、`navigate_page`、`select_page`、`close_page` |
| 输入与等待 | `click`、`click_at`、`drag`、`hover`、`fill`、`fill_form`、`press_key`、`type_text`、`handle_dialog`、`upload_file`、`wait_for` |
| 观察与脚本 | `take_screenshot`、`take_snapshot`、`evaluate_script`、控制台、CSS、网络请求 |
| 页面环境 | `emulate`、`resize_page` |
| 性能与内存 | 性能 trace、Lighthouse、堆快照及分析 |
| 扩展与应用 | 扩展安装/卸载/重载/触发、PWA 安装/启动/卸载/状态 |
| 页面提供的工具 | 第三方开发工具、WebMCP 工具 |
| 官方纯视频录制 | `screencast_start`、`screencast_stop` |
| 本地音视频录制 | `recording_start`、`recording_status`、`recording_stop` |

上游工具参数参见 [DevTools 工具文档](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)。部分能力依赖 Chrome 版本和页面支持，开放工具不代表所有页面均可使用。容器中的 Chrome 153 满足 WebMCP 的版本要求，并传入 `--enable-features=WebMCP`。网络工具和脚本可以读取页面数据；**持有 MCP token 的客户端获得这些完整能力**，token 不区分只读与写入权限。

旧的 `browser_open/status/screenshot/click` 已移除。客户端改用上游 `list_pages`、`navigate_page`、`take_screenshot`、`click_at` 等工具；`click` 使用快照元素 UID，`click_at` 使用截图坐标。浏览器初始尺寸为 1280×720、设备缩放为 1，可通过上游工具调整。

## 两种录制与冲突处理

| | `recording_*` | `screencast_*` |
| --- | --- | --- |
| 实现 | 本项目的 tabCapture + MediaRecorder 扩展 | 官方 Puppeteer screencast + FFmpeg |
| 内容 | 标签页视频和音频 | 纯视频，无音轨 |
| 格式 | WebM，停止后无损整理封装并校验音视频 | MP4 / WebM |
| 参数 | `pageId`；可选 `fps`、`bitrate`、`maxSeconds` | `pageId`；可选服务端 `filePath` |
| 停止 | `recording_stop({recordingId})` | `screencast_stop({pageId})`，与启动时相同的 ID |
| 自动结束 | 默认 300 秒，支持 1～600 秒 | 需显式停止或结束 MCP 会话 |

先通过 `list_pages` 获取页面 ID，再传入 `recording_start`。音视频录制固定绑定该页面，不依赖当前选中标签页或 URL，两个同网址标签页也能区分。音视频录制限 HTTP(S) 页面和默认浏览器上下文；DevTools 创建的 `isolatedContext` 页面可使用官方纯视频录制。

录制规则适用于同一 MCP 会话：

- 所有客户端工具调用串行执行，两种录制互斥；同时只能录制一个页面。两种录制都会阻止空闲会话回收。
- 录制期间可以继续截图、点击、输入、查看信息和选择其他页面。对其他页面的导航等操作仍可使用。
- 对正在录制的页面，拒绝显式导航、关闭、调整尺寸、环境模拟、脚本执行，以及会重载页面的性能/Lighthouse 操作。页面提供的可执行第三方/WebMCP 工具也需先停止录制。
- 录制期间拒绝更改扩展和安装/启动/卸载 PWA。本项目使用的录制扩展由 `recording_*` 管理，不能通过扩展工具直接卸载、重载或触发；其他扩展在未录制时可正常管理。
- 点击或页面自身脚本仍可能触发导航，检测到后会安排停止录制。页面被外部关闭/崩溃或浏览器断开时，音视频录制标记为错误并保留已上传的原始分片和错误记录；无法保证崩溃时最后一段媒体完整。
- 官方录制的页面丢失时尝试完成录制并清理状态；无法清理则关闭该 DevTools 会话，需要结束当前 MCP 会话后重新初始化。Chrome 正常断开后的重启由 DevTools 负责；重连后需重新调用 `list_pages`，不能继续使用旧页面 ID。
- 客户端取消已经开始的操作时，队列仍等待该操作完成，防止后续录制与尚未结束的浏览器操作重叠。转发调用超过 120 秒时关闭 DevTools 会话，再次使用需建立新的 MCP 会话。

`recording_status` 查询本地录制状态，并通过 `screencast` 字段显示是否有官方录制占用。音视频默认帧率上限 30 fps、码率 6 Mbps。输出为 `<id>.webm`、`<id>.json` 和 `<id>.raw.webm`。

所有路径均属于**服务端**。上游工具显式读写文件的默认允许根目录为 `GAME_DATA_DIR`（容器为 `/data`），可将上传素材或待安装的扩展放在该目录。官方录制未指定路径时使用上游临时目录；建议指定数据目录中的路径以便保存。HTTP MCP 不提供录像文件下载接口。DevTools 的使用统计与 CrUX 上传在本项目中关闭。

## 配置

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| MCP_TOKEN | 可选；未配置时自动生成并保存到 `.env`；显式设置时至少 32 个 Bearer token 字符 |
| MCP_ENV_FILE | 本机默认项目根目录 `.env`，容器默认 `/data/.env`；配置文件路径 |
| MCP_HOSTC | `0`；设为 `1` 后随服务启动 hostc 公网 HTTPS 隧道 |
| MCP_HOST | `0.0.0.0`；HTTP 监听地址 |
| MCP_PORT | `3000`；HTTP 监听端口 |
| MCP_SESSION_IDLE_SECONDS | `1800`；空闲会话回收时间，必须大于 0 |
| CHROME_PATH | 可选；Chrome 可执行文件路径，未设置时查找系统 Chrome stable |
| CHROME_ARGS | `[]`；额外启动参数的 JSON 字符串数组 |
| GAME_DATA_DIR | 项目内 `artifacts/recordings`；容器默认 `/data` |
| FFMPEG_PATH / FFPROBE_PATH | `ffmpeg` / `ffprobe`；可指定完整路径 |

工具代码位于 `src/`，录制扩展位于 `extension/`，容器的 GPU/显示配置位于 `environments/`（wslc 为 `wslc/`，原生 Linux NVIDIA 为 `linux-nvidia/`）。WSL 内直接运行无需容器配置。独立运行工具需要 Node 22.12+、Chrome、FFmpeg，以及适当的显示环境。启动命令 `npm start` 默认运行 HTTP 服务。

Chrome 使用独立临时 profile，由 DevTools 启动和关闭，不接管日常浏览器。通用工具不硬编码 GPU 后端；wslc 镜像设置 D3D12 和 Weston，linux-nvidia 镜像使用 NVIDIA 原生 EGL 和 Weston。原始录制分片通过独立的容器内回环服务上传，不对外开放该内部端口。

## 端到端测试

测试逻辑位于 [test/e2e.mjs](test/e2e.mjs)，通过 HTTP 连接 MCP 服务，使用真实 DevTools 工具检查以下流程：

1. 确认服务尚未启动 Chrome，再打开模拟游戏页面。
2. 获取 PNG 截图并执行鼠标点击。
3. 启动录制，继续点击，并确认录制中不能切换网址。
4. 停止录制，检查视频时长、1280×720 分辨率及音视频流。
5. 检查重复停止、再次录制和到时自动保存。
6. 使用官方 `screencast_*` 录制纯视频，确认两种录制互斥。

[fixtures/click-game.html](fixtures/click-game.html) 是测试素材：包含移动目标、开始按钮、点击计分，以及周期性闪白和提示音。它不是实际游戏，仅在 `GAME_TEST_FIXTURES=1` 时由服务提供访问，正常运行无需开启。

原生 Linux NVIDIA 环境先构建镜像，然后在项目根目录执行：

```bash
GPU=0 ./environments/linux-nvidia/test.sh
```

默认产物保存在 `artifacts/linux-nvidia-test/`，可通过 `DATA_DIR` 指定其他目录。wslc 环境使用[手动测试命令](environments/wslc/README.md#测试)。两种容器测试均由各自的 `smoke.sh` 启动 HTTP 服务、启用测试页面，再运行 `test/e2e.mjs`；测试结束后关闭服务并删除测试容器，挂载目录中的录像、截图、媒体信息和日志会保留。

也可以对已启用测试页面的独立 HTTP 服务运行 `E2E_SERVER_URL` 指向该服务的 `npm run test:e2e`，同时设置与服务相同的 `MCP_TOKEN`。该测试会操作浏览器并录制，应使用没有活动会话、尚未启动 Chrome 的测试服务。它验证基础操作与媒体流，不测量复杂游戏性能或精确音画同步误差。

## 许可证

本项目采用 [MIT License](LICENSE)，按“现状”提供，不作任何担保。第三方依赖、Chrome/Chromium 及容器中各组件仍遵循各自的许可证。
