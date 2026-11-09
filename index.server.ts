import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PaseoPetBridge } from "./server/bridge.ts";
import { OpenSessionBridge } from "./server/open-session.ts";
import { monitor } from "./shared/monitor.ts";
import { openSession } from "./shared/open-session.ts";

export default function contribute(server: PluginServerContext) {
  const bridge = new PaseoPetBridge();
  const navigation = new OpenSessionBridge(
    join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "pet"),
  );
  server.handle(openSession, (input) => navigation.poll(input));
  server.handle(monitor, async (_input, context) => {
    await bridge.connect(context.paseo);
    return { connected: true };
  });
  server.addHook("agent.turn.before", async ({ agent, turnId }) => {
    bridge.started(agent, turnId);
  });
  server.addHook("agent.turn.after", async ({ agent, turnId, outcome }) => {
    bridge.completed(agent, turnId, outcome.kind);
  });
  server.addHook("agent.permission.before", async ({ agent, request }) => {
    bridge.model.ask(agent, request.id);
    bridge.event("agent.permission.before");
  });
  server.addHook("agent.permission.after", async ({ agent, requestId }) => {
    bridge.model.answer(agent.id, requestId);
    bridge.event("agent.permission.after");
  });
  server.addHook("agent.close.after", async ({ agent }) => {
    bridge.model.remove(agent.id);
    bridge.event("agent.close.after");
  });
  server.addHook("agent.archive.after", async ({ agent }) => {
    bridge.model.remove(agent.id);
    bridge.event("agent.archive.after");
  });
  bridge.start();
  return () => bridge.stop();
}
