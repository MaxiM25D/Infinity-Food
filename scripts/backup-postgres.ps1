param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\backups"),
  [switch]$UseDocker
)

$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "DATABASE_URL no está configurada" }

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $resolvedOutput "infinityfood-$timestamp.dump"

try {
  $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($pgDump -and -not $UseDocker) {
    & $pgDump.Source --dbname $env:DATABASE_URL --format custom --no-owner --no-acl --file $backupPath
  } else {
    $dockerUrl = $env:DATABASE_URL.Replace("@localhost:", "@host.docker.internal:").Replace("@127.0.0.1:", "@host.docker.internal:").Replace("?schema=public", "").Replace("&schema=public", "")
    docker run --rm --mount "type=bind,source=$resolvedOutput,target=/backup" postgres:17-alpine pg_dump --dbname $dockerUrl --format custom --no-owner --no-acl --file "/backup/$(Split-Path -Leaf $backupPath)"
  }
  if ($LASTEXITCODE -ne 0) { throw "pg_dump finalizó con código $LASTEXITCODE" }
} catch {
  Remove-Item -LiteralPath $backupPath -ErrorAction SilentlyContinue
  throw
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath
Write-Output "Backup creado: $backupPath"
Write-Output "SHA256: $($hash.Hash)"
