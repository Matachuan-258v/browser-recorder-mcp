#!/usr/bin/env bash
# Run the end-to-end test in a throwaway container.
#   GPU=0 DATA_DIR=/path/to/results ./test.sh
set -euo pipefail
image="${IMAGE:-game-browser-mcp:linux-nvidia}"
gpu="${GPU:-0}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
data_dir="${DATA_DIR:-$root/artifacts/linux-nvidia-test}"
mkdir -p "$data_dir"
data_dir="$(cd "$data_dir" && pwd)"
docker run --rm \
  --device "nvidia.com/gpu=$gpu" \
  --shm-size 1g \
  -v "${data_dir}:/data" \
  "$image" /bin/bash /app/smoke.sh
