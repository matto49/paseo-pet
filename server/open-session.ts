import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { webHome } from "./navigation.ts";

interface Client {
  clientId: string;
  href: string;
  standalone: boolean;
  appliedRequestId: string | null;
}
interface Request {
  id: string;
  url: string;
  createdAt: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OpenSessionBridge {
  private home: string;
  private claimed = new Map<string, string>();
  private completed = new Set<string>();
  constructor(home: string) {
    this.home = home;
  }

  private async write(name: string, value: unknown) {
    await mkdir(this.home, { recursive: true });
    const temp = join(this.home, `${name}.${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temp, join(this.home, name));
  }

  async poll(
    client: Client,
    now = Date.now(),
  ): Promise<{ request: { id: string; url: string } | null }> {
    if (!client.standalone || new URL(client.href).origin !== new URL(webHome).origin)
      return { request: null };
    await this.write("open-client.json", { ...client, at: new Date(now).toISOString() });
    let request: Request;
    try {
      request = JSON.parse(await readFile(join(this.home, "open-request.json"), "utf8"));
    } catch {
      return { request: null };
    }
    if (
      !uuid.test(request.id) ||
      !Number.isFinite(request.createdAt) ||
      now - request.createdAt > 30000 ||
      request.createdAt > now + 1000
    )
      return { request: null };
    const target = new URL(request.url);
    if (
      target.origin !== new URL(webHome).origin ||
      !/^\/h\/[^/]+\/agent\/[^/]+$/.test(target.pathname) ||
      target.search ||
      target.hash ||
      target.username ||
      target.password
    )
      return { request: null };
    if (client.appliedRequestId === request.id) {
      this.completed.add(request.id);
      await this.write("open-result.json", {
        id: request.id,
        url: request.url,
        clientId: client.clientId,
        href: client.href,
        action: "navigate",
        target: "installed-pwa",
        at: new Date(now).toISOString(),
      });
      return { request: null };
    }
    if (this.completed.has(request.id)) return { request: null };
    const owner = this.claimed.get(request.id);
    if (owner && owner !== client.clientId) return { request: null };
    if (this.claimed.size > 100) this.claimed.clear();
    if (this.completed.size > 100) this.completed.clear();
    this.claimed.set(request.id, client.clientId);
    return { request: { id: request.id, url: request.url } };
  }
}
