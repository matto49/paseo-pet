export const webHome = "http://localhost:8081/";

export function webSession(serverId: string | null, agentId: string | null) {
  if (!serverId || !agentId) return null;
  return `${webHome}h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}

export interface PetNotification {
  id: number;
  text: string;
  url: string | null;
  expiresAt: number;
}
