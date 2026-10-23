param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$EvidenceDirectory = (Join-Path $PSScriptRoot "..\backups\pilot-drills"),
  [switch]$UseDocker,
  [switch]$SkipIsolationTests
)

$ErrorActionPreference = "Stop"
if (-not $DatabaseUrl) { throw "DatabaseUrl o DATABASE_URL es obligatorio" }

$resolvedEvidence = [System.IO.Path]::GetFullPath($EvidenceDirectory)
New-Item -ItemType Directory -Force -Path $resolvedEvidence | Out-Null
$startedAt = Get-Date
$previousDatabaseUrl = $env:DATABASE_URL
$backupScript = Join-Path $PSScriptRoot "backup-postgres.ps1"
$restoreScript = Join-Path $PSScriptRoot "restore-drill.ps1"

try {
  $env:DATABASE_URL = $DatabaseUrl
  $backupOutput = & $backupScript -OutputDirectory $resolvedEvidence -UseDocker:$UseDocker
  if ($LASTEXITCODE -ne 0) { throw "El backup del piloto falló" }

  $backupLine = $backupOutput | Where-Object { $_ -match '^Backup creado:\s*(.+)$' } | Select-Object -Last 1
  if (-not $backupLine -or $backupLine -notmatch '^Backup creado:\s*(.+)$') {
    throw "No se pudo identificar el archivo generado por el backup"
  }
  $backupPath = [System.IO.Path]::GetFullPath($Matches[1].Trim())
  $backupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath).Hash

  $restoreOutput = & $restoreScript -BackupPath $backupPath -SkipIsolationTests:$SkipIsolationTests
  if ($LASTEXITCODE -ne 0) { throw "El ensayo de restauración del piloto falló" }
  $restoreLine = $restoreOutput | Where-Object { $_ -match '^RESTORE_DRILL_OK' } | Select-Object -Last 1
  if (-not $restoreLine) { throw "La restauración no devolvió evidencia verificable" }

  $finishedAt = Get-Date
  $gitSha = (git rev-parse HEAD 2>$null)
  $dirty = [bool](git status --porcelain 2>$null)
  $evidence = [ordered]@{
    status = "PILOT_RECOVERY_OK"
    startedAt = $startedAt.ToUniversalTime().ToString("o")
    finishedAt = $finishedAt.ToUniversalTime().ToString("o")
    durationSeconds = [Math]::Round(($finishedAt - $startedAt).TotalSeconds, 2)
    backupPath = $backupPath
    backupSha256 = $backupHash
    restore = [string]$restoreLine
    isolationTestsSkipped = [bool]$SkipIsolationTests
    gitSha = [string]$gitSha
    workingTreeDirty = $dirty
  }
  $evidencePath = Join-Path $resolvedEvidence "drill-$($startedAt.ToString('yyyyMMdd-HHmmss')).json"
  $evidence | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  Write-Output "PILOT_RECOVERY_OK evidence=$evidencePath backup=$backupPath sha256=$backupHash"
} finally {
  $env:DATABASE_URL = $previousDatabaseUrl
}
