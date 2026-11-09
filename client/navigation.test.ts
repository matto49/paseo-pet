import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { connectInstalledApp } from "./navigation.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function browser(t: test.TestContext, standalone: boolean) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>(),
    assigned: string[] = [];
  const fake = {
    location: {
      origin: "http://localhost:8081",
      href: "http://localhost:8081/h/host/workspace/old",
      assign: (url: string) => assigned.push(url),
    },
    matchMedia: () => ({ matches: standalone }),
    crypto: { randomUUID },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
  Object.defineProperty(globalThis, "window", { value: fake, writable: true, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  return { fake, storage, assigned };
}
test("ordinary browser tabs never consume installed-application navigation requests", async (t) => {
  browser(t, false);
  let calls = 0;
  const client = {
    rpc: async () => {
      calls++;
      return { request: null };
    },
  } as unknown as PluginClientContext;
  const stop = connectInstalledApp(client);
  await flush();
  stop();
  assert.equal(calls, 0);
});
test("the installed window navigates itself, then confirms from the new document", async (t) => {
  const b = browser(t, true),
    id = randomUUID(),
    url = "http://localhost:8081/h/host/agent/a";
  const inputs: { appliedRequestId: string | null }[] = [];
  let deliver = true;
  const client = {
    rpc: async (_contract: unknown, input: { appliedRequestId: string | null }) => {
      inputs.push(input);
      return { request: deliver ? { id, url } : null };
    },
  } as unknown as PluginClientContext;
  const stop = connectInstalledApp(client);
  await flush();
  stop();
  assert.deepEqual(b.assigned, [url]);
  assert.equal(inputs[0]?.appliedRequestId, null);
  deliver = false;
  b.fake.location.href = "http://localhost:8081/h/host/workspace/new";
  const stopReloaded = connectInstalledApp(client);
  await flush();
  stopReloaded();
  assert.equal(inputs[1]?.appliedRequestId, id);
});
