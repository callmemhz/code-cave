import { create } from "zustand";
import type { Canvas, DbNode, NewNodeInput } from "../types";
import * as Canvases from "../ipc/canvases";
import * as Nodes from "../ipc/nodes";
import { appStateGet, appStateSet } from "../ipc/appState";
import { debounce } from "../lib/debounce";

const ACTIVE_CANVAS_KEY = "active_canvas_id";

interface CanvasState {
  canvases: Canvas[];
  activeCanvasId: string | null;
  nodesByCanvas: Record<string, DbNode[]>;

  loadAll: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  addCanvas: (name: string) => Promise<void>;
  renameCanvas: (id: string, name: string) => Promise<void>;
  deleteCanvas: (id: string) => Promise<void>;
  reorderCanvases: (ids: string[]) => Promise<void>;
  saveViewport: (id: string, x: number, y: number, zoom: number) => void;

  addNode: (input: NewNodeInput) => Promise<DbNode>;
  replaceNode: (node: DbNode) => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
  updateNodeSize: (id: string, w: number, h: number) => void;
  updateNodeData: (id: string, dataJson: string) => void;
  updateNodeTitle: (id: string, title: string | null) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
}

const saveViewportDebounced = debounce(Canvases.canvasUpdateViewport, 300);
const savePositionDebounced = debounce(Nodes.nodeUpdatePosition, 200);
const saveSizeDebounced = debounce(Nodes.nodeUpdateSize, 200);
const saveDataDebounced = debounce(Nodes.nodeUpdateData, 400);

export const useCanvasStore = create<CanvasState>((set, get) => ({
  canvases: [],
  activeCanvasId: null,
  nodesByCanvas: {},

  loadAll: async () => {
    const canvases = await Canvases.canvasList();
    const stored = await appStateGet(ACTIVE_CANVAS_KEY);
    const activeCanvasId =
      (stored && canvases.find((c) => c.id === stored)?.id) ??
      canvases[0]?.id ??
      null;
    const nodesByCanvas: Record<string, DbNode[]> = {};
    if (activeCanvasId) {
      nodesByCanvas[activeCanvasId] = await Nodes.nodeList(activeCanvasId);
    }
    set({ canvases, activeCanvasId, nodesByCanvas });
  },

  setActive: async (id) => {
    if (!get().nodesByCanvas[id]) {
      const ns = await Nodes.nodeList(id);
      set((s) => ({ nodesByCanvas: { ...s.nodesByCanvas, [id]: ns } }));
    }
    set({ activeCanvasId: id });
    appStateSet(ACTIVE_CANVAS_KEY, id).catch(console.error);
  },

  addCanvas: async (name) => {
    const c = await Canvases.canvasCreate(name);
    set((s) => ({ canvases: [...s.canvases, c], activeCanvasId: c.id,
                  nodesByCanvas: { ...s.nodesByCanvas, [c.id]: [] } }));
    appStateSet(ACTIVE_CANVAS_KEY, c.id).catch(console.error);
  },

  renameCanvas: async (id, name) => {
    await Canvases.canvasRename(id, name);
    set((s) => ({ canvases: s.canvases.map((c) => c.id === id ? { ...c, name } : c) }));
  },

  reorderCanvases: async (ids) => {
    // Optimistic local reorder.
    set((s) => {
      const map = new Map(s.canvases.map((c) => [c.id, c]));
      const next = ids
        .map((id, i) => {
          const c = map.get(id);
          return c ? { ...c, position: i } : null;
        })
        .filter((c): c is Canvas => c !== null);
      return { canvases: next };
    });
    await Canvases.canvasReorder(ids);
  },

  deleteCanvas: async (id) => {
    await Canvases.canvasDelete(id);
    const wasActive = get().activeCanvasId === id;
    set((s) => {
      const canvases = s.canvases.filter((c) => c.id !== id);
      const { [id]: _, ...rest } = s.nodesByCanvas;
      const activeCanvasId = s.activeCanvasId === id ? (canvases[0]?.id ?? null) : s.activeCanvasId;
      return { canvases, nodesByCanvas: rest, activeCanvasId };
    });
    if (wasActive) {
      const next = get().activeCanvasId;
      if (next) appStateSet(ACTIVE_CANVAS_KEY, next).catch(console.error);
    }
  },

  saveViewport: (id, x, y, zoom) => {
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === id ? { ...c, viewport_x: x, viewport_y: y, viewport_zoom: zoom } : c
      ),
    }));
    saveViewportDebounced(id, x, y, zoom);
  },

  addNode: async (input) => {
    const n = await Nodes.nodeCreate(input);
    set((s) => ({
      nodesByCanvas: {
        ...s.nodesByCanvas,
        [input.canvas_id]: [...(s.nodesByCanvas[input.canvas_id] ?? []), n],
      },
    }));
    return n;
  },

  replaceNode: (node) => {
    set((s) => {
      const next = { ...s.nodesByCanvas };
      for (const cid of Object.keys(next)) {
        next[cid] = next[cid].map((n) => (n.id === node.id ? node : n));
      }
      return { nodesByCanvas: next };
    });
  },

  updateNodePosition: (id, x, y) => {
    set((s) => {
      const next = { ...s.nodesByCanvas };
      for (const cid of Object.keys(next)) {
        next[cid] = next[cid].map((n) => n.id === id ? { ...n, x, y } : n);
      }
      return { nodesByCanvas: next };
    });
    savePositionDebounced(id, x, y);
  },

  updateNodeSize: (id, width, height) => {
    set((s) => {
      const next = { ...s.nodesByCanvas };
      for (const cid of Object.keys(next)) {
        next[cid] = next[cid].map((n) => n.id === id ? { ...n, width, height } : n);
      }
      return { nodesByCanvas: next };
    });
    saveSizeDebounced(id, width, height);
  },

  updateNodeData: (id, dataJson) => {
    set((s) => {
      const next = { ...s.nodesByCanvas };
      for (const cid of Object.keys(next)) {
        next[cid] = next[cid].map((n) => n.id === id ? { ...n, data_json: dataJson } : n);
      }
      return { nodesByCanvas: next };
    });
    saveDataDebounced(id, dataJson);
  },

  updateNodeTitle: async (id, title) => {
    await Nodes.nodeUpdateTitle(id, title);
    set((s) => {
      const next = { ...s.nodesByCanvas };
      for (const cid of Object.keys(next)) {
        next[cid] = next[cid].map((n) => n.id === id ? { ...n, title } : n);
      }
      return { nodesByCanvas: next };
    });
  },

  deleteNode: async (id) => {
    await Nodes.nodeDelete(id);
    set((s) => {
      const next = { ...s.nodesByCanvas };
      for (const cid of Object.keys(next)) {
        next[cid] = next[cid].filter((n) => n.id !== id);
      }
      return { nodesByCanvas: next };
    });
  },
}));
