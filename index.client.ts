import type { PluginClientContext } from "@getpaseo/plugin/client";
import { monitor } from "./shared/monitor.ts";

// The server owns the observation, so closing the app does not stop the pet.
export default function contribute(client: PluginClientContext) {
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    void client.rpc(monitor, {}).catch(() => {
      if (!stopped) retry = setTimeout(connect, 3000);
    });
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
  };
}
