import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { allowedUrl, install } from "./main.cjs";

test("navigation accepts local web home and session routes, rejects other destinations", () => {
  const home = "http://localhost:8081/";
  assert.equal(allowedUrl(home, home), home);
  assert.equal(allowedUrl(`${home}h/host/agent/abc`, home), `${home}h/host/agent/abc`);
  for (const url of [
    "https://evil.test/",
    "javascript:alert(1)",
    "http://localhost:8082/",
    `${home}?token=secret`,
    `${home}settings`,
    "http://user:secret@localhost:8081/",
  ]) {
    assert.equal(allowedUrl(url, home), null);
  }
  assert.equal(allowedUrl("https://evil.test/", "https://evil.test/"), null);
});

test("only the trusted pet renderer may open links; successful dispatch is recorded", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "paseo-pet-ipc-"));
  const prior = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  let quit = () => {};
  t.after(async () => {
    quit();
    if (prior === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = prior;
    await rm(home, { recursive: true, force: true });
  });
  await mkdir(join(home, "pet"));
  const homeUrl = "http://localhost:8081/";
  await writeFile(
    join(home, "pet/status.json"),
    JSON.stringify({ navigation: { enabled: true, homeUrl } }),
  );
  const handlers = new Map(),
    opened = [];
  let loaded;
  const ready = new Promise((resolve) => {
    loaded = resolve;
  });
  install(
    {
      app: {
        once: (_name, fn) => {
          quit = fn;
        },
      },
      ipcMain: {
        handle: (name, fn) => handlers.set(name, fn),
        on: (name, fn) => handlers.set(name, fn),
      },
      BrowserWindow: {
        getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: () => loaded() } }],
      },
      shell: {
        openExternal: async (url) => {
          opened.push(url);
        },
      },
    },
    home,
  );
  await ready;
  const frame = { url: pathToFileURL(join(home, "index.html")).href };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  const open = handlers.get("paseo-pet:open");
  assert.equal(await open(event, `${homeUrl}h/host/agent/a`), true);
  assert.equal(await open(event, "https://evil.test/"), false);
  const other = { url: "https://evil.test/" };
  assert.equal(await open({ senderFrame: other, sender: { mainFrame: other } }, homeUrl), false);
  assert.deepEqual(opened, [`${homeUrl}h/host/agent/a`]);
  const record = JSON.parse(await readFile(join(home, "pet/navigation-events.jsonl"), "utf8"));
  assert.equal(record.url, opened[0]);
});
