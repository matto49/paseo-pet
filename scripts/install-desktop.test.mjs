import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installDesktop } from "./install-desktop.mjs";

test("installation backs up the original helper, is repeatable, and checks its version", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "paseo-pet-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = join(root, "runtime/electron-helper");
  await mkdir(helper, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "dsh-pet", version: "0.4.3" }),
  );
  await writeFile(join(helper, "main.js"), "main();");
  await writeFile(join(helper, "preload.js"), "preload();");
  await writeFile(join(helper, "index.html"), '<script src="./renderer.js"></script>');
  const first = await installDesktop(root, join(root, "backups"));
  assert.equal(first.patched, 3);
  assert.equal(await readFile(join(first.backup, "main.js"), "utf8"), "main();");
  const main = await readFile(join(helper, "main.js"), "utf8");
  const second = await installDesktop(root, join(root, "backups"));
  assert.equal(second.patched, 0);
  assert.equal(await readFile(join(helper, "main.js"), "utf8"), main);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "dsh-pet", version: "99" }));
  await assert.rejects(installDesktop(root, root), /0.4.3/);
});
