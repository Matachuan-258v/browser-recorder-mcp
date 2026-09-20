#!/usr/bin/env bash
set -euo pipefail
export GAME_TEST_FIXTURES=1 MCP_HOST=127.0.0.1 MCP_PORT=3000
export E2E_SERVER_URL=http://127.0.0.1:3000/mcp
cd /app
node src/server.mjs >"${GAME_DATA_DIR:-/data}/mcp-test.log" 2>&1 &
server_pid=$!
cleanup(){ kill -TERM "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; }
trap cleanup EXIT
for attempt in $(seq 1 100); do
 if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then break; fi
 kill -0 "$server_pid" 2>/dev/null || { cat "${GAME_DATA_DIR:-/data}/mcp-test.log" >&2; exit 1; }
 sleep .1
done
curl -fsS http://127.0.0.1:3000/health >/dev/null
node test/e2e.mjs
cp artifacts/e2e/screenshot.png artifacts/e2e/result.json "${GAME_DATA_DIR:-/data}/"
