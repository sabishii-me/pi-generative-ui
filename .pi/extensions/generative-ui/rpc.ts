import type { HostToPage } from "./protocol.js";
import { isPageToHost } from "./protocol.js";
import type { GlimpseWindowLike } from "./glimpse-window.js";

/**
 * Host-side RPC handler registry attached to a Glimpse window.
 *
 * One `attach(win)` per window installs a single `message` listener that
 * routes `rpc-call` envelopes to handlers and forwards `user-message`
 * payloads to registered listeners. Idempotent: a second call returns the
 * same `RpcHost`.
 */

export type RpcHandler = (params: unknown) => Promise<unknown> | unknown;

export interface RpcHost {
  handle(method: string, fn: RpcHandler): void;
  push(msg: HostToPage): void;
  onUserMessage(fn: (data: unknown) => void): void;
}

const installed = new WeakMap<GlimpseWindowLike, RpcHost>();

/**
 * Encode a value for safe embedding in `webView.evaluateJavaScript(...)`.
 *
 * The host calls `win.send("window.__glimpseUI.deliver(<this>)")` — the
 * argument is evaluated as JavaScript, not parsed as HTML, so we only need
 * JSON-safety plus one defense: `</script>` would break callers that ever
 * splice this into an HTML script context. JSON.stringify already escapes
 * everything else; we just neutralize the closing tag with a unicode escape
 * so the resulting JS string still decodes to the same value.
 */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/<\/script/gi, "\\u003C/script");
}

export function attach(win: GlimpseWindowLike): RpcHost {
  const existing = installed.get(win);
  if (existing) return existing;

  const handlers = new Map<string, RpcHandler>();
  const userListeners = new Set<(data: unknown) => void>();

  function push(msg: HostToPage): void {
    win.send(`window.__glimpseUI&&window.__glimpseUI.deliver(${jsLiteral(msg)})`);
  }

  function handle(method: string, fn: RpcHandler): void {
    handlers.set(method, fn);
  }

  function onUserMessage(fn: (data: unknown) => void): void {
    userListeners.add(fn);
  }

  win.on("message", async (raw) => {
    if (!isPageToHost(raw)) return;

    if (raw.type === "user-message") {
      for (const fn of userListeners) {
        try { fn(raw.data); } catch (err) { console.error("[glimpse-ui] user listener threw:", err); }
      }
      return;
    }

    // raw.type === "rpc-call"
    const handler = handlers.get(raw.method);
    if (!handler) {
      push({ type: "rpc-result", id: raw.id, ok: false, error: `Unknown RPC method: ${raw.method}` });
      return;
    }
    try {
      const value = await handler(raw.params);
      push({ type: "rpc-result", id: raw.id, ok: true, value });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      push({ type: "rpc-result", id: raw.id, ok: false, error: message });
    }
  });

  const host: RpcHost = { handle, push, onUserMessage };
  installed.set(win, host);
  return host;
}
