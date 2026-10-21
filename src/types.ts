export type Settings = {
  source: "official" | "bmclapi";
  gameDirectory: string;
  javaPath: string;
  memoryMB: number;
  playerName: string;
  accountMode: "offline" | "microsoft";
  microsoftClientId: string;
  selectedVersion: string;
};
export type Version = {
  id: string;
  type: string;
  releaseTime: string;
  url: string;
};
export type Installed = {
  id: string;
  type: string;
  java: number;
  installedAt: string;
  arch: string;

};
export type Java = {
  path: string;
  version: string;
  major: number;
  arch: string;
};
export type Account = { name: string; id: string; type: "microsoft" };
export type Progress = {
  phase: string;
  detail: string;
  percent: number;
  version?: string;
  bytes?: number;
  totalBytes?: number;
  files?: number;
  totalFiles?: number;
  speed?: number;
};
export type Log = { time: string; text: string };
export type State = {
  settings: Settings;
  installed: Installed[];
  java: Java[];
  account: Account | null;
  busy: boolean;
  running: { id: string; pid: number } | null;
  progress: Progress | null;
  logs: Log[];
  platform: string;
  arch: string;
  totalMemory: number;
  appVersion: string;
};
export type Manifest = {
  latest: { release: string; snapshot: string };
  versions: Version[];
  cached?: boolean;
};
export type Device = {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
};
export interface MossAPI {
  state(): Promise<State>;
  manifest(): Promise<Manifest>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  pickDirectory(): Promise<string | null>;
  pickJava(): Promise<Java | null>;
  detectJava(): Promise<Java[]>;
  install(id: string): Promise<unknown>;
  launch(id: string): Promise<unknown>;
  cancel(): Promise<unknown>;
  installJava(major: number): Promise<unknown>;
  openFolder(id?: string): Promise<unknown>;
  login(): Promise<Device>;
  cancelLogin(): Promise<unknown>;
  logout(): Promise<unknown>;
  openLink(key: string): Promise<unknown>;
  windowControl(action: string): Promise<unknown>;
  onEvent(cb: (event: { type: string; data: any }) => void): () => void;
}
declare global {
  interface Window {
    moss?: MossAPI;
  }
}
