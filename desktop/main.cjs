const { readFile, appendFile, writeFile } = require("node:fs/promises");
const { watchFile, unwatchFile } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");
const { fileURLToPath } = require("node:url");
const { launchPaseo } = require("./launch.cjs");

// Only metadata from the local plugin crosses this IPC. No daemon or pet token.
function allowedUrl(value, home) {
  try {
    const base = new URL(home);
    const url = new URL(value);
    if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
      return null;
    if (
      base.username ||
      base.password ||
      url.origin !== base.origin ||
      url.username ||
      url.password
    )
      return null;
    if (url.search || url.hash) return null;
    if (url.pathname !== "/" && !/^\/h\/[^/]+\/agent\/[^/]+$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function install({ app, ipcMain, BrowserWindow }, helperDir, launch = launchPaseo) {
  const statusPath = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "pet/status.json");
  const logPath = join(statusPath, "../navigation-events.jsonl");
  let status = null;
  const trusted = (event) => {
    try {
      return (
        event.senderFrame === event.sender.mainFrame &&
        resolve(fileURLToPath(new URL(event.senderFrame.url))) === resolve(helperDir, "index.html")
      );
    } catch {
      return false;
    }
  };
  const load = async () => {
    try {
      const data = JSON.parse(await readFile(statusPath, "utf8"));
      const navigation = data.navigation;
      status = navigation && allowedUrl(navigation.homeUrl, navigation.homeUrl) ? navigation : null;
    } catch {
      status = null;
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("paseo-pet:status", status);
    }
  };
  ipcMain.handle("paseo-pet:status", async (event) => (trusted(event) ? status : null));
  ipcMain.on("paseo-pet:rendered", (event, data) => {
    if (!trusted(event) || !data || typeof data !== "object") return;
    const bubbleUrl = allowedUrl(data.bubbleUrl, status?.homeUrl);
    void writeFile(
      join(statusPath, "../desktop-status.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          helperPid: process.pid,
          bubbleUrl,
          slot: String(data.slot || "").slice(0, 20),
          clickable: data.clickable === true,
          size: typeof data.size === "number" ? data.size : null,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    ).catch(() => {});
  });
  ipcMain.handle("paseo-pet:open", async (event, value) => {
    if (!trusted(event) || !status?.enabled) return false;
    const url = allowedUrl(value, status.homeUrl);
    if (!url) return false;
    const result = await launch(url);
    await appendFile(
      logPath,
      `${JSON.stringify({ at: new Date().toISOString(), ...result, url })}\n`,
      {
        mode: 0o600,
      },
    ).catch(() => {});
    return true;
  });
  watchFile(statusPath, { interval: 300, persistent: false }, () => void load());
  void load();
  app.once("will-quit", () => unwatchFile(statusPath));
}
module.exports = { allowedUrl, install };
