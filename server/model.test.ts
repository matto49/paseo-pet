import assert from "node:assert/strict";
import test from "node:test";
import { PetModel } from "./model.ts";

const agent = { id: "a", title: "任务 A", provider: "codex" };
const other = { id: "b", title: "任务 B", provider: "claude" };

test("another task finishing cannot hide a running or waiting task", () => {
  const m = new PetModel();
  m.start(agent, "a1", 0);
  m.start(other, "b1", 1);
  m.finish(other, "b1", "completed", 2);
  assert.equal(m.snapshot(3).agentId, "a");
  m.ask(agent, "p1", 3);
  assert.equal(m.snapshot(4).state, "waiting");
  m.answer("a", "p1");
  assert.equal(m.snapshot(5).state, "working");
});

test("resolving one of several permissions does not release the other", () => {
  const m = new PetModel();
  m.start(agent, "a1", 0);
  m.ask(agent, "p1", 1);
  m.ask(agent, "p2", 2);
  m.answer("a", "p1");
  assert.equal(m.snapshot(3).state, "waiting");
  m.answer("a", "unknown");
  assert.equal(m.snapshot(4).state, "waiting");
  m.answer("a", "p2");
  assert.equal(m.snapshot(5).state, "working");
});

test("late turn completion cannot overwrite a newer turn", () => {
  const m = new PetModel();
  m.start(agent, "new", 0);
  assert.equal(m.finish(agent, "old", "completed", 1), false);
  assert.equal(m.snapshot(2).state, "working");
});

test("startup idle agents do not celebrate; subagents do not own the pet", () => {
  const m = new PetModel();
  m.observe({ ...agent, status: "idle" }, 0);
  m.start({ ...other, parentAgentId: "a" }, "child", 1);
  assert.equal(m.snapshot(2).state, null);
  m.observe({ ...agent, status: "running", pendingPermissions: [{ id: "p1" }] }, 3);
  assert.equal(m.snapshot(4).state, "waiting");
});

test("completion expires to idle; canceled and archived work clears immediately", () => {
  const m = new PetModel();
  m.start(agent, "a1", 0);
  m.finish(agent, "a1", "completed", 1);
  m.observe({ ...agent, status: "idle" }, 2);
  assert.equal(m.snapshot(3).state, "success");
  assert.equal(m.snapshot(10_002).state, null);
  m.start(agent, "a2", 11_000);
  m.finish(agent, "a2", "canceled", 11_001);
  assert.equal(m.snapshot(11_002).state, null);
  m.start(agent, "a3", 12_000);
  m.observe({ ...agent, status: "closed", archivedAt: "today" }, 12_001);
  assert.equal(m.snapshot(12_002).state, null);
});

test("bubble text stays within the desktop API limit without splitting emoji", () => {
  const m = new PetModel();
  m.start({ ...agent, title: "😀".repeat(80) }, "a1", 0);
  const task = m.snapshot(1).task || "";
  assert.equal(Array.from(task).length, 40);
  assert.equal(task.includes("\uFFFD"), false);
});

test("unread completion is not a permission request; attention errors remain errors", () => {
  const m = new PetModel();
  m.observe({ ...agent, status: "idle", requiresAttention: true, attentionReason: "finished" }, 0);
  assert.equal(m.snapshot(1).state, null);
  m.observe({ ...agent, status: "idle", requiresAttention: true, attentionReason: "error" }, 2);
  assert.equal(m.snapshot(3).state, "error");
});

test("authoritative snapshots release resolved permissions and advance initialization", () => {
  const m = new PetModel();
  m.observe({ ...agent, status: "initializing" }, 0);
  assert.equal(m.snapshot(1).state, "thinking");
  m.observe({ ...agent, status: "running", pendingPermissions: [{ id: "p" }] }, 2);
  assert.equal(m.snapshot(3).state, "waiting");
  m.observe({ ...agent, status: "running", pendingPermissions: [] }, 4);
  assert.equal(m.snapshot(5).state, "working");
});
