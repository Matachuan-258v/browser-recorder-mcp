#!/usr/bin/env bash
# Start the long-running HTTP MCP service on a native NVIDIA host.
#   GPU=0 PORT=3000 DATA_DIR=/path/to/recordings ./run.sh
set -euo pipefail
image="${IMAGE:-game-browser-mcp:linux-nvidia}"
name="${NAME:-browser-recorder-mcp}"
port="${PORT:-3000}"
gpu="${GPU:-0}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
data_dir="${DATA_DIR:-$root/artifacts/recordings}"
mkdir -p "$data_dir"
data_dir="$(cd "$data_dir" && pwd)"
# CDI (--device nvidia.com/gpu=N) needs nvidia-container-toolkit >= 1.12 and
# Docker >= 25. On older setups substitute --gpus all.
docker run -d --name "$name" \
  --device "nvidia.com/gpu=$gpu" \
  --shm-size 1g \
  -e MCP_TOKEN -e MCP_HOSTC \
  -p "${port}:3000" \
  -v "${data_dir}:/data" \
  "$image"
