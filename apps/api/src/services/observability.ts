const startedAt = Date.now();
const requests = new Map<string, { count: number; durationSeconds: number }>();
const backgroundJobs = new Map<string, { success: number; failure: number }>();
let websocketConnections = 0;
let websocketConnectionsTotal = 0;

export function recordHttpRequest(method: string, status: number, durationMs: number): void {
  const key = `${method}:${status}`;
  const current = requests.get(key) ?? { count: 0, durationSeconds: 0 };
  current.count += 1;
  current.durationSeconds += durationMs / 1000;
  requests.set(key, current);
}

export function websocketConnected(): void { websocketConnections += 1; websocketConnectionsTotal += 1; }
export function websocketDisconnected(): void { websocketConnections = Math.max(0, websocketConnections - 1); }

export function recordBackgroundJob(name: string, succeeded: boolean): void {
  const current = backgroundJobs.get(name) ?? { success: 0, failure: 0 };
  if (succeeded) current.success += 1; else current.failure += 1;
  backgroundJobs.set(name, current);
}

export function prometheusMetrics(): string {
  const memory = process.memoryUsage();
  const lines = [
    "# HELP infinityfood_process_uptime_seconds Process uptime.",
    "# TYPE infinityfood_process_uptime_seconds gauge",
    `infinityfood_process_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
    "# HELP infinityfood_process_resident_memory_bytes Resident memory.",
    "# TYPE infinityfood_process_resident_memory_bytes gauge",
    `infinityfood_process_resident_memory_bytes ${memory.rss}`,
    "# HELP infinityfood_websocket_connections Current authenticated Socket.IO connections.",
    "# TYPE infinityfood_websocket_connections gauge",
    `infinityfood_websocket_connections ${websocketConnections}`,
    "# HELP infinityfood_websocket_connections_total Total authenticated Socket.IO connections.",
    "# TYPE infinityfood_websocket_connections_total counter",
    `infinityfood_websocket_connections_total ${websocketConnectionsTotal}`,
    "# HELP infinityfood_http_requests_total HTTP requests by method and status.",
    "# TYPE infinityfood_http_requests_total counter",
  ];
  for (const [key, value] of requests) {
    const [method, status] = key.split(":");
    lines.push(`infinityfood_http_requests_total{method="${method}",status="${status}"} ${value.count}`);
    lines.push(`infinityfood_http_request_duration_seconds_sum{method="${method}",status="${status}"} ${value.durationSeconds}`);
    lines.push(`infinityfood_http_request_duration_seconds_count{method="${method}",status="${status}"} ${value.count}`);
  }
  lines.push("# HELP infinityfood_background_jobs_total Background sweep outcomes.", "# TYPE infinityfood_background_jobs_total counter");
  for (const [name, value] of backgroundJobs) {
    lines.push(`infinityfood_background_jobs_total{name="${name}",result="success"} ${value.success}`);
    lines.push(`infinityfood_background_jobs_total{name="${name}",result="failure"} ${value.failure}`);
  }
  return `${lines.join("\n")}\n`;
}
