import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { appStateGet } from "../ipc/appState";

export type BgTheme =
  | "off"
  | "dots"
  | "waves"
  | "matrix"
  | "rain"
  | "starfield"
  | "plasma";

const KEY = "bg_theme";
const DEFAULT: BgTheme = "waves";
const VALID: BgTheme[] = [
  "off", "dots", "waves", "matrix", "rain", "starfield", "plasma",
];

function coerce(v: string | null | undefined): BgTheme {
  return (VALID as string[]).includes(v ?? "") ? (v as BgTheme) : DEFAULT;
}

export function useBgTheme(): BgTheme {
  const [theme, setTheme] = useState<BgTheme>(DEFAULT);
  useEffect(() => {
    let alive = true;
    appStateGet(KEY)
      .then((v) => { if (alive) setTheme(coerce(v)); })
      .catch(() => {});
    const unlistenP = listen<string>("bg-theme-changed", (e) => {
      setTheme(coerce(e.payload));
    });
    return () => {
      alive = false;
      unlistenP.then((fn) => fn()).catch(() => {});
    };
  }, []);
  return theme;
}
