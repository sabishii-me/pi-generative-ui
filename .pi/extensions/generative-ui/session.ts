import { attach as attachRpc, type RpcHost } from "./rpc.js";
import { attach as attachSvgSaver } from "./features/svg-saver.js";
import { RUNTIME_HTML } from "./runtime.bundle.js";
import type { GlimpseWindowLike, OpenOptions, Opener } from "./glimpse-window.js";

/**
 * Owns one Glimpse window for the lifetime of a show_widget call.
 *
 *   - `onChunk(html)` is called repeatedly while the model streams.
 *   - `onComplete(html)` is called when the tool call finishes — final
 *     content is pushed with `final: true` and scripts execute.
 *   - `awaitInteraction()` resolves when the user sends a message, the
 *     window closes, an error fires, the signal aborts, or the timeout
 *     hits — whichever wins. Call once per session.
 *
 * The page receives `{type: "content", html, final}` messages; nothing
 * else. Features are attached once on open() and live until close.
 */

const FLUSH_DEBOUNCE_MS = 150;
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_CHUNK_BYTES = 20;

export type { OpenOptions, Opener } from "./glimpse-window.js";

export class WidgetSession {
  readonly win: GlimpseWindowLike;
  private readonly rpc: RpcHost;
  private readonly readyPromise: Promise<void>;
  private latestHTML = "";
  private hasContent = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private finalized = false;
  private closed = false;
  private interactionStarted = false;

  constructor(open: Opener, opts: OpenOptions) {
    this.win = open(RUNTIME_HTML, opts);
    this.win.on("closed", () => { this.closed = true; });
    this.win.on("error",  () => { this.closed = true; });

    this.readyPromise = new Promise<void>((resolve) => {
      this.win.on("ready", () => resolve());
    });

    this.rpc = attachRpc(this.win);
    attachSvgSaver(this.rpc);
  }

  /** Streaming chunk. Coalesces rapid updates within FLUSH_DEBOUNCE_MS. */
  onChunk(html: string): void {
    if (this.finalized || this.closed) return;
    if (!html || html.length < MIN_CHUNK_BYTES) return;
    if (html === this.latestHTML) return;
    this.latestHTML = html;
    this.hasContent = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush(false);
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Final content. Cancels any pending debounce and pushes with final=true. */
  async onComplete(html: string): Promise<void> {
    if (this.finalized || this.closed) return;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (html) {
      this.latestHTML = html;
      this.hasContent = true;
    }
    this.finalized = true;
    await this.flush(true);
  }

  private async flush(final: boolean): Promise<void> {
    if (!this.hasContent) return;
    await this.readyPromise;
    if (this.closed) return;
    try {
      this.rpc.push({ type: "content", html: this.latestHTML, final });
    } catch (err) {
      console.error("[glimpse-ui] push failed:", err);
    }
  }

  /**
   * Resolves with the reason this session ended. Multiple terminators race;
   * the first wins, the rest are dropped. Must be called at most once.
   */
  awaitInteraction(signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SessionResult> {
    if (this.interactionStarted) {
      throw new Error("awaitInteraction() may only be called once per session");
    }
    this.interactionStarted = true;

    return new Promise<SessionResult>((resolve) => {
      let done = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let abortHandler: (() => void) | null = null;

      const finish = (result: SessionResult): void => {
        if (done) return;
        done = true;
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
        resolve(result);
      };

      this.rpc.onUserMessage((data) => finish({ kind: "message", data }));
      this.win.on("closed", () => finish({ kind: "closed" }));
      this.win.on("error",  (err) => finish({ kind: "error", error: err }));

      if (signal) {
        if (signal.aborted) {
          try { this.win.close(); } catch {}
          finish({ kind: "aborted" });
          return;
        }
        abortHandler = () => {
          try { this.win.close(); } catch {}
          finish({ kind: "aborted" });
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      timeoutHandle = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    try { this.win.close(); } catch {}
  }
}

export type SessionResult =
  | { kind: "message"; data: unknown }
  | { kind: "closed" }
  | { kind: "error"; error: Error }
  | { kind: "aborted" }
  | { kind: "timeout" };
