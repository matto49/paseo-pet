export type PetState = "thinking" | "working" | "waiting" | "success" | "error";

export interface AgentInfo {
  id: string;
  title?: string | null;
  provider?: string;
  parentAgentId?: string | null;
  archivedAt?: string | Date | null;
}

export interface AgentSnapshot extends AgentInfo {
  status: string;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissions?: readonly { id: string }[];
}

interface Entry {
  agent: AgentInfo;
  state: PetState;
  turnId: string | null;
  requests: Set<string>;
  order: number;
  expiresAt: number | null;
}

const priority: Record<PetState, number> = {
  waiting: 60,
  error: 50,
  working: 40,
  thinking: 30,
  success: 20,
};

export interface DisplayState {
  state: PetState | null;
  task: string | null;
  agentId: string | null;
  running: number;
  waiting: number;
}

export class PetModel {
  private entries = new Map<string, Entry>();
  private sequence = 0;

  private set(agent: AgentInfo, state: PetState, turnId: string | null, now: number) {
    if (agent.parentAgentId || agent.archivedAt) return;
    this.entries.set(agent.id, {
      agent,
      state,
      turnId,
      requests: new Set(),
      order: ++this.sequence,
      expiresAt: state === "success" ? now + 10_000 : state === "error" ? now + 30_000 : null,
    });
  }

  start(agent: AgentInfo, turnId: string | null, now = Date.now()) {
    this.set(agent, "working", turnId, now);
  }

  finish(agent: AgentInfo, turnId: string | null, outcome: string, now = Date.now()) {
    const previous = this.entries.get(agent.id);
    if (previous?.turnId && turnId && previous.turnId !== turnId) return false;
    if (outcome === "canceled") this.remove(agent.id);
    else this.set(agent, outcome === "completed" ? "success" : "error", turnId, now);
    return !agent.parentAgentId && !agent.archivedAt;
  }

  ask(agent: AgentInfo, requestId: string, now = Date.now()) {
    const previous = this.entries.get(agent.id);
    if (!previous) this.set(agent, "waiting", null, now);
    const entry = this.entries.get(agent.id);
    if (!entry) return;
    entry.agent = agent;
    entry.requests.add(requestId);
    entry.state = "waiting";
    entry.expiresAt = null;
    entry.order = ++this.sequence;
  }

  answer(agentId: string, requestId: string) {
    const entry = this.entries.get(agentId);
    if (!entry?.requests.delete(requestId)) return;
    if (entry.requests.size === 0) entry.state = "working";
  }

  observe(agent: AgentSnapshot, now = Date.now()) {
    if (agent.parentAgentId || agent.archivedAt) {
      this.remove(agent.id);
      return;
    }
    const old = this.entries.get(agent.id);
    const waiting =
      (agent.pendingPermissions?.length ?? 0) > 0 || agent.attentionReason === "permission";
    if (waiting) {
      this.set(agent, "waiting", old?.turnId ?? null, now);
      const entry = this.entries.get(agent.id);
      for (const request of agent.pendingPermissions ?? []) entry?.requests.add(request.id);
    } else if (agent.status === "error" || agent.attentionReason === "error") {
      if (old?.state !== "error") this.set(agent, "error", old?.turnId ?? null, now);
    } else if (agent.status === "running" || agent.status === "initializing") {
      const state = agent.status === "running" ? "working" : "thinking";
      if (old?.state === state) {
        old.agent = agent;
      } else this.set(agent, state, old?.turnId ?? null, now);
    } else if (old && old.state !== "success" && old.state !== "error") this.remove(agent.id);
  }

  remove(agentId: string) {
    this.entries.delete(agentId);
  }

  retain(agentIds: ReadonlySet<string>) {
    for (const id of this.entries.keys()) {
      if (!agentIds.has(id)) this.entries.delete(id);
    }
  }

  snapshot(now = Date.now()): DisplayState {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.entries.delete(id);
    }
    const entries = [...this.entries.values()];
    const best = entries.sort(
      (a, b) => priority[b.state] - priority[a.state] || b.order - a.order,
    )[0];
    const running = entries.filter((e) => e.state === "working" || e.state === "thinking").length;
    const waiting = entries.filter((e) => e.state === "waiting").length;
    if (!best) return { state: null, task: null, agentId: null, running, waiting };
    const labels: Record<PetState, string> = {
      thinking: "正在准备",
      working: "正在工作",
      waiting: "等你确认",
      success: "本轮完成",
      error: "执行出错",
    };
    const title = (best.agent.title || best.agent.provider || "会话").replace(/[\r\n\t]/g, " ");
    const count = running > 1 ? ` · ${running} 个任务运行中` : "";
    const task = Array.from(`Paseo · ${labels[best.state]} · ${title}${count}`)
      .slice(0, 40)
      .join("");
    return { state: best.state, task, agentId: best.agent.id, running, waiting };
  }
}
