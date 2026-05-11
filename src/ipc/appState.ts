import { invoke } from "@tauri-apps/api/core";

export const appStateGet = (key: string) =>
  invoke<string | null>("app_state_get", { key });

export const appStateSet = (key: string, value: string) =>
  invoke<void>("app_state_set", { key, value });
