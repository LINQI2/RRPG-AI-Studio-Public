$ErrorActionPreference = 'Stop'
$appDirectory = $PSScriptRoot
$runtimeDirectory = if ($env:STUDIO_RUNTIME) { [IO.Path]::GetFullPath($env:STUDIO_RUNTIME) } else { Join-Path $appDirectory 'runtime' }
$appBoundary = [IO.Path]::GetFullPath($appDirectory).TrimEnd('\') + '\'
if (-not ($runtimeDirectory.TrimEnd('\') + '\').StartsWith($appBoundary, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime must remain inside the Studio app directory.' }
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'dist\server\main.js'))) {
    throw 'Build first: npm ci; npm run build'
}
$existingLock = Join-Path $runtimeDirectory 'server.lock'
if (Test-Path -LiteralPath $existingLock) {
    $priorStudio = Get-Content -Raw -LiteralPath $existingLock | ConvertFrom-Json
    if (Get-Process -Id $priorStudio.pid -ErrorAction SilentlyContinue) {
        Write-Output 'Studio may already be running. Open http://127.0.0.1:3178 or use Stop-Studio.ps1.'
        exit 0
    }
}
$nodeExecutable = (Get-Command node.exe).Source
Start-Process -FilePath $nodeExecutable -ArgumentList @('dist/server/main.js') -WorkingDirectory $appDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory 'server.log') -RedirectStandardError (Join-Path $runtimeDirectory 'server-error.log')
$studioPort = if ($env:STUDIO_PORT) { [int]$env:STUDIO_PORT } else { 3178 }
Write-Output "RRPG AI Studio: http://127.0.0.1:$studioPort"
