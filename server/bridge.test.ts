import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PaseoPetBridge } from "./bridge.ts";
import { PetClient } from "./pet.ts";

test("providers without turn IDs notify once per turn, including later turns", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "paseo-pet-bridge-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const pet = new PetClient(home);
  const messages: string[] = [];
  pet.say = async (text) => {
    messages.push(text);
  };
  pet.sync = async () => {};
  pet.release = async () => {};
  const bridge = new PaseoPetBridge(pet, join(home, "status.json"));
  const agent = { id: "test", provider: "claude" };
  bridge.started(agent, null);
  bridge.completed(agent, null, "completed");
  bridge.completed(agent, null, "completed");
  assert.equal(messages.length, 1);
  bridge.started(agent, null);
  bridge.completed(agent, null, "completed");
  assert.equal(messages.length, 2);
  await bridge.stop();
  const status = JSON.parse(await readFile(join(home, "status.json"), "utf8"));
  assert.equal(status.connected, false);
  assert.equal(status.state, null);
  assert.equal(status.lastEvent, "plugin.stopped");
});
