import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PetClient } from "./pet.ts";

const display = {
  state: "working" as const,
  task: "Paseo · 测试",
  agentId: "test",
  running: 1,
  waiting: 0,
};

async function fixture(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "paseo-pet-test-"));
  const requests: { path: string; method: string; body: unknown }[] = [];
  let token = "a".repeat(43);
  let rejectStatus = 0;
  let rejectBusiness = false;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers["x-dsh-pet-token"], token);
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      path: req.url || "",
      method: req.method || "",
      body: body ? JSON.parse(body) : null,
    });
    res.setHeader("content-type", "application/json");
    res.statusCode = rejectStatus || 200;
    res.end(
      JSON.stringify({ ok: !rejectBusiness, reason: rejectBusiness ? "unknown-owner" : undefined }),
    );
    rejectStatus = 0;
    rejectBusiness = false;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await mkdir(join(home, "dsh-pet"));
  const rotate = async () => {
    token = token === "a".repeat(43) ? "b".repeat(43) : "a".repeat(43);
    await writeFile(
      join(home, "dsh-pet/standalone-runtime.json"),
      JSON.stringify({
        name: "dsh-pet-standalone",
        pid: process.pid,
        port,
        token,
      }),
    );
  };
  await rotate();
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
  return {
    client: new PetClient(home),
    requests,
    rotate,
    rejectHttp: () => {
      rejectStatus = 401;
    },
    rejectOwner: () => {
      rejectBusiness = true;
    },
  };
}

test("runtime rotation registers the menu and republishes identical status", async (t) => {
  const f = await fixture(t);
  await f.client.sync(display);
  await f.client.sync(display);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1]?.body, { state: display.state, task: display.task });
  await f.rotate();
  await f.client.sync(display);
  assert.deepEqual(
    f.requests.slice(2).map((r) => r.path),
    ["/dsh-pet-7340/menu/item", "/dsh-pet-7340/work-status"],
  );
});

test("failed authentication and unknown-owner responses do not cache success", async (t) => {
  const f = await fixture(t);
  f.rejectHttp();
  await assert.rejects(f.client.sync(display), /HTTP 401/);
  await f.client.sync(display);
  assert.equal(f.requests.length, 3);
  f.rejectOwner();
  await assert.rejects(f.client.poll(new AbortController().signal), /unknown-owner/);
  await f.client.sync(display);
  assert.equal(f.requests.at(-2)?.path, "/dsh-pet-7340/menu/item");
  assert.equal(f.requests.at(-1)?.path, "/dsh-pet-7340/work-status");
});

test("idle and plugin shutdown remove the external work status and menu", async (t) => {
  const f = await fixture(t);
  await f.client.sync(display);
  await f.client.sync({ ...display, state: null, task: null, agentId: null, running: 0 });
  assert.equal(f.requests.at(-1)?.method, "DELETE");
  await f.client.release();
  assert.deepEqual(
    f.requests.slice(-2).map(({ path, method }) => ({ path, method })),
    [
      { path: "/dsh-pet-7340/menu/item?owner=Paseo", method: "DELETE" },
      { path: "/dsh-pet-7340/work-status", method: "DELETE" },
    ],
  );
});
