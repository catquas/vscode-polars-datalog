"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogpointManager = void 0;
const vscode = require("vscode");
const sasFormatter_1 = require("./sasFormatter");
/**
 * Find the first executable line at or after `startAt` (0-based).
 * Skips blank lines and comment-only lines.
 * Falls back to `startAt` capped at `maxLine` if nothing found.
 */
function nextExecutableLine(sourceLines, startAt, maxLine) {
    for (let i = startAt; i <= maxLine; i++) {
        const stripped = (sourceLines[i] ?? '').trim();
        if (stripped && !stripped.startsWith('#')) {
            return i;
        }
    }
    return Math.min(startAt, maxLine);
}
class LogpointManager {
    constructor() {
        this.managedBreakpoints = new Map();
    }
    /**
     * Sync logpoints for a single file.
     * sourceLines must be the file content split by '\n' (with \r already stripped).
     */
    async syncForFile(uri, assignments, printVars, sourceLines, exportConfig) {
        this.removeForFile(uri);
        if (assignments.length === 0 && printVars.length === 0) {
            return;
        }
        const maxLine = sourceLines.length - 1;
        const breakpoints = [];
        for (const assignment of assignments) {
            // Start looking from the line after the assignment ends.
            // nextExecutableLine skips blanks/comments so we always land on a
            // real Python statement where all assigned variables are in scope.
            const logLine = nextExecutableLine(sourceLines, assignment.range.endLine + 1, maxLine);
            const logMessage = (0, sasFormatter_1.buildLogMessage)(assignment, exportConfig);
            breakpoints.push(new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Range(logLine, 0, logLine, 0)), true, undefined, '1', // fire once per debug session; debugpy traces multi-line expressions multiple times
            logMessage));
        }
        for (const pv of printVars) {
            breakpoints.push(new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Range(Math.min(pv.line, maxLine), 0, Math.min(pv.line, maxLine), 0)), true, undefined, '1', (0, sasFormatter_1.buildPrintVarLogMessage)(pv.varName)));
        }
        this.managedBreakpoints.set(uri.toString(), breakpoints);
        vscode.debug.addBreakpoints(breakpoints);
    }
    removeForFile(uri) {
        const key = uri.toString();
        const existing = this.managedBreakpoints.get(key);
        if (existing && existing.length > 0) {
            vscode.debug.removeBreakpoints(existing);
        }
        this.managedBreakpoints.delete(key);
    }
    purgeStale() {
        // Use duck-typing instead of instanceof — VS Code may return proxy objects
        // from vscode.debug.breakpoints that don't pass instanceof checks.
        const stale = vscode.debug.breakpoints.filter(bp => bp.logMessage?.includes('===DATALOG==='));
        if (stale.length > 0) {
            vscode.debug.removeBreakpoints(stale);
        }
        return stale.length;
    }
    clearAll() {
        const all = [];
        for (const bps of this.managedBreakpoints.values()) {
            all.push(...bps);
        }
        if (all.length > 0) {
            vscode.debug.removeBreakpoints(all);
        }
        this.managedBreakpoints.clear();
    }
    dispose() {
        this.clearAll();
    }
}
exports.LogpointManager = LogpointManager;
//# sourceMappingURL=logpointManager.js.map