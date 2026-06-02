import * as darwin from "./darwin.js";
import * as linux from "./linux.js";
import * as win32 from "./win32.js";

/**
 * Thin OS abstraction for the two things features need from the host:
 *   - copying text to the system clipboard
 *   - showing a native "Save As" dialog and returning the chosen path
 *
 * Each implementation throws a descriptive error if its required CLI is
 * missing, so the user sees something actionable in the UI.
 */

export interface Platform {
  readonly name: "darwin" | "linux" | "win32";
  copyText(text: string): Promise<void>;
  chooseSavePath(suggestedName: string): Promise<string | null>;
}

function unsupported(name: string): Platform {
  return {
    name: process.platform as Platform["name"],
    async copyText() { throw new Error(`Clipboard not supported on ${name}`); },
    async chooseSavePath() { throw new Error(`Save dialog not supported on ${name}`); },
  };
}

let cached: Platform | null = null;

export function getPlatform(): Platform {
  if (cached) return cached;
  switch (process.platform) {
    case "darwin": cached = darwin; break;
    case "linux":  cached = linux;  break;
    case "win32":  cached = win32;  break;
    default:       cached = unsupported(process.platform);
  }
  return cached;
}
