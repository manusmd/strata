import { useEffect } from "react";
import { useStore } from "@xyflow/react";

export type ZoomLevel = "System" | "Module" | "File" | "Symbol";

export function levelFor(zoom: number): ZoomLevel {
  if (zoom < 0.3) return "System";
  if (zoom < 0.6) return "Module";
  if (zoom < 1.4) return "File";
  return "Symbol";
}

/** Caps for screen-sized labels; each becomes a CSS variable like `--s2_2` = min(1/zoom, 2.2). */
export const SCALE_CAPS = [1.6, 1.9, 3, 20];

export const LEVEL_ZOOM: Record<ZoomLevel, number> = { System: 0.2, Module: 0.45, File: 0.9, Symbol: 1.6 };

/** Keeps the semantic zoom level and the inverse zoom (for screen-sized labels) in sync. */
export function ZoomWatcher({ container, onLevel }: { container: React.RefObject<HTMLDivElement | null>; onLevel: (l: ZoomLevel) => void }) {
  const zoom = useStore((s) => s.transform[2]);
  const level = levelFor(zoom);
  useEffect(() => {
    // Label scales per cap, computed here because WebKit doesn't evaluate min() inside scale().
    const inv = 1 / zoom;
    for (const cap of SCALE_CAPS) container.current?.style.setProperty(`--s${String(cap).replace(".", "_")}`, String(Math.min(inv, cap)));
  }, [zoom, container]);
  useEffect(() => {
    container.current?.setAttribute("data-level", level.toLowerCase());
    onLevel(level);
  }, [level, onLevel, container]);
  return null;
}

