import { invoke } from "@tauri-apps/api/core";
import type { Canvas } from "../types";

export const canvasList = () => invoke<Canvas[]>("canvas_list");
export const canvasCreate = (name: string) => invoke<Canvas>("canvas_create", { name });
export const canvasUpdateViewport = (id: string, x: number, y: number, zoom: number) =>
  invoke<void>("canvas_update_viewport", { id, x, y, zoom });
export const canvasRename = (id: string, name: string) =>
  invoke<void>("canvas_rename", { id, name });
export const canvasDelete = (id: string) => invoke<void>("canvas_delete", { id });
