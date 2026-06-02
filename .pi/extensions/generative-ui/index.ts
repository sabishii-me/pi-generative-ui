import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getGuidelines, AVAILABLE_MODULES } from "./guidelines.js";
import { WidgetSession } from "./session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLIMPSE_PATH = join(__dirname, "../../../node_modules/glimpseui/src/glimpse.mjs");

export default function (pi: ExtensionAPI) {
  const activeSessions = new Set<WidgetSession>();
  let glimpseModule: { open: (html: string, opts: unknown) => unknown } | null = null;

  async function getGlimpseOpen() {
    if (!glimpseModule) glimpseModule = await import(GLIMPSE_PATH);
    return glimpseModule!.open;
  }

  // ── Streaming bridge ───────────────────────────────────────────────────
  //
  // While show_widget streams, we want the user to see partial content
  // before the tool call finishes. `pending` holds the session created on
  // `toolcall_start`; `execute()` later picks it up by content index.

  interface Pending { contentIndex: number; session: WidgetSession; }
  let pending: Pending | null = null;

  pi.on("message_update", async (event) => {
    const raw = (event as { assistantMessageEvent?: {
      type: string;
      contentIndex: number;
      partial?: { content?: Array<{ type: string; name?: string; arguments?: Record<string, unknown> }> };
      toolCall?: { arguments?: Record<string, unknown> };
    } }).assistantMessageEvent;
    if (!raw) return;

    if (raw.type === "toolcall_start") {
      const block = raw.partial?.content?.[raw.contentIndex];
      if (block?.type !== "toolCall" || block.name !== "show_widget") return;

      const args = block.arguments ?? {};
      const title = String(args.title ?? "Widget").replace(/_/g, " ");
      const width  = typeof args.width  === "number" ? args.width  : 800;
      const height = typeof args.height === "number" ? args.height : 600;

      const open = await getGlimpseOpen();
      const session = new WidgetSession(open as never, { title, width, height });
      activeSessions.add(session);
      pending = { contentIndex: raw.contentIndex, session };
      return;
    }

    if (raw.type === "toolcall_delta" && pending && raw.contentIndex === pending.contentIndex) {
      const block = raw.partial?.content?.[raw.contentIndex];
      const html = block?.arguments?.widget_code;
      if (typeof html === "string") pending.session.onChunk(html);
      return;
    }

    if (raw.type === "toolcall_end" && pending && raw.contentIndex === pending.contentIndex) {
      const html = raw.toolCall?.arguments?.widget_code;
      if (typeof html === "string") await pending.session.onComplete(html);
      // execute() picks up the session
      return;
    }
  });

  // ── read_me tool ───────────────────────────────────────────────────────

  pi.registerTool({
    name: "visualize_read_me",
    label: "Read Guidelines",
    description:
      "Returns design guidelines for show_widget (CSS patterns, colors, typography, layout rules, examples). " +
      "Call once before your first show_widget call. Do NOT mention this call to the user — it is an internal setup step.",
    promptSnippet: "Load design guidelines before creating widgets. Call silently before first show_widget use.",
    promptGuidelines: [
      "Call visualize_read_me once before your first show_widget call to load design guidelines.",
      "Do NOT mention the read_me call to the user — call it silently, then proceed directly to building the widget.",
      "Pick the modules that match your use case: interactive, chart, mockup, art, diagram.",
    ],
    parameters: Type.Object({
      modules: Type.Array(
        StringEnum(AVAILABLE_MODULES as readonly string[]),
        { description: "Which module(s) to load. Pick all that fit." },
      ),
    }),

    async execute(_id, params) {
      const content = getGuidelines(params.modules as string[]);
      return {
        content: [{ type: "text" as const, text: content }],
        details: { modules: params.modules },
      };
    },

    renderCall(args: { modules?: string[] }, theme) {
      const mods = (args.modules ?? []).join(", ");
      return new Text(theme.fg("toolTitle", theme.bold("read_me ")) + theme.fg("muted", mods), 0, 0);
    },

    renderResult(_result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Loading guidelines..."), 0, 0);
      return new Text(theme.fg("dim", "Guidelines loaded"), 0, 0);
    },
  });

  // ── show_widget tool ───────────────────────────────────────────────────

  pi.registerTool({
    name: "show_widget",
    label: "Show Widget",
    description:
      "Show visual content — SVG graphics, diagrams, charts, or interactive HTML widgets — in a native window. " +
      "Supports macOS, Linux, and Windows. " +
      "The HTML is rendered in a native WebView with full CSS/JS support including Canvas and CDN libraries. " +
      "The page gets a window.glimpse.send(data) bridge to send JSON data back to the agent. " +
      "IMPORTANT: Call visualize_read_me once before your first show_widget call.",
    promptSnippet:
      "Render interactive HTML/SVG widgets in a native window (cross-platform WebView). Supports full CSS, JS, Canvas, Chart.js.",
    promptGuidelines: [
      "Use show_widget when the user asks for visual content: charts, diagrams, interactive explainers, UI mockups, art.",
      "Always call visualize_read_me first to load design guidelines, then set i_have_seen_read_me: true.",
      "The widget opens in a native window — it has full browser capabilities (Canvas, JS, CDN libraries).",
      "Structure HTML as fragments: no DOCTYPE/<html>/<head>/<body>. Style first, then HTML, then scripts.",
      "The page has window.glimpse.send(data) to send data back. Use it for user choices and interactions.",
      "Keep widgets focused and appropriately sized. Default is 800x600 but adjust to fit content.",
      "For SVG: start code with <svg> tag.",
    ],
    parameters: Type.Object({
      i_have_seen_read_me: Type.Boolean({
        description: "Confirm you have already called visualize_read_me in this conversation.",
      }),
      title: Type.String({
        description: "Short snake_case identifier for this widget (used as window title).",
      }),
      widget_code: Type.String({
        description:
          "HTML or SVG code to render. For SVG: raw SVG starting with <svg>. " +
          "For HTML: raw content fragment, no DOCTYPE/<html>/<head>/<body>.",
      }),
      width:    Type.Optional(Type.Number({ description: "Window width in pixels. Default: 800." })),
      height:   Type.Optional(Type.Number({ description: "Window height in pixels. Default: 600." })),
      floating: Type.Optional(Type.Boolean({ description: "Keep window always on top. Default: false." })),
    }),

    async execute(_id, params, signal) {
      if (!params.i_have_seen_read_me) {
        throw new Error("You must call visualize_read_me before show_widget. Set i_have_seen_read_me: true after doing so.");
      }

      const code = params.widget_code;
      const isSVG = code.trimStart().startsWith("<svg");
      const title = params.title.replace(/_/g, " ");
      const width  = params.width  ?? 800;
      const height = params.height ?? 600;

      // Reuse the streaming session if present; otherwise open one now.
      let session: WidgetSession;
      if (pending) {
        session = pending.session;
        pending = null;
        await session.onComplete(code);
      } else {
        const open = await getGlimpseOpen();
        session = new WidgetSession(open as never, { title, width, height, floating: params.floating });
        activeSessions.add(session);
        await session.onComplete(code);
      }

      const result = await session.awaitInteraction(signal);
      activeSessions.delete(session);

      const messageData = result.kind === "message" ? result.data : null;
      const reason =
        result.kind === "message"  ? "User sent data from widget." :
        result.kind === "closed"   ? "Window closed by user." :
        result.kind === "error"    ? `Error: ${result.error.message}` :
        result.kind === "aborted"  ? "Aborted." :
        /* timeout */                "Widget still open (timed out waiting for interaction).";

      return {
        content: [{
          type: "text" as const,
          text: messageData
            ? `Widget rendered. User interaction data: ${JSON.stringify(messageData)}`
            : `Widget "${title}" rendered and shown to the user (${width}×${height}). ${reason}`,
        }],
        details: { title: params.title, width, height, isSVG, messageData, closedReason: reason },
      };
    },

    renderCall(args: { title?: string; width?: number; height?: number }, theme) {
      const title = (args.title ?? "widget").replace(/_/g, " ");
      const size = args.width && args.height ? ` ${args.width}×${args.height}` : "";
      let text = theme.fg("toolTitle", theme.bold("show_widget ")) + theme.fg("accent", title);
      if (size) text += theme.fg("dim", size);
      return new Text(text, 0, 0);
    },

    renderResult(result: { details?: { title?: string; width?: number; height?: number; isSVG?: boolean; closedReason?: string; messageData?: unknown } }, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⟳ Widget rendering..."), 0, 0);
      const d = result.details ?? {};
      const title = (d.title ?? "widget").replace(/_/g, " ");
      let text = theme.fg("success", "✓ ") + theme.fg("accent", title);
      text += theme.fg("dim", ` ${d.width ?? 800}×${d.height ?? 600}`);
      if (d.isSVG) text += theme.fg("dim", " (SVG)");
      if (d.closedReason) text += "\n" + theme.fg("muted", `  ${d.closedReason}`);
      if (expanded && d.messageData) text += "\n" + theme.fg("dim", `  Data: ${JSON.stringify(d.messageData, null, 2)}`);
      return new Text(text, 0, 0);
    },
  });

  // ── shutdown ───────────────────────────────────────────────────────────

  pi.on("session_shutdown", async () => {
    if (pending) { pending.session.close(); pending = null; }
    for (const s of activeSessions) s.close();
    activeSessions.clear();
  });
}
