# Changelog

## 0.3.0 — unreleased

### Added
- **Cross-platform support.** Runs on macOS, Linux, and Windows via Glimpse 0.8's multi-backend WebView. The `"os": ["darwin"]` restriction is gone.
- **Hover-to-export SVG menu.** Any `<svg>` in a widget shows a floating menu on hover with "Copy to clipboard" and "Download file". Backed by a typed RPC layer that talks to a per-OS clipboard / save-dialog shim.
- **Public `__glimpseUI.rpc` for widgets.** Widget code can call `await window.__glimpseUI.rpc("method", params)` with a 30s default timeout. Extensions can register custom RPC handlers on the session's `RpcHost`.
- **Cross-platform CI matrix.** GitHub Actions runs the typecheck, builds the runtime bundle, verifies it matches what's committed, and runs the full test suite on macOS, Linux, and Windows × Node 20 and 22.
- **34-test vitest suite** covering protocol guards, RPC routing, session lifecycle, the darwin / linux / win32 platform shims (mocked child_process), and an end-to-end integration test that opens a real Glimpse window.

### Changed
- **Rewrote the streaming pipeline.** `WidgetSession` owns one window for its lifetime. `index.ts` shrunk from 632 lines to ~250 — just tool registration and a thin streaming bridge. No more `escapeJS`, no `WeakSet` handler dedupe, no `__glimpse_svg_action` magic key, no `setSvgSaverReady` triple-call.
- **Page-side runtime is real TypeScript** (`runtime/*.ts`), bundled by esbuild into a single IIFE inlined into the shell HTML. Output committed as `runtime.bundle.ts` so end users don't need a build step.
- **Typed JSON protocol** between host and page. Discriminated unions on both sides; `isHostToPage` / `isPageToHost` guards on every received payload.
- **`show_widget` is now display-only.** `execute()` resolves the moment the final HTML is delivered — no more 2-minute "waiting for interaction" timeout. The window stays open until the user closes it. In-widget interactivity (sliders, hovers, canvas animations) is fully supported; the agent simply does not receive widget callbacks. Removes ~80 lines of state machinery.
- **Tool description and `promptGuidelines` updated** to tell the LLM explicitly that widgets are display-only and `glimpse.send(...)` / `sendPrompt(...)` patterns are no-ops.
- **Migrated to `@earendil-works/*`.** The deprecated `@mariozechner/pi-{ai,coding-agent,tui}` packages are gone. Typebox import switched from `@sinclair/typebox` to the new `typebox` package the framework now uses.
- **Glimpse upgraded** from `^0.3.5` to `^0.8.1`.
- **SVG colour styling re-tuned.** Each `c-*` ramp now uses the 400-stop as stroke (instead of the 200-stop) at 1px width. Calmer outlines, crisper edges, less "marker pen on construction paper".

### Fixed
- **External `<script src>` tags now load sequentially before subsequent inline scripts run.** Without this, inline scripts that depend on a CDN library (Chart.js, D3, mermaid) executed before the CDN had loaded → `ReferenceError` → blank widget.
- **`signal.aborted` is checked before opening the window** and the abort listener is wired *before* the async `onComplete` await. Aborts during streaming flush now close the window cleanly instead of being missed.
- **Window-error events are logged** instead of silently swallowed.
- **Page-side RPC has a 30s default timeout**; orphaned promises no longer hang forever.
- `</script>` in pushed content is escaped as `\u003C/script` (valid Unicode escape, still JSON-decodable).
- **SVG menu UX**: trigger and dropdown have independent state machines with a 120 ms transit grace period so cursor movement between them doesn't collapse the menu. Clicking the trigger toggles. Click-outside / Escape dismiss. Successful Copy / Save auto-dismisses after the user sees the result; a cancelled Save dialog keeps the menu open. Trigger uses `cursor: pointer` now that it's clickable.

### Removed
- `osascript`/`pbcopy`-only platform assumptions throughout the extension.
- All `as never` / `as unknown as object` casts in production code.
- Dead `setHTML` plumbing on the host side and dead `onUserMessage` public method on `WidgetSession`.
- `glimpse.send`-as-user-message routing on the host. Widget interactions no longer reach the agent.
