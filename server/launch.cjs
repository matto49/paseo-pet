const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { homedir } = require("node:os");
const { join, basename } = require("node:path");
const { randomUUID } = require("node:crypto");
const { mkdir, writeFile, rename, readFile } = require("node:fs/promises");
const execute = promisify(execFile);
const defaultApp = join(homedir(), "Applications/ego (lite) Apps.localized/Paseo.app");
const homeUrl = "http://localhost:8081/";

async function launchPaseo(value, options = {}) {
  const url = new URL(value);
  if (
    url.origin !== new URL(homeUrl).origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && !/^\/h\/[^/]+\/agent\/[^/]+$/.test(url.pathname))
  )
    throw new Error("不是当前 Paseo 应用的会话地址");
  const run = options.run || execute;
  const appPath = options.appPath || defaultApp;
  const { stdout } = await run("/usr/bin/plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    join(appPath, "Contents/Info.plist"),
  ]);
  const info = JSON.parse(stdout),
    appId = info.CrAppModeShortcutID;
  if (
    info.CrBundleIdentifier !== "com.citrolabs.ego.lite" ||
    !/^[a-p]{32}$/.test(appId) ||
    typeof info.CrAppModeUserDataDir !== "string" ||
    basename(info.CrAppModeUserDataDir) !== `_crx_${appId}` ||
    new URL(info.CrAppModeShortcutURL).origin !== url.origin
  )
    throw new Error("已安装的 Paseo 网页应用信息不匹配");
  const result = { target: "installed-pwa", appPath, appId, url: url.href, action: "focus" };
  if (url.pathname === "/") {
    await run("/usr/bin/open", ["-a", appPath]);
    return result;
  }
  const home = options.home || join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "pet");
  await mkdir(home, { recursive: true });
  const id = randomUUID(),
    temp = join(home, `open-request.${id}.tmp`);
  await writeFile(temp, JSON.stringify({ id, url: url.href, createdAt: Date.now() }), {
    mode: 0o600,
  });
  await rename(temp, join(home, "open-request.json"));
  await run("/usr/bin/open", ["-a", appPath]);
  const deadline = Date.now() + (options.timeoutMs ?? 15000);
  while (Date.now() < deadline) {
    try {
      const reply = JSON.parse(await readFile(join(home, "open-result.json"), "utf8"));
      if (reply.id === id)
        return { ...result, action: "navigate", clientId: reply.clientId, href: reply.href };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Paseo 应用尚未确认会话跳转，请确认应用中的 Paseo Pet 插件已加载");
}
module.exports = { launchPaseo };
