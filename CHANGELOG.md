# Changelog

## 0.3.0 — unreleased

### Added
- **Cross-platform support.** Runs on macOS, Linux, and Windows via Glimpse 0.8's multi-backend WebView. The `"os": ["darwin"]` restriction is gone.
- **Hover-to-export SVG menu.** Any `<svg>` in a widget now shows a floating menu on hover with "Copy to clipboard" and "Download file". Backed by a typed RPC layer.
- **Public `__glimpseUI.rpc` for widgets.** Widget code can call `await window.__glimpseUI.rpc("method", params)` with a 30s default timeout. Extensions can register custom RPC methods on the session's `RpcHost`.
- **Full test coverage.** Vitest suite covers the protocol guards, RPC routing, session lifecycle, platform shim argv, plus an integration test that opens a real Glimpse window and round-trips a `glimpse.send` payload + an RPC call.

### Changed
- **Rewrote the streaming pipeline.** A `WidgetSession` now owns one window for its lifetime. `index.ts` shrunk from 632 lines to ~220 — just tool registration and a thin streaming bridge. No more `escapeJS`, no `WeakSet` handler dedupe, no `__glimpse_svg_action` magic key, no `setSvgSaverReady` triple-call.
- **Page-side runtime is real TypeScript** (`runtime/*.ts`), bundled by esbuild into a single IIFE inlined into the shell HTML. Output committed as `runtime.bundle.ts` so end users don't need a build step.
- **Typed JSON protocol** between host and page. Discriminated unions on both sides; the bridge wraps user `glimpse.send({...})` payloads in a `user-message` envelope so protocol traffic and user traffic never collide.
- **Migrated to `@earendil-works/*`.** The deprecated `@mariozechner/pi-{ai,coding-agent,tui}` packages are gone. Typebox import switched from `@sinclair/typebox` to the new `typebox` package the framework now uses.
- **Glimpse upgraded** from `^0.3.5` to `^0.8.1`.

### Fixed
- `awaitInteraction` no longer leaks a timer when another terminator wins, and no longer accumulates listeners on repeated calls (it now throws).
- Page-side RPC has a 30s default timeout; orphaned promises no longer hang forever.
- `</script>` in pushed content is escaped as `\u003C/script` (valid Unicode escape, still JSON-decodable). The previous wrong `<\!--` escape is gone.

### Removed
- `osascript`/`pbcopy`-only platform assumptions throughout the extension.
- All `as never` / `as unknown as object` casts in production code.
- Dead `setHTML` plumbing on the host side and dead `onUserMessage` public method on `WidgetSession`.
