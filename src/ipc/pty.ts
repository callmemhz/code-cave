import { invoke } from "@tauri-apps/api/core";

export interface PtySpawnArgs {
  nodeId: string;
  cwd: string;
  program: string;
  args: string[];
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export const ptySpawn = (a: PtySpawnArgs) => invoke<string>("pty_spawn", a as unknown as Record<string, unknown>);
export const ptyWrite = (nodeId: string, bytesB64: string) =>
  invoke<void>("pty_write", { nodeId, bytesB64 });
export const ptyResize = (nodeId: string, cols: number, rows: number) =>
  invoke<void>("pty_resize", { nodeId, cols, rows });
export const ptyKill = (nodeId: string) => invoke<void>("pty_kill", { nodeId });
export const ptySnapshot = (nodeId: string) => invoke<string>("pty_snapshot", { nodeId });
export const ptyIsAlive = (nodeId: string) => invoke<boolean>("pty_is_alive", { nodeId });

export const b64encode = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

export const b64decode = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
