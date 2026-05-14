import { Background } from "@xyflow/react";
import { AsciiBackground } from "./AsciiBackground";
import { useBgTheme } from "./useBgTheme";

export function BackgroundLayer() {
  const theme = useBgTheme();
  if (theme === "off") return null;
  if (theme === "dots") return <Background />;
  return <AsciiBackground theme={theme} />;
}
