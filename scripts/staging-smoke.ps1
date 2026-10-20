param(
  [int]$WebPort = 3100,
  [int]$ApiPort = 4100,
  [int]$MailPort = 8025,
  [string]$MetricsToken = "stage7-local-metrics-token"
)

$ErrorActionPreference = "Stop"

function Assert-Status([string]$Url, [int]$ExpectedStatus, [hashtable]$Headers = @{}) {
  try {
    $response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing
    $actualStatus = [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) {
      $actualStatus = [int]$_.Exception.Response.StatusCode
    } else {
      throw
    }
  }
  if ($actualStatus -ne $ExpectedStatus) {
    throw "Smoke falló para ${Url}: esperado $ExpectedStatus, recibido $actualStatus"
  }
}

$apiBase = "http://127.0.0.1:$ApiPort"
$webBase = "http://127.0.0.1:$WebPort"
$mailBase = "http://127.0.0.1:$MailPort"

Assert-Status "$apiBase/api/health" 200
Assert-Status "$apiBase/api/ready" 200
Assert-Status "$apiBase/api/internal/metrics" 401
Assert-Status "$apiBase/api/internal/metrics" 200 @{ Authorization = "Bearer $MetricsToken" }
Assert-Status $webBase 200
Assert-Status $mailBase 200

$homepageResponse = Invoke-WebRequest -Uri $webBase -UseBasicParsing
if ($homepageResponse.Content -notmatch "InfinityFood") {
  throw "La web respondió, pero no contiene la marca InfinityFood"
}

Write-Output "STAGING_SMOKE_OK web=$webBase api=$apiBase mail=$mailBase"
