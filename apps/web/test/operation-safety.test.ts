import assert from "node:assert/strict";
import { test } from "node:test";
import { apiRequest } from "../src/lib/api";
import { beginOperation, isOperationPending } from "../src/lib/pending-operation";

test("nested operations stay protected until all have finished", () => {
  const outer = beginOperation();
  const inner = beginOperation();
  inner();
  inner();
  assert.equal(isOperationPending(), true);
  outer();
  assert.equal(isOperationPending(), false);
});

test("failed requests always release protection and are not retried", async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    assert.equal(isOperationPending(), true);
    throw new Error("network failure");
  };
  try {
    await assert.rejects(
      apiRequest("/test", { method: "POST" }),
      /Recibimos una respuesta inesperada/,
    );
    assert.equal(calls, 1);
    assert.equal(isOperationPending(), false);
  } finally {
    globalThis.fetch = original;
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("protection lasts until the response body has been read", async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => {
      assert.equal(isOperationPending(), true);
      return { saved: true };
    },
  }) as Response;
  try {
    assert.deepEqual(await apiRequest("/test", { method: "POST" }), { saved: true });
    assert.equal(isOperationPending(), false);
  } finally {
    globalThis.fetch = original;
    Reflect.deleteProperty(globalThis, "window");
  }
});
