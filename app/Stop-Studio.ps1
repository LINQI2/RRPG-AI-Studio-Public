$ErrorActionPreference = 'Stop'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$studioPort = if ($env:STUDIO_PORT) { [int]$env:STUDIO_PORT } else { 3178 }
$localOrigin = "http://127.0.0.1:$studioPort"
$response = Invoke-RestMethod -Uri "$localOrigin/api/session" -WebSession $session
Invoke-RestMethod -Method Post -Uri "$localOrigin/api/shutdown" -WebSession $session -Headers @{ 'X-Studio-CSRF' = $response.csrf; Origin = $localOrigin } -ContentType 'application/json' -Body '{}'
