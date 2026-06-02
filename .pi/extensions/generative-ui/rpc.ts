import type { HostToPage } from "./protocol.js";
import { isPageToHost } from "./protocol.js";

/**
 * Host-side RPC handler registry attached to a glimpse window.
 *
 * Wraps `win.on("message", …)` and `win.send(js)` so each window has:
 *   - `handle(method, fn)` to register a handler
 *   - `push(msg)`           to send a typed host→page message
 *
 * One handler attaches per window — features just call `register()`.
 */

export type RpcHandler = (params: unknown) => Promise<unknown> | unknown;

export interface RpcHost {
  handle(method: string, fn: RpcHandler): void;
  push(msg: HostToPage): void;
  onUserMessage(fn: (data: unknown) => void): void;
}

interface GlimpseWindowLike {
  send(js: string): void;
  on(event: "message", fn: (data: unknown) => void): void;
}

const installed = new WeakMap<object, RpcHost>();

function jsLiteral(value: unknown): string {
  // JSON.stringify escapes for JSON; we additionally escape `</script>` to be
  // safe even though this is sent via stdin to webView.evaluateJavaScript,
  // not embedded in HTML.
  const s = JSON.stringify(value);
  // Belt-and-suspenders: <!-- and </script> can break inline script contexts
  // if this is ever spliced into HTML. Cheap to neutralize.
  return s.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

export function attach(win: GlimpseWindowLike): RpcHost {
  const existing = installed.get(win as unknown as object);
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

    if (raw.type === "rpc-call") {
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
    }
  });

  const host: RpcHost = { handle, push, onUserMessage };
  installed.set(win as unknown as object, host);
  return host;
}
