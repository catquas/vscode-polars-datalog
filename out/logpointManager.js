"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogpointManager = void 0;
const vscode = __importStar(require("vscode"));
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
    async syncForFile(uri, assignments, sourceLines, exportConfig) {
        this.removeForFile(uri);
        if (assignments.length === 0) {
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
            const bp = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Range(logLine, 0, logLine, 0)), true, undefined, undefined, logMessage);
            breakpoints.push(bp);
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