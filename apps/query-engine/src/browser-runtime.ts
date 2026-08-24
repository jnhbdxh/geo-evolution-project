import { existsSync } from "node:fs";

export function resolveBrowserExecutablePath(
  explicitPath: string | undefined = process.env.QUERY_ENGINE_BROWSER_EXECUTABLE_PATH,
): string | undefined {
  if (explicitPath !== undefined && explicitPath.trim().length > 0) return explicitPath;
  if (process.platform !== "win32") return undefined;

  const candidates = [
    process.env.LOCALAPPDATA === undefined
      ? undefined
      : `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA === undefined
      ? undefined
      : `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env.PROGRAMFILES === undefined
      ? undefined
      : `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env["PROGRAMFILES(X86)"] === undefined
      ? undefined
      : `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  return candidates.find((candidate): candidate is string =>
    candidate === undefined ? false : existsSync(candidate),
  );
}
