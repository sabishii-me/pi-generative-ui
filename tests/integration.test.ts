import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLIMPSE_MJS    = join(__dirname, "..", "node_modules", "glimpseui", "src", "glimpse.mjs");
const GLIMPSE_BINARY = join(__dirname, "..", "node_modules", "glimpseui", "src", "glimpse");

// Skip integration tests in environments where the native binary isn't
// compiled (sandboxes, CI without the toolchain). Set FORCE_INTEGRATION=1
// to require them.
const canRun = existsSync(GLIMPSE_BINARY);
const shouldSkip = !canRun && !process.env.FORCE_INTEGRATION;
const describeMaybe = shouldSkip ? describe.skip : describe;

describeMaybe("integration: real glimpse window", () => {
  it("opens a window, streams content, and receives a user message", async () => {
    const { WidgetSession } = await import("../.pi/extensions/generative-ui/session.js");
    const { open } = await import(GLIMPSE_MJS);

    const session = new WidgetSession(open as never, {
      title: "integration-test",
      width: 320,
      height: 200,
      hidden: true,
    });

    try {
      session.onChunk("<p style='padding:1rem'>Loading…</p>".padEnd(60, " "));

      await session.onComplete(`
        <div style="padding:1rem;font-family:system-ui">
          <p>Ready</p>
          <button id="b" onclick="glimpse.send({hello: 'world'})">click</button>
          <script>document.getElementById('b').click();</script>
        </div>
      `);

      const result = await session.awaitInteraction(undefined, 8_000);
      expect(result.kind).toBe("message");
      if (result.kind === "message") expect(result.data).toEqual({ hello: "world" });
    } finally {
      session.close();
    }
  }, 15_000);

  it("services an RPC call from the page via the public __glimpseUI.rpc API", async () => {
    // Exercises the full host↔page loop: page calls __glimpseUI.rpc("svg.copy"),
    // host handler runs (possibly failing if no clipboard tool is installed),
    // the result rides back as an rpc-result, and the page reports outcome via
    // glimpse.send.
    const { WidgetSession } = await import("../.pi/extensions/generative-ui/session.js");
    const { open } = await import(GLIMPSE_MJS);

    const session = new WidgetSession(open as never, {
      title: "rpc-test", width: 320, height: 200, hidden: true,
    });

    try {
      await session.onComplete(`
        <svg id="s" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#0a0"/></svg>
        <script>
          (async () => {
            try {
              const svg = new XMLSerializer().serializeToString(document.getElementById('s'));
              const result = await window.__glimpseUI.rpc('svg.copy', { svg });
              window.glimpse.send({ ok: true, result });
            } catch (e) {
              window.glimpse.send({ ok: false, error: String(e && e.message || e) });
            }
          })();
        </script>
      `);

      const result = await session.awaitInteraction(undefined, 8_000);
      expect(result.kind).toBe("message");
      if (result.kind === "message") {
        // ok may be true (clipboard available) or false (no tool). Both prove
        // the RPC round-tripped — we only need a structured response.
        expect(result.data).toMatchObject({ ok: expect.any(Boolean) });
      }
    } finally {
      session.close();
    }
  }, 15_000);
});
