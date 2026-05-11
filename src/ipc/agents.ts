import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AgentKind = "claude" | "codex";

export interface AgentSpawnArgs {
  nodeId: string;
  kind: AgentKind;
  cwd: string;
  extraArgs: string[];
  resumeId: string | null;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export const agentSpawn = (args: AgentSpawnArgs) =>
  invoke<void>("agent_spawn", args as unknown as Record<string, unknown>);

export const onAgentSession = (
  nodeId: string, cb: (id: string) => void,
): Promise<UnlistenFn> =>
  listen<string>(`agent:session:${nodeId}`, (ev) => cb(ev.payload));
