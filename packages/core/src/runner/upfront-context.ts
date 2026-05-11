// Generic upfront-context exec wrapper (Phase 5 / architecture doc §R2).
//
// For each `upfront_context` item that applies to the current scenario,
// the runner exec's `command` with `args` in `cwd`, prepends the
// declared `header` to the command's stdout, and joins blocks with
// `\n\n` before they are appended to the assistant's system prompt.
// The script is responsible for any internal Markdown structure
// (sub-sections, code fences, prose) — the wrapper only stamps the
// outer header so the framework can locate the block in the system
// prompt without having to parse it.
//
// Substitution variable set is closed (deliberately small):
// - `${WORKSPACE}` — the run's per-execution worktree path. Substituted
//   in `cwd` and every `args` entry. Profile authors can pass extra
//   information via shell-script logic; adding a new placeholder
//   requires a deliberate framework change.
//
// Profile-specific source-walk logic (language-specific dependency
// graphs, custom upfront analyses, etc.) belongs in profile-supplied
// shell scripts under `<profilePath>/<command-relative-path>`, not in
// this module.

import { execFile } from "node:child_process";
import path from "node:path";

import type { ExtensionsManifest, UpfrontContextItem } from "./extensions.js";

export class UpfrontContextError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UpfrontContextError";
  }
}

export interface UpfrontContextRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

export type UpfrontContextRun = (
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<UpfrontContextRunResult>;

export const DEFAULT_UPFRONT_TIMEOUT_MS = 60_000;

export const defaultUpfrontContextRun: UpfrontContextRun = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = execFile(
      cmd,
      [...args],
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      },
      (_err, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          code: child.exitCode,
        });
      },
    );
  });

export interface PrepareUpfrontContextParams {
  readonly extensions: ExtensionsManifest | undefined;
  readonly profilePath: string;
  readonly scenarioId: string;
  readonly workspacePath: string;
  readonly run?: UpfrontContextRun;
}

export async function prepareUpfrontContext(
  params: PrepareUpfrontContextParams,
): Promise<string | undefined> {
  const items = (params.extensions?.upfrontContext ?? []).filter((it) =>
    it.appliesToScenarios.includes(params.scenarioId),
  );
  if (items.length === 0) return undefined;
  const run = params.run ?? defaultUpfrontContextRun;

  const blocks: string[] = [];
  for (const item of items) {
    blocks.push(
      await renderItem({
        item,
        profilePath: params.profilePath,
        workspacePath: params.workspacePath,
        run,
      }),
    );
  }
  return blocks.join("\n\n");
}

interface RenderItemContext {
  readonly item: UpfrontContextItem;
  readonly profilePath: string;
  readonly workspacePath: string;
  readonly run: UpfrontContextRun;
}

function substitute(value: string, workspacePath: string): string {
  return value.replace(/\$\{WORKSPACE\}/g, workspacePath);
}

async function renderItem(ctx: RenderItemContext): Promise<string> {
  const cwdRaw = substitute(ctx.item.cwd, ctx.workspacePath);
  const cwd = path.isAbsolute(cwdRaw)
    ? cwdRaw
    : path.resolve(ctx.profilePath, cwdRaw);
  const args = ctx.item.args.map((a) => substitute(a, ctx.workspacePath));
  const timeoutMs = ctx.item.timeoutMs ?? DEFAULT_UPFRONT_TIMEOUT_MS;

  const result = await ctx.run(ctx.item.command, args, { cwd, timeoutMs });
  if (result.code !== 0) {
    throw new UpfrontContextError(
      `upfront_context command \`${ctx.item.command} ${args.join(" ")}\` failed (exit ${
        result.code ?? "null"
      }) in ${cwd}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }

  return `${ctx.item.header}\n\n${result.stdout.trimEnd()}`;
}
