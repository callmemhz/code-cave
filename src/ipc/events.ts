import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface PtyDataEvent { node_id: string; bytes_b64: string; }
export interface PtyExitEvent { node_id: string; code: number | null; }

export const onPtyData = (nodeId: string, cb: (e: PtyDataEvent) => void): Promise<UnlistenFn> =>
  listen<PtyDataEvent>(`pty:data:${nodeId}`, (ev) => cb(ev.payload));

export const onPtyExit = (nodeId: string, cb: (e: PtyExitEvent) => void): Promise<UnlistenFn> =>
  listen<PtyExitEvent>(`pty:exit:${nodeId}`, (ev) => cb(ev.payload));
