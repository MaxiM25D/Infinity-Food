const apiBase = (process.env.PILOT_API_URL ?? "http://127.0.0.1:4100").replace(
  /\/+$/,
  "",
);
const webBase = (process.env.PILOT_WEB_URL ?? "http://127.0.0.1:3100").replace(
  /\/+$/,
  "",
);
const metricsToken =
  process.env.PILOT_METRICS_TOKEN ?? "stage7-local-metrics-token";
const expectedVersion = process.env.PILOT_EXPECTED_VERSION;
const timeoutMs = Number(process.env.PILOT_TIMEOUT_MS ?? 5_000);
const retries = Number(process.env.PILOT_RETRIES ?? 3);

function assertSafeUrl(rawUrl, name) {
  const url = new URL(rawUrl);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local)
    throw new Error(`${name} debe usar HTTPS fuera del entorno local`);
}

async function checkedFetch(name, url, options = {}, expectedStatus = 200) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.text();
      if (response.status !== expectedStatus)
        throw new Error(
          `${name}: HTTP ${response.status}; se esperaba ${expectedStatus}`,
        );
      return { response, body, attempt };
    } catch (error) {
      lastError = error;
      if (attempt < retries)
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function parseJson(name, body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${name}: la respuesta no es JSON válido`);
  }
}

const startedAt = performance.now();
const checks = [];

try {
  assertSafeUrl(apiBase, "PILOT_API_URL");
  assertSafeUrl(webBase, "PILOT_WEB_URL");
  if (!metricsToken) throw new Error("PILOT_METRICS_TOKEN es obligatorio");

  const healthResult = await checkedFetch(
    "health",
    `${apiBase}/api/health`,
  );
  const health = parseJson("health", healthResult.body);
  if (health.status !== "ok" || !health.instanceId || !health.version)
    throw new Error("health no identifica una réplica saludable");
  if (expectedVersion && health.version !== expectedVersion)
    throw new Error(
      `Versión inesperada: ${health.version}; se esperaba ${expectedVersion}`,
    );
  checks.push({ name: "health", instanceId: health.instanceId, version: health.version });

  const readyResult = await checkedFetch(
    "readiness",
    `${apiBase}/api/ready`,
  );
  const ready = parseJson("readiness", readyResult.body);
  for (const dependency of ["database", "redis", "worker"])
    if (ready[dependency] !== "ok")
      throw new Error(`readiness: ${dependency}=${ready[dependency] ?? "missing"}`);
  checks.push({
    name: "readiness",
    databaseLatencyMs: ready.databaseLatencyMs,
    dependencies: "ok",
  });

  await checkedFetch(
    "metrics-sin-credencial",
    `${apiBase}/api/internal/metrics`,
    {},
    401,
  );
  const metricsResult = await checkedFetch(
    "metrics",
    `${apiBase}/api/internal/metrics`,
    { headers: { authorization: `Bearer ${metricsToken}` } },
  );
  for (const metric of [
    "infinityfood_build_info",
    "infinityfood_dependency_up",
    "infinityfood_queue_depth",
    "infinityfood_http_requests_total",
  ])
    if (!metricsResult.body.includes(metric))
      throw new Error(`metrics: falta ${metric}`);
  checks.push({ name: "metrics", authentication: "enforced" });

  const webResult = await checkedFetch("web", webBase);
  if (!webResult.body.includes("InfinityFood"))
    throw new Error("web: la portada no contiene la marca InfinityFood");
  checks.push({ name: "web", brand: "InfinityFood" });

  console.log(
    JSON.stringify({
      status: "PILOT_READY",
      apiBase,
      webBase,
      durationMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      checks,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "PILOT_BLOCKED",
      apiBase,
      webBase,
      durationMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      checks,
    }),
  );
  process.exitCode = 1;
}
