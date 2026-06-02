/**
 * Wire protocol between the host (Node) and the runtime (page).
 *
 * Host → page: emitted via `win.send("__glimpseUI.deliver(<json>)")` (eval).
 * Page → host: emitted via `glimpse.send(<json>)` (native bridge, structured).
 *
 * Both sides agree on a single discriminated union per direction. Anything
 * else is malformed and dropped.
 */

// ── Host → Page ─────────────────────────────────────────────────────────

export type HostToPage =
  | { type: "content"; html: string; final: boolean }
  | { type: "rpc-result"; id: string; ok: true; value?: unknown }
  | { type: "rpc-result"; id: string; ok: false; error: string };

// ── Page → Host ─────────────────────────────────────────────────────────

export type PageToHost =
  | { type: "rpc-call"; id: string; method: string; params: unknown }
  | { type: "user-message"; data: unknown };

// ── Type guards (cheap, used on both sides) ─────────────────────────────

export function isHostToPage(v: unknown): v is HostToPage {
  if (!v || typeof v !== "object") return false;
  const t = (v as { type?: unknown }).type;
  return t === "content" || t === "rpc-result";
}

export function isPageToHost(v: unknown): v is PageToHost {
  if (!v || typeof v !== "object") return false;
  const t = (v as { type?: unknown }).type;
  return t === "rpc-call" || t === "user-message";
}
