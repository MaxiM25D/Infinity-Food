import { performance } from "node:perf_hooks";

const baseUrl = process.env.LOAD_BASE_URL ?? "http://localhost:4000";
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS ?? 15);
const maxP95Ms = Number(process.env.LOAD_MAX_P95_MS ?? 750);
const maxErrorRate = Number(process.env.LOAD_MAX_ERROR_RATE ?? 0.01);
const paths = (process.env.LOAD_PATHS ?? "/api/health,/api/ready").split(",").map((value) => value.trim()).filter(Boolean);
const deadline = performance.now() + durationSeconds * 1000;
const samples = [];
let errors = 0;

async function worker(index) {
  let requestIndex = index;
  while (performance.now() < deadline) {
    const path = paths[requestIndex % paths.length];
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${path}`, { headers: { "x-load-test": "stage-6" }, signal: AbortSignal.timeout(5_000) });
      if (!response.ok) errors += 1;
      await response.arrayBuffer();
    } catch { errors += 1; }
    samples.push(performance.now() - startedAt);
    requestIndex += concurrency;
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
samples.sort((a, b) => a - b);
const percentile = (value) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * value) - 1)] ?? 0;
const result = { requests: samples.length, errors, errorRate: samples.length ? errors / samples.length : 1, requestsPerSecond: samples.length / durationSeconds, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), concurrency, durationSeconds, paths };
console.log(JSON.stringify(result));
if (result.errorRate > maxErrorRate || result.p95Ms > maxP95Ms) process.exitCode = 1;
