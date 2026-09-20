param(
    [ValidateSet("NVIDIA", "Intel")][string]$Gpu = "NVIDIA",
    [string]$Image = "game-browser-mcp:wslc",
    [string]$Name = "browser-recorder-mcp",
    [ValidateRange(1,65535)][int]$Port = 3000,
    [string]$DataDir = ""
)
$ErrorActionPreference = "Stop"
if (-not $DataDir) { $DataDir = Join-Path $PSScriptRoot "../../artifacts/recordings" }
$null = New-Item -ItemType Directory -Force -Path $DataDir
$DataDir = (Resolve-Path $DataDir).Path
& wslc.exe run -d --name $Name --gpus all --shm-size 1G -p "${Port}:3000" -e "MESA_D3D12_DEFAULT_ADAPTER_NAME=$Gpu" -v "${DataDir}:/data" $Image
exit $LASTEXITCODE
