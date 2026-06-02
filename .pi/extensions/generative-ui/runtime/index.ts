import { install as installBridge, on } from "./bridge.js";
import { applyHTML, runScripts } from "./morph.js";
import { install as installSvgSaver } from "./features/svg-saver.js";

/**
 * Runtime entry — runs once inside the webview at document load.
 *
 *   - Installs the host→page deliver hook (so eval'd messages route here)
 *   - Subscribes to `content` messages and morphs #root accordingly
 *   - On the final chunk, executes <script> tags and unlocks features
 *   - Installs feature modules (svg saver, …)
 */

function boot(): void {
  installBridge();

  const root = document.getElementById("root");
  if (!root) {
    console.error("[glimpse-ui] #root missing; aborting boot");
    return;
  }

  let queued: { html: string; final: boolean } | null = null;
  let domReady = document.readyState !== "loading";

  function flushQueued(): void {
    if (!queued) return;
    const { html, final } = queued;
    queued = null;
    applyHTML(root!, html);
    if (final) {
      runScripts(root!);
      // Unlock features that should only act on finished content.
      const setReady = (window as unknown as { __glimpseUiSvgSetReady?: (r: boolean) => void }).__glimpseUiSvgSetReady;
      setReady?.(true);
    }
  }

  on("content", (msg) => {
    queued = { html: msg.html, final: msg.final };
    if (domReady) flushQueued();
  });

  if (!domReady) {
    document.addEventListener("DOMContentLoaded", () => {
      domReady = true;
      flushQueued();
    });
  }

  // Features
  installSvgSaver();
}

boot();
