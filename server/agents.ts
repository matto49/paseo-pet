import type { PaseoAgentListResult, PaseoApi } from "@getpaseo/client";
import type { PetModel } from "./model.ts";

// The owned subscription restores itself when the SDK reconnects. Each restored
// snapshot replaces membership, including agents that disappeared while offline.
export async function observeAgents(
  paseo: PaseoApi,
  model: PetModel,
  signal: AbortSignal,
  connected: (serverId: string | null) => void,
  changed: () => void,
  failed: () => void,
): Promise<() => Promise<void>> {
  let closed = false;
  let revision = 0;
  let changes = new Set<string>();
  let subscription: PaseoAgentListResult["subscription"];
  let unsubscribeSnapshots = () => {};
  const unsubscribe = paseo.agents.subscribe((update) => {
    if (closed || signal.aborted) return;
    const id = update.kind === "upsert" ? update.agent.id : update.agentId;
    changes.add(id);
    if (update.kind === "upsert") model.observe(update.agent);
    else model.remove(id);
    changed();
  });
  const cleanup = async () => {
    closed = true;
    revision += 1;
    signal.removeEventListener("abort", abort);
    unsubscribe();
    unsubscribeSnapshots();
    await subscription?.release();
  };
  const abort = () => {
    void cleanup().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const hydrate = async (first: PaseoAgentListResult, updated: Set<string>) => {
    const current = ++revision;
    const members = new Set<string>();
    const cursors = new Set<string>();
    let page = first;
    for (;;) {
      if (closed || signal.aborted || current !== revision) return;
      for (const { agent } of page.entries) {
        members.add(agent.id);
        if (!updated.has(agent.id)) model.observe(agent);
      }
      if (!page.pageInfo.hasMore) break;
      const cursor = page.pageInfo.nextCursor;
      if (!cursor || cursors.has(cursor)) throw new Error("Paseo 会话分页游标无效");
      cursors.add(cursor);
      page = await paseo.agents.list({ page: { limit: 200, cursor } });
    }
    if (closed || signal.aborted || current !== revision) return;
    for (const id of updated) members.add(id);
    model.retain(members);
    changes = new Set();
    const firstId = first.entries[0]?.agent.id;
    connected(firstId ? paseo.agents.ref(firstId).address.serverId : null);
  };
  try {
    const listing = await paseo.agents.list({ subscribe: {}, page: { limit: 200 } });
    subscription = listing.subscription;
    if (closed || signal.aborted) {
      await cleanup();
      return cleanup;
    }
    let initial = true;
    let bootstrap = Promise.resolve();
    unsubscribeSnapshots = subscription.subscribe({
      snapshot(snapshot) {
        // The first replay must preserve events received while awaiting list().
        if (initial) {
          initial = false;
          bootstrap = hydrate(snapshot, changes);
          return;
        }
        changes = new Set();
        void hydrate(snapshot, changes).catch(failed);
      },
      update() {},
      error: failed,
    });
    await bootstrap;
    return cleanup;
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}
