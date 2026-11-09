import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { launchPaseo } from "./launch.cjs";

const appId = "lbaehcbhnmbondgneliilakpmdmkgdfp";
const info = {
  CrBundleIdentifier: "com.citrolabs.ego.lite",
  CrAppModeShortcutID: appId,
  CrAppModeShortcutURL: "http://localhost:8081/",
  CrAppModeUserDataDir: `/Users/test/ego/-/Web Applications/_crx_${appId}`,
};
async function fixture(t, metadata = info, ack = true) {
  const home = await mkdtemp(join(tmpdir(), "paseo-launch-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const calls = [];
  return {
    calls,
    home,
    options: {
      appPath: "/Users/test/Paseo.app",
      home,
      timeoutMs: 30,
      run: async (file, args) => {
        calls.push({ file, args });
        if (file === "/usr/bin/open" && ack) {
          try {
            const r = JSON.parse(await readFile(join(home, "open-request.json"), "utf8"));
            await writeFile(
              join(home, "open-result.json"),
              JSON.stringify({
                id: r.id,
                clientId: "installed-window",
                href: "http://localhost:8081/h/host/workspace/a",
              }),
            );
          } catch {}
        }
        return { stdout: JSON.stringify(metadata) };
      },
    },
  };
}
test("double click raises the installed app without opening a browser tab", async (t) => {
  const f = await fixture(t);
  const r = await launchPaseo("http://localhost:8081/", f.options);
  assert.equal(r.action, "focus");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.at(-1), {
    file: "/usr/bin/open",
    args: ["-a", "/Users/test/Paseo.app"],
  });
});
test("a session request waits for the installed window to confirm its own navigation", async (t) => {
  const f = await fixture(t),
    url = "http://localhost:8081/h/host/agent/task-a";
  const r = await launchPaseo(url, f.options);
  assert.equal(r.action, "navigate");
  assert.equal(r.clientId, "installed-window");
  assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(await readFile(join(f.home, "open-request.json"), "utf8")).url, url);
});
test("unrelated links and mismatched installed apps cannot launch", async (t) => {
  const f = await fixture(t);
  await assert.rejects(launchPaseo("https://evil.test/", f.options));
  assert.equal(f.calls.length, 0);
  const other = await fixture(t, { ...info, CrAppModeShortcutURL: "https://evil.test/" });
  await assert.rejects(launchPaseo("http://localhost:8081/", other.options), /不匹配/);
  assert.equal(other.calls.length, 1);
});
test("a missing installed client reports failure without falling back to a browser tab", async (t) => {
  const f = await fixture(t, info, false);
  await assert.rejects(launchPaseo("http://localhost:8081/h/host/agent/a", f.options), /尚未确认/);
  assert.equal(f.calls.length, 2);
});
