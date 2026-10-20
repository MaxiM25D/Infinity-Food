param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [switch]$SkipIsolationTests
)

$ErrorActionPreference = "Stop"
$resolvedBackup = [System.IO.Path]::GetFullPath($BackupPath)
if (-not (Test-Path -LiteralPath $resolvedBackup -PathType Leaf)) { throw "No existe el backup indicado: $resolvedBackup" }
if ([System.IO.Path]::GetExtension($resolvedBackup) -ne ".dump") { throw "El ensayo solo acepta dumps .dump creados por pg_dump" }

$containerName = "infinityfood-restore-$([Guid]::NewGuid().ToString('N').Substring(0, 12))"
$databaseName = "infinityfood_restore"
$databaseUser = "restore_user"
$passwordBytes = New-Object byte[] 24
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($passwordBytes)
$random.Dispose()
$databasePassword = [Convert]::ToBase64String($passwordBytes)
$backupDirectory = Split-Path -Parent $resolvedBackup
$backupName = Split-Path -Leaf $resolvedBackup
$startedAt = Get-Date

try {
  docker run -d --name $containerName --mount "type=bind,source=$backupDirectory,target=/backup,readonly" -e "POSTGRES_DB=$databaseName" -e "POSTGRES_USER=$databaseUser" -e "POSTGRES_PASSWORD=$databasePassword" -p "127.0.0.1::5432" postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar PostgreSQL temporal" }
  $ready = $false
  $consecutiveReady = 0
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    docker exec $containerName pg_isready -U $databaseUser -d $databaseName *> $null
    if ($LASTEXITCODE -eq 0) { $consecutiveReady += 1 } else { $consecutiveReady = 0 }
    if ($consecutiveReady -ge 3) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "PostgreSQL temporal no quedó disponible" }
  docker exec $containerName pg_restore --username $databaseUser --dbname $databaseName --no-owner --no-acl --exit-on-error "/backup/$backupName"
  if ($LASTEXITCODE -ne 0) { throw "pg_restore falló" }
  $portLine = docker port $containerName 5432/tcp
  if ($portLine -notmatch ':(\d+)$') { throw "No se pudo resolver el puerto temporal" }
  $temporaryUrl = "postgresql://${databaseUser}:$([Uri]::EscapeDataString($databasePassword))@127.0.0.1:$($Matches[1])/${databaseName}?schema=public"
  $previousDatabaseUrl = $env:DATABASE_URL
  try {
    $env:DATABASE_URL = $temporaryUrl
    pnpm --filter @infinityshop/database exec prisma migrate status --config prisma.config.ts
    if ($LASTEXITCODE -ne 0) { throw "La restauración no coincide con las migraciones" }
    if (-not $SkipIsolationTests) {
      pnpm db:test:isolation
      if ($LASTEXITCODE -ne 0) { throw "Las pruebas de aislamiento fallaron sobre la restauración" }
    }
  } finally {
    $env:DATABASE_URL = $previousDatabaseUrl
  }
  $elapsed = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
  Write-Output "RESTORE_DRILL_OK container=$containerName durationSeconds=$elapsed backup=$resolvedBackup"
} finally {
  $existing = docker ps -a --filter "name=^/${containerName}$" --format "{{.Names}}"
  if ($existing -eq $containerName) { docker rm -f $containerName | Out-Null }
}
