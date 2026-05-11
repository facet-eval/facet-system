import { existsSync, statSync } from "node:fs";
import path from "node:path";

const PATH_SEPARATOR = process.platform === "win32" ? ";" : ":";
const EXE_EXTENSIONS: readonly string[] =
  process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function isBinaryOnPath(
  binary: string,
  pathEnv: string | undefined = process.env.PATH,
): boolean {
  if (binary.length === 0) return false;
  if (pathEnv === undefined || pathEnv.length === 0) return false;
  for (const dir of pathEnv.split(PATH_SEPARATOR)) {
    if (dir.length === 0) continue;
    for (const ext of EXE_EXTENSIONS) {
      const candidate = path.join(dir, binary + ext);
      if (existsSync(candidate) && isFile(candidate)) {
        return true;
      }
    }
  }
  return false;
}
