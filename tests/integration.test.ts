import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLIMPSE_MJS = join(__dirname, "..", "node_modules", "glimpseui", "src", "glimpse.mjs");
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
    });

    // Stream a chunk, then finalize with a button that posts back.
    session.onChunk("<p style='padding:1rem'>Loading…</p>".padEnd(60, " "));

    const finalHTML = `
      <div style="padding:1rem;font-family:system-ui">
        <p>Ready</p>
        <button id="b" onclick="glimpse.send({hello: 'world'})">click</button>
        <script>document.getElementById('b').click();</script>
      </div>
    `;
    await session.onComplete(finalHTML);

    const result = await session.awaitInteraction(undefined, 8_000);
    session.close();

    expect(result.kind).toBe("message");
    if (result.kind === "message") expect(result.data).toEqual({ hello: "world" });
  }, 15_000);

  it("services an RPC call from the page (svg.copy)", async () => {
    // Skip in this harness if the platform doesn't support the action we use.
    // svg.copy goes to pbcopy/xclip/PowerShell; on a headless CI machine it
    // may not have any of those. We check that the response round-trips, not
    // that the clipboard actually changed.
    const { WidgetSession } = await import("../.pi/extensions/generative-ui/session.js");
    const { open } = await import(GLIMPSE_MJS);

    const session = new WidgetSession(open as never, { title: "rpc-test", width: 320, height: 200 });

    // Build a page that asks for svg.copy on load and reports back the result.
    const html = `
      <svg id="s" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#0a0"/></svg>
      <script>
        (async () => {
          // Wait a tick to ensure the bundle has installed the bridge.
          await new Promise(r => setTimeout(r, 50));
          try {
            const svg = new XMLSerializer().serializeToString(document.getElementById('s'));
            // Use the runtime's RPC directly. The bundled bridge re-exports it as a
            // page-global hook via window.__glimpseUI; for tests we call svg.copy by
            // sending a rpc-call envelope manually.
            const id = "test-1";
            window.addEventListener('message', () => {}, false);
            window.glimpse.send({ type: "rpc-call", id, method: "svg.copy", params: { svg } });
            // Listen for the host's rpc-result reply by polling a side-channel.
            // The runtime stores rpc handlers internally; easiest path: subscribe to
            // window.__glimpseUI.deliver by wrapping it.
            const orig = window.__glimpseUI.deliver;
            window.__glimpseUI.deliver = (msg) => {
              if (msg && msg.type === 'rpc-result' && msg.id === id) {
                window.glimpse.send({ ok: msg.ok, error: msg.error || null });
              }
              orig(msg);
            };
          } catch (e) {
            window.glimpse.send({ ok: false, error: String(e) });
          }
        })();
      </script>
    `;
    await session.onComplete(html);

    const result = await session.awaitInteraction(undefined, 8_000);
    session.close();

    expect(result.kind).toBe("message");
    if (result.kind === "message") {
      // We only assert the call round-tripped. ok may be true (clipboard available)
      // or false with an error message; both are valid signals that the host
      // received and replied to the RPC.
      expect(result.data).toMatchObject({ ok: expect.any(Boolean) });
    }
  }, 15_000);
});
