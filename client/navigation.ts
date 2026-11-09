import type { PluginClientContext } from "@getpaseo/plugin/client";
import { openSession } from "../shared/open-session.ts";

export function connectInstalledApp(client: PluginClientContext) {
  if (
    typeof window === "undefined" ||
    window.location.origin !== "http://localhost:8081" ||
    !window.matchMedia("(display-mode: standalone)").matches
  )
    return () => {};
  const clientId = window.crypto.randomUUID();
  const key = "paseo-pet-open-request";
  let stopped = false,
    navigating = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      let appliedRequestId: string | null = null;
      try {
        const marker = JSON.parse(window.sessionStorage.getItem(key) || "null");
        if (marker && marker.clientId !== clientId) appliedRequestId = marker.id;
      } catch {}
      const { request } = await client.rpc(openSession, {
        clientId,
        href: window.location.href,
        standalone: true,
        appliedRequestId,
      });
      if (stopped) return;
      if (request) {
        const url = new URL(request.url);
        if (
          url.origin !== window.location.origin ||
          !/^\/h\/[^/]+\/agent\/[^/]+$/.test(url.pathname)
        )
          throw new Error("会话跳转地址无效");
        window.sessionStorage.setItem(key, JSON.stringify({ id: request.id, clientId }));
        navigating = true;
        window.location.assign(url.href);
      }
    } catch {
      // A missing daemon or hot reload retries on the next poll.
    } finally {
      if (!stopped && !navigating) timer = setTimeout(() => void poll(), 750);
    }
  };
  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
