param(
    [ValidateSet("NVIDIA", "Intel")][string]$Gpu = "NVIDIA",
    [string]$Image = "game-browser-mcp:wslc",
    [string]$DataDir = ""
)
$ErrorActionPreference = "Stop"
if (-not $DataDir) { $DataDir = Join-Path $PSScriptRoot "../../artifacts/wslc-test" }
$null = New-Item -ItemType Directory -Force -Path $DataDir
$DataDir = (Resolve-Path $DataDir).Path
& wslc.exe run --rm --gpus all --shm-size 1G -e "MESA_D3D12_DEFAULT_ADAPTER_NAME=$Gpu" -v "${DataDir}:/data" $Image /bin/bash /app/smoke.sh
exit $LASTEXITCODE
