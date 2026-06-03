import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WidgetSession } from "../.pi/extensions/generative-ui/session.js";
import { FakeWindow } from "./fake-window.js";

function makeOpener() {
  const wins: FakeWindow[] = [];
  const open = (_html: string, _opts: unknown) => {
    const win = new FakeWindow();
    wins.push(win);
    return win;
  };
  return { open, wins };
}

function contentMessages(win: FakeWindow): Array<{ html: string; final: boolean }> {
  return win.allDelivered()
    .filter((m): m is { type: "content"; html: string; final: boolean } =>
      typeof m === "object" && m !== null && (m as { type?: unknown }).type === "content")
    .map(({ html, final }) => ({ html, final }));
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(()  => { vi.useRealTimers(); });

describe("WidgetSession", () => {
  it("opens a window and waits for ready before flushing chunks", async () => {
    const { open, wins } = makeOpener();
    const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
    const win = wins[0];

    s.onChunk("<p>".padEnd(40, "."));
    await vi.advanceTimersByTimeAsync(160);
    // Not ready yet → nothing pushed.
    expect(contentMessages(win)).toEqual([]);

    win.emitReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(contentMessages(win)).toHaveLength(1);
    expect(contentMessages(win)[0].final).toBe(false);
  });

  it("debounces rapid chunks within 150ms", async () => {
    const { open, wins } = makeOpener();
    const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
    const win = wins[0];
    win.emitReady();

    s.onChunk("a".repeat(40));
    s.onChunk("b".repeat(40));
    s.onChunk("c".repeat(40));

    await vi.advanceTimersByTimeAsync(160);
    const msgs = contentMessages(win);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].html).toBe("c".repeat(40));
    expect(msgs[0].final).toBe(false);
  });

  it("ignores chunks shorter than the minimum or unchanged", async () => {
    const { open, wins } = makeOpener();
    const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
    const win = wins[0];
    win.emitReady();

    s.onChunk("short");          // < 20 bytes
    s.onChunk("");               // empty
    await vi.advanceTimersByTimeAsync(160);
    expect(contentMessages(win)).toEqual([]);

    const big = "x".repeat(40);
    s.onChunk(big);
    s.onChunk(big);              // duplicate
    await vi.advanceTimersByTimeAsync(160);
    expect(contentMessages(win)).toHaveLength(1);
  });

  it("onComplete cancels pending debounce and pushes final=true", async () => {
    const { open, wins } = makeOpener();
    const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
    const win = wins[0];
    win.emitReady();

    s.onChunk("a".repeat(40));
    // Don't advance time — debounce still pending
    await s.onComplete("z".repeat(40));

    const msgs = contentMessages(win);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ html: "z".repeat(40), final: true });
  });

  it("late-arriving chunks after onComplete are ignored", async () => {
    const { open, wins } = makeOpener();
    const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
    const win = wins[0];
    win.emitReady();

    await s.onComplete("z".repeat(40));
    s.onChunk("late".repeat(20));
    await vi.advanceTimersByTimeAsync(200);

    expect(contentMessages(win)).toHaveLength(1);
  });

  describe("awaitInteraction", () => {
    it("resolves with 'message' when the user sends data", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      const win = wins[0];
      win.emitReady();

      const p = s.awaitInteraction(undefined, 60_000);
      win.emitMessage({ type: "user-message", data: { choice: "yes" } });
      const r = await p;
      expect(r).toEqual({ kind: "message", data: { choice: "yes" } });
    });

    it("resolves with 'closed' when the window closes", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      const win = wins[0];
      win.emitReady();

      const p = s.awaitInteraction(undefined, 60_000);
      win.close();
      const r = await p;
      expect(r.kind).toBe("closed");
    });

    it("resolves with 'error' on window error", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      const win = wins[0];
      win.emitReady();

      const p = s.awaitInteraction(undefined, 60_000);
      win.emitError(new Error("boom"));
      const r = await p;
      expect(r).toMatchObject({ kind: "error" });
    });

    it("resolves with 'aborted' when the signal fires", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      const win = wins[0];
      win.emitReady();

      const ctrl = new AbortController();
      const p = s.awaitInteraction(ctrl.signal, 60_000);
      ctrl.abort();
      const r = await p;
      expect(r.kind).toBe("aborted");
      expect(win.closed).toBe(true);
    });

    it("resolves with 'timeout' after the configured timeout", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      const win = wins[0];
      win.emitReady();

      const p = s.awaitInteraction(undefined, 5_000);
      vi.advanceTimersByTime(5_001);
      const r = await p;
      expect(r.kind).toBe("timeout");
    });

    it("throws if called more than once", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      wins[0].emitReady();
      void s.awaitInteraction(undefined, 60_000);
      expect(() => s.awaitInteraction(undefined, 60_000)).toThrow(/only be called once/);
    });

    it("clears the timeout when another terminator wins (no dangling timer)", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      const win = wins[0];
      win.emitReady();

      const p = s.awaitInteraction(undefined, 5_000);
      win.emitMessage({ type: "user-message", data: 1 });
      await p;
      // If the timeout were still armed, advancing past it would emit
      // a second resolve attempt. Easier proof: getTimerCount drops to 0.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("removes the abort listener when another terminator wins", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      const win = wins[0];
      win.emitReady();

      const ctrl = new AbortController();
      const p = s.awaitInteraction(ctrl.signal, 60_000);
      win.emitMessage({ type: "user-message", data: 1 });
      await p;

      // Firing abort after the fact must NOT try to close a window we no
      // longer own. With removeEventListener, the handler is gone.
      ctrl.abort();
      expect(win.closed).toBe(false);
    });

    it("the first terminator wins; later events are ignored", async () => {
      const { open, wins } = makeOpener();
      const s = new WidgetSession(open, { title: "t", width: 100, height: 100 });
      const win = wins[0];
      win.emitReady();

      const p = s.awaitInteraction(undefined, 60_000);
      win.emitMessage({ type: "user-message", data: 1 });
      win.close();
      win.emitError(new Error("ignored"));

      const r = await p;
      expect(r).toEqual({ kind: "message", data: 1 });
    });
  });
});
