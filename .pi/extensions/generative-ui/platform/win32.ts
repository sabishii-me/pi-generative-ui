import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const name = "win32" as const;

/**
 * PowerShell handles both clipboard (Set-Clipboard) and the native Save
 * As dialog (System.Windows.Forms.SaveFileDialog). We invoke pwsh/powershell
 * with an encoded command to sidestep quoting hell.
 */

function encodeCommand(ps: string): string {
  return Buffer.from(ps, "utf16le").toString("base64");
}

async function runPS(ps: string): Promise<string> {
  const encoded = encodeCommand(ps);
  const cmd = process.env.PSExecutable || "powershell.exe";
  const { stdout } = await execFileAsync(cmd, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", encoded,
  ]);
  return stdout;
}

export async function copyText(text: string): Promise<void> {
  // Set-Clipboard reads from $input pipeline; pass via env to avoid quoting.
  const ps = `[Console]::In.ReadToEnd() | Set-Clipboard`;
  const encoded = encodeCommand(ps);
  const cmd = process.env.PSExecutable || "powershell.exe";
  await new Promise<void>((resolve, reject) => {
    const proc = execFile(cmd, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", encoded,
    ], (err) => err ? reject(err) : resolve());
    proc.stdin?.end(text);
  });
}

export async function chooseSavePath(suggestedName: string): Promise<string | null> {
  const ps = [
    `Add-Type -AssemblyName System.Windows.Forms`,
    `$dlg = New-Object System.Windows.Forms.SaveFileDialog`,
    `$dlg.FileName = ${JSON.stringify(suggestedName)}`,
    `$dlg.OverwritePrompt = $true`,
    `if ($dlg.ShowDialog() -eq 'OK') { Write-Output $dlg.FileName }`,
  ].join("; ");
  const stdout = await runPS(ps);
  const path = stdout.trim();
  return path || null;
}
