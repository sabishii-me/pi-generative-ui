import type { HostToPage, PageToHost } from "../protocol.js";
import { isHostToPage, isPageToHost } from "../protocol.js";

/**
 * The bridge owns both directions of the host↔page channel.
 *
 *  - host → page lands via window.__glimpseUI.deliver(msg) (eval'd by host)
 *  - page → host goes through window.glimpse.send(json) (native bridge)
 *
 * Listeners subscribe by message type. RPC adds a small request/response
 * layer on top.
 */

type Handler<T extends HostToPage["type"]> = (msg: Extract<HostToPage, { type: T }>) => void;
type AnyHandler = (msg: HostToPage) => void;

type GlimpseGlobal = {
  send: (data: unknown) => void;
};

declare global {
  interface Window {
    glimpse?: GlimpseGlobal;
    __glimpseUI?: { deliver: (msg: unknown) => void };
  }
}

const handlers = new Map<string, Set<AnyHandler>>();

function deliver(raw: unknown): void {
  if (!isHostToPage(raw)) return;
  const bucket = handlers.get(raw.type);
  if (!bucket) return;
  for (const fn of bucket) {
    try { fn(raw); } catch (err) { console.error("[glimpse-ui] handler threw:", err); }
  }
}

export function on<T extends HostToPage["type"]>(type: T, fn: Handler<T>): () => void {
  let bucket = handlers.get(type);
  if (!bucket) { bucket = new Set(); handlers.set(type, bucket); }
  const wrapped = fn as unknown as AnyHandler;
  bucket.add(wrapped);
  return () => { bucket!.delete(wrapped); };
}

// The original native send, captured before we wrap it.
let nativeSend: ((data: unknown) => void) | null = null;

export function send(msg: PageToHost): void {
  if (!nativeSend) {
    console.warn("[glimpse-ui] native send unavailable");
    return;
  }
  nativeSend(msg);
}

/**
 * Wrap window.glimpse.send so that user code calling glimpse.send({...})
 * (without our envelope) gets wrapped as a `user-message`. Anything that
 * already conforms to PageToHost passes through.
 */
function wrapGlimpse(): void {
  const g = window.glimpse;
  if (!g || typeof g.send !== "function") {
    console.warn("[glimpse-ui] window.glimpse.send unavailable; rpc disabled");
    return;
  }
  nativeSend = g.send.bind(g);
  g.send = (data: unknown) => {
    if (isPageToHost(data)) nativeSend!(data);
    else nativeSend!({ type: "user-message", data } satisfies PageToHost);
  };
}

// ── RPC (page → host) ────────────────────────────────────────────────────

interface Pending { resolve: (v: unknown) => void; reject: (err: Error) => void; }
const pending = new Map<string, Pending>();
let nextId = 0;

on("rpc-result", (msg) => {
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.value);
  else p.reject(new Error(msg.error));
});

export function rpc<T = unknown>(method: string, params: unknown = null): Promise<T> {
  const id = `r${++nextId}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    send({ type: "rpc-call", id, method, params });
  });
}

// Install the deliver hook on window so the host can call into us.
export function install(): void {
  window.__glimpseUI = { deliver };
  wrapGlimpse();
}
