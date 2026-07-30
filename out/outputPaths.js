"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_OUTPUT_LOCATION = exports.TEMP_ROOT_NAME = void 0;
exports.coerceOutputLocation = coerceOutputLocation;
exports.joinPath = joinPath;
exports.tempRootDir = tempRootDir;
exports.workspaceKey = workspaceKey;
exports.sessionDir = sessionDir;
exports.isInside = isInside;
exports.ensureDir = ensureDir;
exports.deleteInside = deleteInside;
exports.newestMtime = newestMtime;
exports.pruneStaleEntries = pruneStaleEntries;
exports.writeFileIfChanged = writeFileIfChanged;
const pyExpr_1 = require("./pyExpr");
exports.TEMP_ROOT_NAME = 'vscode-datalog';
exports.DEFAULT_OUTPUT_LOCATION = 'temp';
function coerceOutputLocation(value) {
    return value === 'workspace' ? 'workspace' : exports.DEFAULT_OUTPUT_LOCATION;
}
/** Join path segments with forward slashes; Node accepts them on Windows too. */
function joinPath(...parts) {
    return parts
        .map(part => part.replace(/\\/g, '/'))
        .filter(part => part !== '')
        .map((part, index) => (index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, '')))
        .join('/');
}
function tempRootDir(tmpDir) {
    return joinPath(tmpDir, exports.TEMP_ROOT_NAME);
}
/**
 * Stable folder name for a workspace: readable basename plus a hash of the full
 * path so two folders with the same name never collide.
 */
function workspaceKey(workspacePath) {
    const normalized = (workspacePath ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized === '') {
        return 'no-workspace';
    }
    const base = normalized.split('/').pop() ?? 'workspace';
    const safeBase = base.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40) || 'workspace';
    return `${safeBase}-${(0, pyExpr_1.shortHash)(normalized)}`;
}
function sessionDir(tmpDir, workspacePath) {
    return joinPath(tempRootDir(tmpDir), workspaceKey(workspacePath));
}
/** True when `target` is inside `root` — deletions are refused otherwise. */
function isInside(root, target) {
    const normalizedRoot = joinPath(root);
    const normalizedTarget = joinPath(target);
    return normalizedTarget === normalizedRoot ||
        normalizedTarget.startsWith(normalizedRoot + '/');
}
function ensureDir(fs, dir) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return true;
    }
    catch {
        return false;
    }
}
/** Delete a file or folder, but only inside `root`. Returns true if removed. */
function deleteInside(fs, root, target) {
    if (!isInside(root, target) || joinPath(target) === joinPath(root)) {
        return false;
    }
    try {
        if (!fs.existsSync(target)) {
            return false;
        }
        fs.rmSync(target, { recursive: true, force: true });
        return true;
    }
    catch {
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
function newestMtime(fs, path) {
    let newest = fs.statSync(path).mtimeMs;
    let children;
    try {
        children = fs.readdirSync(path);
    }
    catch {
        return newest;
    }
    for (const child of children) {
        try {
            newest = Math.max(newest, fs.statSync(joinPath(path, child)).mtimeMs);
        }
        catch { /* vanished between readdir and stat */ }
    }
    return newest;
}
/**
 * Remove entries directly under `dir` last modified more than `maxAgeMs` ago.
 * With `maxAgeMs <= 0` nothing is removed. Returns the names removed.
 */
function pruneStaleEntries(fs, root, dir, maxAgeMs, now, skip = []) {
    if (maxAgeMs <= 0 || !isInside(root, dir)) {
        return [];
    }
    let entries;
    try {
        if (!fs.existsSync(dir)) {
            return [];
        }
        entries = fs.readdirSync(dir);
    }
    catch {
        return [];
    }
    const removed = [];
    for (const entry of entries) {
        if (skip.includes(entry)) {
            continue;
        }
        const target = joinPath(dir, entry);
        let mtimeMs;
        try {
            mtimeMs = newestMtime(fs, target);
        }
        catch {
            continue;
        }
        if (now - mtimeMs <= maxAgeMs) {
            continue;
        }
        if (deleteInside(fs, root, target)) {
            removed.push(entry);
        }
    }
    return removed;
}
/**
 * Write the file. With `force` false an identical file is left alone, so
 * repeated syncs do not rewrite it; with `force` true the write always happens,
 * which also refreshes the mtime that age pruning looks at.
 */
function writeFileIfChanged(fs, path, content, force = false) {
    try {
        if (!force && fs.existsSync(path) && fs.readFileSync(path, 'utf8') === content) {
            return true;
        }
        fs.writeFileSync(path, content, 'utf8');
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=outputPaths.js.map