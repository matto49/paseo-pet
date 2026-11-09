import assert from "node:assert/strict";
import test from "node:test";
import type { PaseoAgentListResult, PaseoApi, SubscriptionObserver } from "@getpaseo/client";
import { observeAgents } from "./agents.ts";
import type { AgentSnapshot } from "./model.ts";
import { PetModel } from "./model.ts";

const agent = { id: "a", title: "任务 A", status: "running" };
const page = (agents: AgentSnapshot[], cursor: string | null = null) => ({
  entries: agents.map((agent) => ({ agent })),
  pageInfo: { hasMore: !!cursor, nextCursor: cursor, prevCursor: null },
});

function fixture(first = page([agent])) {
  let update: (event: unknown) => void = () => {};
  let observer: SubscriptionObserver<PaseoAgentListResult> | undefined;
  let released = 0;
  let removed = 0;
  let next = page([]);
  let beforeList = () => {};
  const subscription = {
    release: async () => {
      released += 1;
    },
    subscribe: (value: SubscriptionObserver<PaseoAgentListResult>) => {
      observer = value;
      value.snapshot(first as PaseoAgentListResult);
      return () => {
        observer = undefined;
      };
    },
  };
  const api = {
    agents: {
      subscribe: (fn: (event: unknown) => void) => {
        update = fn;
        return () => {
          removed += 1;
        };
      },
      list: async (options: { subscribe?: unknown }) => {
        beforeList();
        return options.subscribe ? { ...first, subscription } : next;
      },
      ref: () => ({ address: { serverId: "host-test" } }),
    },
  } as unknown as PaseoApi;
  return {
    api,
    send: (agent: AgentSnapshot) => update({ kind: "upsert", agent }),
    restore: (agents: AgentSnapshot[]) => observer?.snapshot(page(agents) as PaseoAgentListResult),
    beforeList: (fn: () => void) => {
      beforeList = fn;
    },
    nextPage: (agents: AgentSnapshot[]) => {
      next = page(agents);
    },
    released: () => released,
    removed: () => removed,
  };
}

test("live permission event wins over an older bootstrap snapshot", async () => {
  const f = fixture();
  f.beforeList(() => f.send({ ...agent, pendingPermissions: [{ id: "p" }] }));
  const m = new PetModel();
  const close = await observeAgents(
    f.api,
    m,
    new AbortController().signal,
    () => {},
    () => {},
    () => {},
  );
  assert.equal(m.snapshot().state, "waiting");
  await close();
  assert.equal(f.released(), 1);
  assert.equal(f.removed(), 1);
});

test("bootstrap follows pagination instead of losing an older running task", async () => {
  const f = fixture(page([{ ...agent, status: "idle" }], "page-2"));
  f.nextPage([{ id: "b", title: "第二页任务", status: "running" }]);
  const m = new PetModel();
  const close = await observeAgents(
    f.api,
    m,
    new AbortController().signal,
    () => {},
    () => {},
    () => {},
  );
  assert.equal(m.snapshot().agentId, "b");
  await close();
});

test("reconnection removes vanished work and updates remaining agents", async () => {
  const f = fixture();
  const m = new PetModel();
  let connections = 0;
  const close = await observeAgents(
    f.api,
    m,
    new AbortController().signal,
    () => {
      connections += 1;
    },
    () => {},
    () => {},
  );
  assert.equal(m.snapshot().state, "working");
  f.restore([{ id: "b", status: "running", pendingPermissions: [{ id: "p" }] }]);
  assert.equal(m.snapshot().agentId, "b");
  assert.equal(m.snapshot().running, 0);
  assert.equal(connections, 2);
  await close();
});
