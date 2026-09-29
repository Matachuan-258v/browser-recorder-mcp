#!/usr/bin/env bash
# Build the native Linux + NVIDIA image. Run from anywhere.
set -euo pipefail
image="${IMAGE:-game-browser-mcp:linux-nvidia}"
base="${BASE_IMAGE:-ubuntu:24.04}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
docker build -f environments/linux-nvidia/Dockerfile --build-arg "BASE_IMAGE=$base" -t "$image" .
