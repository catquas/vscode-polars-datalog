import { shortHash } from './pyExpr';

/**
 * Where Datalog writes its output. "workspace" keeps files next to the code
 * (visible in the Explorer, survives restarts); "temp" writes to a per-workspace
 * folder under the OS temp directory that Datalog prunes by age and can delete
 * when VS Code closes.
 */
export type OutputLocation = 'workspace' | 'temp';

export const TEMP_ROOT_NAME = 'vscode-datalog';

export const DEFAULT_OUTPUT_LOCATION: OutputLocation = 'temp';

export function coerceOutputLocation(value: unknown): OutputLocation {
  return value === 'workspace' ? 'workspace' : DEFAULT_OUTPUT_LOCATION;
}

/** Minimal subset of node:fs used here, injected so it can be faked in tests. */
export interface FileSystemLike {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  readdirSync(path: string): string[];
  statSync(path: string): { mtimeMs: number };
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, data: string, encoding: string): void;
}

/** Join path segments with forward slashes; Node accepts them on Windows too. */
export function joinPath(...parts: string[]): string {
  return parts
    .map(part => part.replace(/\\/g, '/'))
    .filter(part => part !== '')
    .map((part, index) => (index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, '')))
    .join('/');
}

export function tempRootDir(tmpDir: string): string {
  return joinPath(tmpDir, TEMP_ROOT_NAME);
}

/**
 * Stable folder name for a workspace: readable basename plus a hash of the full
 * path so two folders with the same name never collide.
 */
export function workspaceKey(workspacePath: string | undefined): string {
  const normalized = (workspacePath ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized === '') { return 'no-workspace'; }
  const base = normalized.split('/').pop() ?? 'workspace';
  const safeBase = base.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40) || 'workspace';
  return `${safeBase}-${shortHash(normalized)}`;
}

export function sessionDir(tmpDir: string, workspacePath: string | undefined): string {
  return joinPath(tempRootDir(tmpDir), workspaceKey(workspacePath));
}

/** True when `target` is inside `root` — deletions are refused otherwise. */
export function isInside(root: string, target: string): boolean {
  const normalizedRoot = joinPath(root);
  const normalizedTarget = joinPath(target);
  return normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(normalizedRoot + '/');
}

export function ensureDir(fs: FileSystemLike, dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

/** Delete a file or folder, but only inside `root`. Returns true if removed. */
export function deleteInside(fs: FileSystemLike, root: string, target: string): boolean {
  if (!isInside(root, target) || joinPath(target) === joinPath(root)) { return false; }
  try {
    if (!fs.existsSync(target)) { return false; }
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Age of an entry, taking its immediate children into account.
 *
 * A directory's own mtime only moves when entries are added or removed, so a
 * folder that is still being written to every debug session would otherwise
 * look stale to another VS Code window and get pruned out from under it.
 */
export function newestMtime(fs: FileSystemLike, path: string): number {
  let newest = fs.statSync(path).mtimeMs;
  let children: string[];
  try {
    children = fs.readdirSync(path);
  } catch {
    return newest;
  }
  for (const child of children) {
    try {
      newest = Math.max(newest, fs.statSync(joinPath(path, child)).mtimeMs);
    } catch { /* vanished between readdir and stat */ }
  }
  return newest;
}

/**
 * Remove entries directly under `dir` last modified more than `maxAgeMs` ago.
 * With `maxAgeMs <= 0` nothing is removed. Returns the names removed.
 */
export function pruneStaleEntries(
  fs: FileSystemLike,
  root: string,
  dir: string,
  maxAgeMs: number,
  now: number,
  skip: string[] = []
): string[] {
  if (maxAgeMs <= 0 || !isInside(root, dir)) { return []; }
  let entries: string[];
  try {
    if (!fs.existsSync(dir)) { return []; }
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (skip.includes(entry)) { continue; }
    const target = joinPath(dir, entry);
    let mtimeMs: number;
    try {
      mtimeMs = newestMtime(fs, target);
    } catch {
      continue;
    }
    if (now - mtimeMs <= maxAgeMs) { continue; }
    if (deleteInside(fs, root, target)) { removed.push(entry); }
  }
  return removed;
}

/**
 * Write the file. With `force` false an identical file is left alone, so
 * repeated syncs do not rewrite it; with `force` true the write always happens,
 * which also refreshes the mtime that age pruning looks at.
 */
export function writeFileIfChanged(
  fs: FileSystemLike,
  path: string,
  content: string,
  force = false
): boolean {
  try {
    if (!force && fs.existsSync(path) && fs.readFileSync(path, 'utf8') === content) {
      return true;
    }
    fs.writeFileSync(path, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}
