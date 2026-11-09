import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OpenSessionBridge } from "./open-session.ts";

test("only an installed window claims a request; a reloaded window acknowledges it", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "paseo-open-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bridge = new OpenSessionBridge(home),
    id = randomUUID();
  const request = { id, url: "http://localhost:8081/h/host/agent/a", createdAt: 100 };
  await writeFile(join(home, "open-request.json"), JSON.stringify(request));
  const client = {
    clientId: randomUUID(),
    href: "http://localhost:8081/",
    standalone: false,
    appliedRequestId: null,
  };
  assert.deepEqual(await bridge.poll(client, 101), { request: null });
  client.standalone = true;
  assert.equal((await bridge.poll(client, 102)).request?.id, id);
  assert.deepEqual(await bridge.poll({ ...client, clientId: randomUUID() }, 103), {
    request: null,
  });
  const reloaded = {
    ...client,
    clientId: randomUUID(),
    href: "http://localhost:8081/h/host/workspace/a",
    appliedRequestId: id,
  };
  assert.deepEqual(await bridge.poll(reloaded, 104), { request: null });
  const result = JSON.parse(await readFile(join(home, "open-result.json"), "utf8"));
  assert.equal(result.id, id);
  assert.equal(result.target, "installed-pwa");
  assert.equal(result.href, reloaded.href);
  assert.deepEqual(await bridge.poll(client, 105), { request: null });
});
test("expired requests never change the application session", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "paseo-open-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(
    join(home, "open-request.json"),
    JSON.stringify({ id: randomUUID(), url: "http://localhost:8081/h/host/agent/a", createdAt: 0 }),
  );
  assert.deepEqual(
    await new OpenSessionBridge(home).poll(
      {
        clientId: randomUUID(),
        href: "http://localhost:8081/",
        standalone: true,
        appliedRequestId: null,
      },
      31000,
    ),
    { request: null },
  );
});
