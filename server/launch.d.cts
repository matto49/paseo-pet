export interface LaunchResult {
  target: "installed-pwa";
  appPath: string;
  appId: string;
  url: string;
  action: string;
}
export function launchPaseo(url: string): Promise<LaunchResult>;
