import { writeFile } from "node:fs/promises";
import type { RpcHost } from "../rpc.js";
import { getPlatform } from "../platform/index.js";

/**
 * Host side of the SVG saver. Registers two RPC methods:
 *   - svg.copy({svg})            → copy SVG text to system clipboard
 *   - svg.save({svg, filename})  → show native Save dialog, write file
 *
 * The client (runtime/features/svg-saver.ts) owns the hover UI; the host
 * just exposes OS capabilities. Errors propagate back to the client as
 * normal RPC rejections, which the menu surfaces as "Failed".
 */

function safeFilename(name: string): string {
  const base = name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "diagram.svg";
  return base.toLowerCase().endsWith(".svg") ? base : `${base}.svg`;
}

interface CopyParams { svg: string; }
interface SaveParams { svg: string; filename?: string; }

export function attach(rpc: RpcHost): void {
  const platform = getPlatform();

  rpc.handle("svg.copy", async (params) => {
    const { svg } = params as CopyParams;
    if (typeof svg !== "string") throw new Error("svg.copy: missing svg");
    await platform.copyText(svg);
    return { ok: true };
  });

  rpc.handle("svg.save", async (params) => {
    const { svg, filename } = params as SaveParams;
    if (typeof svg !== "string") throw new Error("svg.save: missing svg");
    const path = await platform.chooseSavePath(safeFilename(filename ?? "diagram.svg"));
    if (!path) return { cancelled: true };
    await writeFile(path, svg, "utf8");
    return { path };
  });
}
