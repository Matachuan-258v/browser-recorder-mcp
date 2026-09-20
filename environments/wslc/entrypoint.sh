#!/usr/bin/env bash
set -euo pipefail
export XDG_RUNTIME_DIR=/tmp/game-runtime WAYLAND_DISPLAY=game-wayland
export LD_LIBRARY_PATH="/usr/lib/wsl/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export GALLIUM_DRIVER=d3d12
export MESA_D3D12_DEFAULT_ADAPTER_NAME="${MESA_D3D12_DEFAULT_ADAPTER_NAME:-NVIDIA}"
export CHROME_ARGS='["--no-sandbox","--ozone-platform=wayland","--use-gl=angle","--use-angle=gl","--ignore-gpu-blocklist","--disable-gpu-compositing","--alsa-output-device=null"]'
unset DISPLAY
if [[ ! -c /dev/dxg ]]; then
  echo 'WSL GPU device /dev/dxg is missing. Start this image with wslc run --gpus all.' >&2
  exit 1
fi
mkdir -p "$XDG_RUNTIME_DIR" "${GAME_DATA_DIR:-/data}"
chmod 700 "$XDG_RUNTIME_DIR"
weston --backend=headless --renderer=pixman --socket="$WAYLAND_DISPLAY" --width=1280 --height=800 --idle-time=0 --no-config >"${GAME_DATA_DIR:-/data}/weston.log" 2>&1 &
weston_pid=$!
for attempt in $(seq 1 100); do
  [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] && break
  if ! kill -0 "$weston_pid" 2>/dev/null; then
    cat "${GAME_DATA_DIR:-/data}/weston.log" >&2
    exit 1
  fi
  sleep 0.1
done
[[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] || { echo 'Weston startup timed out.' >&2; exit 1; }
# Chrome is launched by the first browser tool call, not by this entrypoint.
# Replacing the shell lets tini deliver SIGTERM directly to the MCP service.
exec "$@"
