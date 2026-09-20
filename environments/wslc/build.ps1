param(
    [string]$Image = "game-browser-mcp:wslc",
    [string]$BaseImage = "docker.1ms.run/ubuntu:24.04"
)
$ErrorActionPreference = "Stop"
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Push-Location $projectDir
try {
    & wslc.exe build -f environments/wslc/Dockerfile --build-arg "BASE_IMAGE=$BaseImage" -t $Image .
    if ($LASTEXITCODE -ne 0) { throw "wslc build failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }
