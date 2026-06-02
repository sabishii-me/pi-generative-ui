import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

/**
 * We can't reasonably exercise the actual zenity/osascript/powershell paths
 * in CI, so we mock `node:child_process` and assert the right argv shape.
 */

interface MockProc extends EventEmitter { stdin: Writable; }

function makeProc(): MockProc {
  const proc = new EventEmitter() as MockProc;
  const chunks: Buffer[] = [];
  proc.stdin = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
    final(cb) { (proc as unknown as { _stdinText: string })._stdinText = Buffer.concat(chunks).toString("utf8"); cb(); },
  });
  return proc;
}

vi.mock("node:child_process", () => {
  const spawnCalls: Array<{ cmd: string; args: string[]; proc: MockProc }> = [];
  const execFileCalls: Array<{ cmd: string; args: string[] }> = [];
  let execFileResult: { stdout: string; stderr?: string } | Error = { stdout: "" };
  let whichKnown = new Set<string>();

  function spawn(cmd: string, args: string[] = []): MockProc {
    const proc = makeProc();
    spawnCalls.push({ cmd, args, proc });
    setImmediate(() => proc.emit("close", 0));
    return proc;
  }

  function execFile(cmd: string, args: string[], cb?: (err: Error | null, out?: { stdout: string }) => void) {
    execFileCalls.push({ cmd, args });
    if (cmd === "which") {
      const ok = whichKnown.has(args[0]);
      if (cb) {
        if (ok) cb(null, { stdout: `/usr/bin/${args[0]}\n` });
        else cb(Object.assign(new Error("not found"), { code: 1 }));
      }
      return { stdin: null } as { stdin: null };
    }
    if (cb) {
      if (execFileResult instanceof Error) cb(execFileResult);
      else cb(null, execFileResult);
    }
    return { stdin: null } as { stdin: null };
  }

  return {
    spawn,
    execFile,
    __spawnCalls: spawnCalls,
    __execFileCalls: execFileCalls,
    __setExecFileResult: (r: { stdout: string } | Error) => { execFileResult = r; },
    __setWhich: (names: string[]) => { whichKnown = new Set(names); },
    __reset: () => { spawnCalls.length = 0; execFileCalls.length = 0; whichKnown.clear(); execFileResult = { stdout: "" }; },
  };
});

// Helper to grab the mock controls
async function loadCpMock() {
  return (await import("node:child_process")) as unknown as {
    __spawnCalls: Array<{ cmd: string; args: string[]; proc: MockProc }>;
    __execFileCalls: Array<{ cmd: string; args: string[] }>;
    __setExecFileResult: (r: { stdout: string } | Error) => void;
    __setWhich: (names: string[]) => void;
    __reset: () => void;
  };
}

beforeEach(async () => { (await loadCpMock()).__reset(); });

describe("platform/darwin", () => {
  it("copyText pipes to pbcopy", async () => {
    const { copyText } = await import("../.pi/extensions/generative-ui/platform/darwin.js");
    const cp = await loadCpMock();
    await copyText("hello");
    expect(cp.__spawnCalls).toHaveLength(1);
    expect(cp.__spawnCalls[0].cmd).toBe("pbcopy");
    expect((cp.__spawnCalls[0].proc as unknown as { _stdinText?: string })._stdinText).toBe("hello");
  });

  it("chooseSavePath returns trimmed osascript output, null on empty", async () => {
    const { chooseSavePath } = await import("../.pi/extensions/generative-ui/platform/darwin.js");
    const cp = await loadCpMock();

    cp.__setExecFileResult({ stdout: "/Users/x/file.svg\n" });
    expect(await chooseSavePath("file.svg")).toBe("/Users/x/file.svg");

    cp.__setExecFileResult({ stdout: "\n" });
    expect(await chooseSavePath("file.svg")).toBeNull();

    const call = cp.__execFileCalls.find((c) => c.cmd === "osascript");
    expect(call).toBeDefined();
    expect(call!.args[0]).toBe("-e");
    expect(call!.args[1]).toContain("choose file name");
    expect(call!.args[1]).toContain('"file.svg"');
  });
});

describe("platform/linux", () => {
  it("copyText prefers wl-copy under Wayland", async () => {
    const { copyText } = await import("../.pi/extensions/generative-ui/platform/linux.js");
    const cp = await loadCpMock();
    cp.__setWhich(["wl-copy", "xclip"]);
    const prev = process.env.WAYLAND_DISPLAY;
    process.env.WAYLAND_DISPLAY = "wayland-0";
    try {
      await copyText("payload");
      const spawned = cp.__spawnCalls.find((c) => c.cmd === "wl-copy");
      expect(spawned).toBeDefined();
      expect((spawned!.proc as unknown as { _stdinText?: string })._stdinText).toBe("payload");
    } finally {
      if (prev === undefined) delete process.env.WAYLAND_DISPLAY;
      else process.env.WAYLAND_DISPLAY = prev;
    }
  });

  it("copyText falls back to xclip when no Wayland", async () => {
    const { copyText } = await import("../.pi/extensions/generative-ui/platform/linux.js");
    const cp = await loadCpMock();
    cp.__setWhich(["xclip"]);
    const prev = process.env.WAYLAND_DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    try {
      await copyText("payload");
      expect(cp.__spawnCalls.find((c) => c.cmd === "xclip")).toBeDefined();
    } finally {
      if (prev !== undefined) process.env.WAYLAND_DISPLAY = prev;
    }
  });

  it("copyText throws when no clipboard tool is installed", async () => {
    const { copyText } = await import("../.pi/extensions/generative-ui/platform/linux.js");
    const cp = await loadCpMock();
    cp.__setWhich([]);
    delete process.env.WAYLAND_DISPLAY;
    await expect(copyText("x")).rejects.toThrow(/No clipboard tool/);
  });

  it("chooseSavePath uses zenity with --filename", async () => {
    const { chooseSavePath } = await import("../.pi/extensions/generative-ui/platform/linux.js");
    const cp = await loadCpMock();
    cp.__setWhich(["zenity"]);
    cp.__setExecFileResult({ stdout: "/home/x/out.svg\n" });

    const path = await chooseSavePath("out.svg");
    expect(path).toBe("/home/x/out.svg");
    const call = cp.__execFileCalls.find((c) => c.cmd === "zenity");
    expect(call!.args).toContain("--file-selection");
    expect(call!.args).toContain("--save");
    expect(call!.args).toContain("--filename=out.svg");
  });
});

describe("platform/index", () => {
  it("returns a Platform implementation for the current process", async () => {
    const { getPlatform } = await import("../.pi/extensions/generative-ui/platform/index.js");
    const p = getPlatform();
    expect(["darwin", "linux", "win32"]).toContain(p.name);
    expect(typeof p.copyText).toBe("function");
    expect(typeof p.chooseSavePath).toBe("function");
  });
});
