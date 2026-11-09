import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sources = resolve(dirname(fileURLToPath(import.meta.url)), "../desktop");
export async function installDesktop(root, backupRoot) {
  const packageInfo = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (packageInfo.name !== "dsh-pet" || packageInfo.version !== "0.4.3") {
    throw new Error("桌面适配器目前仅验证了 dsh-pet 0.4.3，请先检查新版本接口");
  }
  const helper = join(root, "runtime/electron-helper");
  const patches = [
    ["main.js", "require('./paseo-pet/main.cjs').install(electronApi, __dirname);", null],
    ["preload.js", "require('./paseo-pet/preload.cjs');", null],
    [
      "index.html",
      '<script src="./paseo-pet/renderer.js"></script>',
      '<script src="./renderer.js"></script>',
    ],
  ];
  const edits = [];
  for (const [name, insert, anchor] of patches) {
    const text = await readFile(join(helper, name), "utf8");
    if (text.includes(insert)) continue;
    if (anchor && text.split(anchor).length !== 2) throw new Error(`找不到唯一的 ${name} 挂载位置`);
    edits.push({
      name,
      before: text,
      after: anchor
        ? text.replace(anchor, `${insert}\n    ${anchor}`)
        : `${text}\n// Paseo Pet navigation adapter\n${insert}\n`,
    });
  }
  const backup = join(backupRoot, `dsh-pet-0.4.3-${Date.now()}`);
  if (edits.length) {
    await mkdir(backup, { recursive: true });
    for (const edit of edits) await writeFile(join(backup, edit.name), edit.before);
  }
  await mkdir(join(helper, "paseo-pet"), { recursive: true });
  for (const name of ["main.cjs", "preload.cjs", "renderer.js", "launch.cjs"]) {
    const source = name === "launch.cjs" ? join(sources, "../server", name) : join(sources, name);
    await copyFile(source, join(helper, "paseo-pet", name));
  }
  for (const edit of edits) await writeFile(join(helper, edit.name), edit.after);
  return { helper, patched: edits.length, backup: edits.length ? backup : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let root;
  try {
    root = dirname(createRequire(import.meta.url).resolve("dsh-pet/package.json"));
  } catch {
    root = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "dsh-pet");
  }
  const result = await installDesktop(
    root,
    join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "pet/backups"),
  );
  console.log(JSON.stringify(result, null, 2));
  console.log("适配器已安装。重新启动桌宠即可生效；不需要重启 Paseo。");
}
