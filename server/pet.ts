import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DisplayState } from "./model.ts";

const execute = promisify(execFile);
const owner = "Paseo";
export const menuLabels = ["打开 Paseo", "打开当前会话", "刷新联动状态"];

interface Runtime {
  name: string;
  pid: number;
  port: number;
  token: string;
}

export class PetClient {
  private identity = "";
  private lastDisplay = "";
  private registered = false;
  readonly home: string;
  readonly fetcher: typeof fetch;

  constructor(
    home = process.env.DSH_HOME || join(homedir(), ".dsh"),
    fetcher: typeof fetch = fetch,
  ) {
    this.home = home;
    this.fetcher = fetcher;
  }

  private async runtime(): Promise<Runtime> {
    const value = JSON.parse(
      await readFile(join(this.home, "dsh-pet/standalone-runtime.json"), "utf8"),
    ) as Runtime;
    if (
      value.name !== "dsh-pet-standalone" ||
      !Number.isInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535 ||
      !Number.isInteger(value.pid) ||
      value.pid < 1 ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.token)
    )
      throw new Error("桌宠运行信息无效");
    const identity = `${value.pid}:${value.port}:${value.token}`;
    if (identity !== this.identity) {
      this.identity = identity;
      this.registered = false;
      this.lastDisplay = "";
    }
    return value;
  }

  async request(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const runtime = await this.runtime();
    const response = await this.fetcher(`http://127.0.0.1:${runtime.port}/dsh-pet-7340/${path}`, {
      method,
      headers: { "x-dsh-pet-token": runtime.token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (!response.ok) {
      this.registered = false;
      this.lastDisplay = "";
      throw new Error(`桌宠接口 ${path.split("?")[0]}: HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    const result = (await response.json()) as { ok?: boolean; reason?: string };
    if (result?.ok === false) {
      if (result.reason === "unknown-owner") {
        this.registered = false;
        this.lastDisplay = "";
      }
      throw new Error(`桌宠接口 ${path.split("?")[0]}: ${result.reason ?? "failed"}`);
    }
    return result;
  }

  async ensureRunning() {
    try {
      await this.request("config");
      return;
    } catch {
      if (process.platform !== "darwin") throw new Error("请先启动 dsh-pet-standalone");
    }
    await execute("/usr/bin/open", [join(homedir(), "Applications/DSH Pet.app")]);
  }

  async sync(display: DisplayState) {
    await this.runtime();
    if (!this.registered) {
      await this.request("menu/item", "POST", { owner, labels: menuLabels, target: "desktop" });
      this.registered = true;
    }
    const signature = JSON.stringify(display);
    if (signature !== this.lastDisplay) {
      if (display.state)
        await this.request("work-status", "POST", { state: display.state, task: display.task });
      else await this.request("work-status", "DELETE");
      this.lastDisplay = signature;
    }
  }

  async poll(signal: AbortSignal): Promise<Record<string, string | null>> {
    const result = (await this.request(
      `menu/events?owner=${owner}&wait=10000`,
      "GET",
      undefined,
      signal,
    )) as {
      events: Record<string, string | null>;
    };
    return result.events;
  }

  async say(text: string) {
    await this.request("broadcast?pet=main", "POST", { text, duration: 6000, anim: false });
  }

  async release() {
    await this.request(`menu/item?owner=${owner}`, "DELETE");
    await this.request("work-status", "DELETE");
  }
}
