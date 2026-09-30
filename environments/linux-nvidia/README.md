# 原生 Linux + NVIDIA HTTP MCP 部署

此目录提供原生 Linux（非 WSL）搭配 NVIDIA 专有驱动的镜像配置，目标平台 linux/amd64。
与 [wslc](../wslc/README.md) 的区别在于 GPU 接入方式：驱动库由容器运行时注入，不使用
WSL 的 `/dev/dxg` 与 Mesa D3D12 后端。

## 前提

- NVIDIA 专有驱动（宿主机 `nvidia-smi` 可用）
- [NVIDIA Container Toolkit](https://github.com/NVIDIA/nvidia-container-toolkit) ≥ 1.12
- Docker ≥ 25（使用 CDI 设备语法）；旧版本改用 `--gpus all`

宿主机无需安装 Node、Chrome 或 FFmpeg。

## 使用 GHCR 镜像

也可以通过项目根目录的 [Docker Compose 配置](../../README.md#docker-compose) 启动，包含 CDI GPU 设备、持久化数据、token 健康检查和停止等待时间：

```bash
docker compose pull
docker compose up -d --wait
```

可直接拉取 GitHub Actions 发布的 amd64 镜像，无需本地构建：

```bash
docker pull ghcr.io/matachuan-258v/browser-recorder-mcp:linux-nvidia
IMAGE=ghcr.io/matachuan-258v/browser-recorder-mcp:linux-nvidia GPU=0 PORT=3000 DATA_DIR=/srv/recordings ./environments/linux-nvidia/run.sh
```

`linux-nvidia` 标签随 `main` 更新；固定版本可使用 `v0.1.0-linux-nvidia` 等实际已发布标签或 digest。私有 Package 需要先登录 GHCR，发布规则和可见性见[项目说明](../../README.md#ghcr-镜像与自动发布)。下文使用本地构建的镜像名，也可通过 `IMAGE` 选择 GHCR 镜像。

## 本地构建

```bash
./environments/linux-nvidia/build.sh
```

等价命令（需在项目根目录执行，Dockerfile 需要项目根作为构建上下文）：

```bash
docker build -f environments/linux-nvidia/Dockerfile -t game-browser-mcp:linux-nvidia .
```

镜像包含 Noto CJK 字体（`fonts-noto-cjk`），支持中文、日文和韩文页面的显示、截图及录制。

固定 Node 24.21.0 和 Chrome 153.0.8010.52-1，Node 校验官方 SHA256 清单。基础镜像
`ubuntu:24.04` 的 tag 和 apt 软件包未完全锁定快照。

## 启动常驻服务

```bash
GPU=0 PORT=3000 DATA_DIR=/srv/recordings ./environments/linux-nvidia/run.sh
```

`GPU` 选择 CDI 设备序号（多卡机器上对应 `nvidia-smi` 的 GPU 编号），默认 0；
`NAME` 默认 browser-recorder-mcp；`IMAGE` 默认 game-browser-mcp:linux-nvidia；
录像目录默认项目的 `artifacts/recordings`。未设置 `MCP_TOKEN` 时，首次启动自动生成并保存到该目录的 `.env`（上例为 `/srv/recordings/.env`）。后续启动复用；也可以通过环境变量显式指定 token。

等价命令：

```bash
docker run -d --name browser-recorder-mcp --device nvidia.com/gpu=0 \
  --shm-size 1g -e MCP_TOKEN -p 3000:3000 -v /srv/recordings:/data game-browser-mcp:linux-nvidia
```

服务启动后，从 `/srv/recordings/.env` 读取 `MCP_TOKEN` 并设置同名 shell 变量，再执行：

```bash
curl -H "Authorization: Bearer $MCP_TOKEN" http://127.0.0.1:3000/health
docker logs browser-recorder-mcp
docker stop browser-recorder-mcp
docker start browser-recorder-mcp
```

重新构建镜像后需要停止并删除旧容器再 run，新镜像不会自动替换已有容器；绑定目录中的录像会保留。

设置 `MCP_HOSTC=1` 后运行 `run.sh` 可同时启动 hostc 隧道；通过 `docker logs -f browser-recorder-mcp` 查看公网地址。公网地址末尾加 `/mcp`，客户端仍需配置 Bearer token。Token 生成和隧道生命周期见[项目说明](../../README.md#token-与-hostcdev)。

## 连接 agent

与 wslc 相同，使用支持 Streamable HTTP 的 MCP 客户端：

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

服务要求 `Authorization: Bearer <MCP_TOKEN>`；将示例中的占位符替换为服务端配置的 token。同时只允许一个活动会话，
第二个初始化请求返回 409。需要并行 agent 时启动多个容器，使用不同的 `NAME`、`PORT`、
`DATA_DIR`，以及不同的 `GPU`。

/health、MCP 初始化和列出工具不会启动 Chrome；Weston 随容器启动，首次浏览器工具调用由 DevTools 启动 Chrome。

## 测试

```bash
GPU=0 ./environments/linux-nvidia/test.sh
```

启动临时容器，由 `smoke.sh` 拉起 HTTP 服务并启用测试页面，再运行 `test/e2e.mjs`。
默认产物保存在 `artifacts/linux-nvidia-test/`，包含录像、截图、媒体信息和服务日志；
可通过 `DATA_DIR` 指定其他目录。测试结束后容器自动删除，挂载目录中的产物保留。

## 与 wslc 的差异

| 项目 | wslc | linux-nvidia |
| --- | --- | --- |
| GPU 设备 | `/dev/dxg`（WSL 半虚拟化） | `/dev/nvidia*`（CDI 或 nvidia runtime 注入） |
| 驱动库 | `/usr/lib/wsl/lib` | 容器运行时注入 |
| Mesa 后端 | `GALLIUM_DRIVER=d3d12` | 不使用（NVIDIA 原生 EGL） |
| ANGLE 后端 | `--use-angle=gl` | `--use-angle=vulkan` |
| 启动参数 | `MESA_D3D12_DEFAULT_ADAPTER_NAME` 选卡 | `--device nvidia.com/gpu=N` 选卡 |

通用工具代码（`src/`）与录制扩展（`extension/`）两个环境完全共用，不含 GPU 假设；
环境差异全部通过 `CHROME_ARGS` 注入。

当前环境以 root 运行 Chrome，并使用 `--no-sandbox`。GPU 图形渲染与视频硬件编码是独立的能力。

工具全量开放、`pageId` 参数以及录制期间的冲突规则见[项目工具说明](../../README.md#架构与工具)。旧 `browser_*` 工具已由 DevTools 原生工具替代。Chrome 生命周期由 DevTools 负责。
