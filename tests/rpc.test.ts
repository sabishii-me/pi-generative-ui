import { describe, it, expect } from "vitest";
import { attach } from "../.pi/extensions/generative-ui/rpc.js";
import { FakeWindow } from "./fake-window.js";

describe("rpc.attach", () => {
  it("routes rpc-call to registered handlers and pushes a success result", async () => {
    const win = new FakeWindow();
    const rpc = attach(win);

    rpc.handle("echo", (params) => ({ got: params }));

    win.emitMessage({ type: "rpc-call", id: "r1", method: "echo", params: { x: 1 } });

    // Allow microtasks to drain (handler is async via Promise.resolve in attach)
    await new Promise((r) => setImmediate(r));

    const delivered = win.parseDelivered();
    expect(delivered).toEqual({
      type: "rpc-result",
      id: "r1",
      ok: true,
      value: { got: { x: 1 } },
    });
  });

  it("returns an error result when the handler throws", async () => {
    const win = new FakeWindow();
    const rpc = attach(win);

    rpc.handle("boom", () => { throw new Error("nope"); });

    win.emitMessage({ type: "rpc-call", id: "r2", method: "boom", params: null });
    await new Promise((r) => setImmediate(r));

    expect(win.parseDelivered()).toEqual({
      type: "rpc-result",
      id: "r2",
      ok: false,
      error: "nope",
    });
  });

  it("returns 'Unknown RPC method' for unregistered methods", async () => {
    const win = new FakeWindow();
    attach(win);

    win.emitMessage({ type: "rpc-call", id: "r3", method: "missing", params: null });
    await new Promise((r) => setImmediate(r));

    expect(win.parseDelivered()).toMatchObject({
      type: "rpc-result", id: "r3", ok: false, error: /Unknown RPC method/,
    } as never);
  });

  it("delivers user-message payloads to onUserMessage listeners", () => {
    const win = new FakeWindow();
    const rpc = attach(win);
    const seen: unknown[] = [];
    rpc.onUserMessage((d) => seen.push(d));

    win.emitMessage({ type: "user-message", data: { choice: "yes" } });
    win.emitMessage({ type: "user-message", data: 42 });

    expect(seen).toEqual([{ choice: "yes" }, 42]);
  });

  it("ignores malformed page→host messages", async () => {
    const win = new FakeWindow();
    attach(win);
    const seen: unknown[] = [];
    attach(win).onUserMessage((d) => seen.push(d));

    win.emitMessage(null);
    win.emitMessage("garbage");
    win.emitMessage({ type: "content", html: "x", final: true }); // wrong direction
    win.emitMessage({ type: "unknown" });

    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual([]);
    expect(win.sent).toEqual([]);
  });

  it("returns the same RpcHost on re-attach (idempotent per window)", () => {
    const win = new FakeWindow();
    const a = attach(win);
    const b = attach(win);
    expect(a).toBe(b);
  });

  it("push() escapes </script> as a unicode literal so the eval'd JS still decodes correctly", () => {
    const win = new FakeWindow();
    const rpc = attach(win);
    const html = "<p>x</p></script><script>alert(1)</script>";
    rpc.push({ type: "content", html, final: false });
    const js = win.sent[0];
    // No literal closing tag left in the eval'd source
    expect(js).not.toMatch(/<\/script/i);
    // But once eval'd, the JSON decodes back to the original payload
    const decoded = win.parseDelivered() as { type: string; html: string };
    expect(decoded).toEqual({ type: "content", html, final: false });
  });
});
