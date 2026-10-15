import { useLayoutEffect, useRef, useState } from "react";

import type { EntityType, Impact } from "@/api/contract";
import { ENTITY_TYPE_ICONS, IMPACT_ICONS, type IconInfo } from "@/lib/icons";

/** Lucide icons as canvas paths, keyed "type:region", "impact:risk"… (24 × 24 units). */
export type Sprites = ReadonlyMap<string, Path2D>;

const SOURCES: [string, IconInfo][] = [
  ...(Object.entries(ENTITY_TYPE_ICONS) as [EntityType, IconInfo][]).map(([t, info]): [string, IconInfo] => [`type:${t}`, info]),
  ...(Object.entries(IMPACT_ICONS) as [Impact, IconInfo][]).map(([i, info]): [string, IconInfo] => [`impact:${i}`, info]),
];

let cache: Map<string, Path2D> | null = null;

/** One SVG icon's shapes as a single Path2D (lucide uses path, circle, rect, line, polyline…). */
export function svgToPath(svg: Element): Path2D | null {
  if (typeof Path2D === "undefined") return null;
  const path = new Path2D();
  const num = (el: Element, name: string) => parseFloat(el.getAttribute(name) ?? "0") || 0;
  for (const el of Array.from(svg.children)) {
    switch (el.tagName.toLowerCase()) {
      case "path":
        path.addPath(new Path2D(el.getAttribute("d") ?? ""));
        break;
      case "circle": {
        const [cx, cy, r] = [num(el, "cx"), num(el, "cy"), num(el, "r")];
        path.moveTo(cx + r, cy);
        path.arc(cx, cy, r, 0, Math.PI * 2);
        break;
      }
      case "ellipse": {
        const [cx, cy, rx, ry] = [num(el, "cx"), num(el, "cy"), num(el, "rx"), num(el, "ry")];
        path.moveTo(cx + rx, cy);
        path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        break;
      }
      case "rect": {
        const [x, y, w, h, rx] = [num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"), num(el, "rx")];
        if (rx > 0 && typeof path.roundRect === "function") path.roundRect(x, y, w, h, rx);
        else path.rect(x, y, w, h);
        break;
      }
      case "line":
        path.moveTo(num(el, "x1"), num(el, "y1"));
        path.lineTo(num(el, "x2"), num(el, "y2"));
        break;
      case "polyline":
      case "polygon": {
        const pts = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < pts.length; i += 2) {
          if (i === 0) path.moveTo(pts[0], pts[1]);
          else path.lineTo(pts[i], pts[i + 1]);
        }
        if (el.tagName.toLowerCase() === "polygon") path.closePath();
        break;
      }
    }
  }
  return path;
}

/**
 * Renders the type and impact icons once, hidden, and turns them into
 * canvas paths, so the graph draws the very same lucide icons as the chips
 * and the legend. Returns null until ready (or where canvas paths aren't
 * supported); the graph then draws plain dots.
 */
export function useSprites(): { sprites: Sprites | null; host: React.ReactNode } {
  const ref = useRef<HTMLDivElement>(null);
  const [sprites, setSprites] = useState<Sprites | null>(cache);
  useLayoutEffect(() => {
    if (cache || !ref.current) return;
    const built = new Map<string, Path2D>();
    for (const el of Array.from(ref.current.querySelectorAll("svg[data-sprite]"))) {
      const path = svgToPath(el);
      if (path) built.set(el.getAttribute("data-sprite")!, path);
    }
    if (built.size === 0) return;
    cache = built;
    setSprites(built);
  }, []);
  const host = sprites ? null : (
    <div ref={ref} hidden aria-hidden>
      {SOURCES.map(([key, info]) => {
        const Icon = info.icon;
        return <Icon key={key} data-sprite={key} />;
      })}
    </div>
  );
  return { sprites, host };
}

/** Draw a sprite centred at (x, y), `size` graph units wide, stroked in `color`. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Path2D,
  x: number,
  y: number,
  size: number,
  color: string,
  strokeWidth = 2,
): void {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  ctx.stroke(sprite);
  ctx.restore();
}
