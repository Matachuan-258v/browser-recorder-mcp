# Windows wslc HTTP MCP 部署

此目录提供 Windows WSL/D3D12 环境的镜像配置，目标平台为 Windows x64 / linux/amd64，可选择 NVIDIA 或 Intel GPU。

## 准备和构建

复制整个项目源码到例如 `C:\game-browser-mcp`，不需要复制 node_modules、artifacts 或 .idea。Dockerfile 需要项目根目录作为构建上下文，不能只复制 Dockerfile。

前提：wslc 已可运行，`--gpus all` 能提供 `/dev/dxg` 及 WSL 图形驱动库。宿主机无需安装 Node、Chrome 或 FFmpeg。

在项目根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\environments\wslc\build.ps1
```

等价的构建命令：

```powershell
wslc build -f environments/wslc/Dockerfile -t game-browser-mcp:wslc .
```

基础镜像默认 `docker.1ms.run/ubuntu:24.04`；apt 使用清华镜像，npm 使用 npmmirror。Chrome 和 Node 从官方地址下载，仅在构建时安装。

固定 Node 22.14.0 和 Chrome 153.0.8010.52-1，Node 校验官方 SHA256 清单。若上游移除指定 Chrome 历史包，构建会报错，需要显式更新 CHROME_VERSION 并重新验证。基础镜像 tag 和 apt 软件包未完全锁定快照。

## 启动常驻服务

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\environments\wslc\run.ps1 -Gpu NVIDIA -Port 3000 -DataDir C:\game-browser-mcp\recordings
```

`-Gpu Intel` 选择 Intel；`-Name` 默认 browser-recorder-mcp；`-Image` 默认 game-browser-mcp:wslc。默认录像目录为项目的 artifacts/recordings。容器以后台方式运行，无需 agent 启动进程。

等价命令（先创建录像目录）：

```powershell
wslc run -d --name browser-recorder-mcp --gpus all --shm-size 1G -p 3000:3000 -e MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA -v C:\game-browser-mcp\recordings:/data game-browser-mcp:wslc
```

wslc 的内存单位要写 `1G`，不能写 `1g`。镜像声明 EXPOSE 3000，同时服务实际监听 0.0.0.0:3000；`-p` 将端口映射到 Windows。端口对远程机器的可达性还取决于主机网络/防火墙配置。

```powershell
curl.exe http://127.0.0.1:3000/health
wslc logs browser-recorder-mcp
wslc stop browser-recorder-mcp
wslc start browser-recorder-mcp
```

停止后保留容器，可 start 再启动；同名容器已存在时不要再次 run。重新构建镜像后，需要停止并删除旧容器再 run，新镜像不会自动替换已有容器；绑定目录中的录像会保留。

## 连接 agent

将 [mcp.example.json](mcp.example.json) 中的条目加入支持 Streamable HTTP 和图片结果的 MCP 客户端，按客户端格式调整字段。URL 为：

```text
http://WINDOWS_HOST:3000/mcp
```

同机使用 127.0.0.1，远程使用 Windows 可达地址。没有 token 或 Authorization 配置。能够访问端口的客户端可以操作浏览器。

首个初始化会话占用服务，第二个会话返回 409。正常结束应让客户端发送 DELETE /mcp；直接断开连接后默认空闲 30 分钟回收，录制及执行工具期间不回收。会话结束会关闭 Chrome，新会话创建新的临时 profile。需要独立并行 agent 时，启动多个容器，使用不同的 Name、Port 和 DataDir。

/health、MCP 初始化和列出工具不会启动 Chrome；Weston 随容器启动。首次浏览器工具调用才启动 Chrome。录像仍为 tabCapture + MediaRecorder 的 WebM，返回的 /data 路径位于服务器，不会自动下载到 agent。

当前环境以 root 运行 Chrome，并使用 `--no-sandbox`。GPU 图形渲染与视频硬件编码是独立的能力。
