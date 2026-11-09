import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { observeAgents } from "./agents.ts";
import { launchPaseo } from "./launch.cjs";
import type { AgentInfo, DisplayState } from "./model.ts";
import { PetModel } from "./model.ts";
import { type PetNotification, webHome, webSession } from "./navigation.ts";
import { PetClient } from "./pet.ts";

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

export class PaseoPetBridge {
  readonly model = new PetModel();
  private pet: PetClient;
  private controller = new AbortController();
  private timer: ReturnType<typeof setInterval> | undefined;
  private flush: Promise<void> | undefined;
  private dirty = false;
  private serverId: string | null = null;
  private observers = 0;
  private latestEvent = "startup";
  private latestError: string | null = null;
  private warned = "";
  private seen = new Set<string>();
  private connection: Promise<void> | undefined;
  private disconnect: (() => Promise<void>) | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private statusPath: string;
  private notification: PetNotification | null = null;
  private notificationSequence = Date.now();

  constructor(
    pet = new PetClient(),
    statusPath = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "pet/status.json"),
  ) {
    this.pet = pet;
    this.statusPath = statusPath;
  }

  start() {
    void this.pet.ensureRunning().catch(() => this.warn("请启动本机桌宠"));
    this.timer = setInterval(() => this.schedule(), 2500);
    this.schedule();
    void this.consumeMenus();
  }

  event(name: string) {
    this.latestEvent = name;
    this.schedule();
  }

  started(agent: AgentInfo, turnId: string | null) {
    // Some providers have no turn ID. Their next start opens a new notification.
    for (const outcome of ["completed", "failed", "canceled"]) {
      this.seen.delete(`${agent.id}:unknown:${outcome}`);
    }
    this.model.start(agent, turnId);
    this.event("agent.turn.before");
  }

  completed(agent: AgentInfo, turnId: string | null, outcome: string) {
    const key = `${agent.id}:${turnId ?? "unknown"}:${outcome}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value ?? "");
    if (!this.model.finish(agent, turnId, outcome)) return;
    this.event(`agent.turn.after:${outcome}`);
    // Only a real lifecycle completion gets a completion bubble, never a startup idle snapshot.
    if (outcome !== "canceled") {
      const title = Array.from(agent.title || agent.provider || "会话")
        .slice(0, 24)
        .join("");
      const text = `Paseo · ${title}：${outcome === "completed" ? "本轮完成" : "执行出错"}`;
      this.notification = {
        id: ++this.notificationSequence,
        text,
        url: webSession(this.serverId, agent.id),
        expiresAt: Date.now() + 10_000,
      };
      this.schedule();
      void this.pet.say(text).catch(() => this.warn("桌宠暂时不可达，联动稍后重连"));
    }
  }

  connect(paseo: PaseoApi) {
    this.connection ??= this.observe(paseo).catch((error) => {
      this.connection = undefined;
      throw error;
    });
    return this.connection;
  }

  private async observe(paseo: PaseoApi) {
    this.disconnect = await observeAgents(
      paseo,
      this.model,
      this.controller.signal,
      (serverId) => {
        if (serverId) this.serverId = serverId;
        this.observers = 1;
        this.event("paseo.connected");
      },
      () => this.event("agent.snapshot"),
      () => {
        this.observers = 0;
        this.event("paseo.disconnected");
        if (this.retry || this.controller.signal.aborted) return;
        this.retry = setTimeout(() => {
          this.retry = undefined;
          void this.reconnect(paseo);
        }, 3000);
      },
    );
    console.log("[paseo-pet] Connected to live Paseo agents");
  }

  private async reconnect(paseo: PaseoApi) {
    await this.disconnect?.().catch(() => {});
    this.connection = undefined;
    if (this.controller.signal.aborted) return;
    await this.connect(paseo).catch(() => {
      if (!this.controller.signal.aborted) {
        this.retry = setTimeout(() => {
          this.retry = undefined;
          void this.reconnect(paseo);
        }, 3000);
      }
    });
  }

  schedule() {
    if (this.controller.signal.aborted) return;
    this.dirty = true;
    if (this.flush) return;
    this.flush = this.drain().finally(() => {
      this.flush = undefined;
      if (this.dirty) this.schedule();
    });
  }

  private async drain() {
    while (this.dirty && !this.controller.signal.aborted) {
      this.dirty = false;
      const display = this.model.snapshot();
      try {
        await this.pet.sync(display);
        this.latestError = null;
        this.warned = "";
      } catch {
        this.latestError = "桌宠暂时不可达";
        this.warn("桌宠暂时不可达，联动稍后重连");
      }
      await this.writeStatus(display).catch(() => this.warn("无法写入桌宠联动状态"));
    }
  }

  private async writeStatus(display: DisplayState) {
    await mkdir(join(this.statusPath, ".."), { recursive: true });
    await writeFile(
      `${this.statusPath}.tmp`,
      JSON.stringify(
        {
          ...display,
          navigation: {
            enabled: !this.controller.signal.aborted,
            homeUrl: webHome,
            work: {
              task: display.task,
              state: display.state,
              url: webSession(this.serverId, display.agentId),
            },
            notification: this.notification,
          },
          serverId: this.serverId,
          connected: this.observers > 0,
          lastEvent: this.latestEvent,
          error: this.latestError,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await rename(`${this.statusPath}.tmp`, this.statusPath);
  }

  private warn(message: string) {
    if (this.warned === message) return;
    this.warned = message;
    console.warn(`[paseo-pet] ${message}`);
  }

  private async consumeMenus() {
    const signal = this.controller.signal;
    while (!signal.aborted) {
      try {
        const events = await this.pet.poll(signal);
        if (signal.aborted) break;
        if (events["打开 Paseo"]) await launchPaseo(webHome);
        if (events["打开当前会话"]) {
          const selected = this.model.snapshot();
          await launchPaseo(webSession(this.serverId, selected.agentId) || webHome);
          console.log(`[paseo-pet] Opened Paseo agent ${selected.agentId || "home"}`);
          this.event("menu.open-current");
        }
        if (events["刷新联动状态"]) {
          this.schedule();
          const display = this.model.snapshot();
          await this.pet.say(display.task || "Paseo 已连接，当前没有运行中的任务");
        }
      } catch {
        await pause(1500, signal);
      }
    }
  }

  async stop() {
    this.controller.abort();
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    await this.disconnect?.().catch(() => {});
    await this.flush;
    this.observers = 0;
    this.model.retain(new Set());
    this.latestEvent = "plugin.stopped";
    this.latestError = null;
    await this.writeStatus(this.model.snapshot()).catch(() => {});
    await this.pet.release().catch(() => {});
  }
}
