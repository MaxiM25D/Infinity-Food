$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $root.Path.StartsWith((Resolve-Path $PSScriptRoot).Parent.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Ruta de trabajo inesperada"
}

Push-Location $root.Path
try {
  $redisPort = if ($env:REDIS_PORT) { $env:REDIS_PORT } else { "56379" }
  $env:REDIS_PORT = $redisPort
  docker compose up -d postgres redis
  if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar PostgreSQL/Redis" }
  $env:REDIS_URL = "redis://127.0.0.1:$redisPort"
  $env:REDIS_KEY_PREFIX = "infinityfood-scale-test"
  pnpm db:generate
  pnpm db:deploy
  pnpm --filter "@infinityshop/api" exec tsx --test --test-concurrency=1 test/horizontal-scaling.test.ts
} finally {
  Pop-Location
}
