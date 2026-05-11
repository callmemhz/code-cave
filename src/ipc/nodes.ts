import { invoke } from "@tauri-apps/api/core";
import type { DbNode, NewNodeInput } from "../types";

export const nodeList = (canvasId: string) =>
  invoke<DbNode[]>("node_list", { canvasId });
export const nodeCreate = (input: NewNodeInput) =>
  invoke<DbNode>("node_create", { input });
export const nodeUpdatePosition = (id: string, x: number, y: number) =>
  invoke<void>("node_update_position", { id, x, y });
export const nodeUpdateSize = (id: string, width: number, height: number) =>
  invoke<void>("node_update_size", { id, width, height });
export const nodeUpdateData = (id: string, dataJson: string) =>
  invoke<void>("node_update_data", { id, dataJson });
export const nodeUpdateTitle = (id: string, title: string | null) =>
  invoke<void>("node_update_title", { id, title });
export const nodeDelete = (id: string) => invoke<void>("node_delete", { id });
