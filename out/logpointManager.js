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
/** Shared by every generated runtime logpoint, whatever the runtime version. */
const RUNTIME_CACHE_ATTR_PREFIX = '_datalog_rt_';
function fileLabel(uri) {
    return uri.path.split('/').pop() ?? uri.path;
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
        const result = { placed: 0, skipped: [] };
        if (assignments.length === 0 && printVars.length === 0) {
            return result;
        }
        const maxLine = Math.max(0, sourceLines.length - 1);
        const label = fileLabel(uri);
        const breakpoints = [];
        for (const assignment of assignments) {
            // The analyzer picks the line: the first statement after the assignment
            // that still sees the value. -1 means there is no such line.
            if (assignment.logLine < 0 || assignment.logLine > maxLine) {
                result.skipped.push({
                    varName: assignment.varName,
                    line: assignment.range.startLine + 1,
                    reason: assignment.skipReason ?? 'no line available for a logpoint',
                });
                continue;
            }
            const located = {
                ...assignment,
                location: `${label}:${assignment.range.startLine + 1}`,
            };
            const line = assignment.logLine;
            breakpoints.push(new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Range(line, 0, line, 0)), true, undefined, undefined, (0, sasFormatter_1.buildLogMessage)(located, exportConfig)));
            result.placed++;
        }
        for (const pv of printVars) {
            const line = Math.min(pv.line, maxLine);
            breakpoints.push(new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Range(line, 0, line, 0)), true, undefined, undefined, (0, sasFormatter_1.buildPrintVarLogMessage)(pv.varName, exportConfig)));
        }
        if (breakpoints.length > 0) {
            this.managedBreakpoints.set(uri.toString(), breakpoints);
            vscode.debug.addBreakpoints(breakpoints);
        }
        return result;
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
        const stale = vscode.debug.breakpoints.filter(bp => {
            const message = bp.logMessage ?? '';
            // Runtime-backed logpoints carry the cache attribute; the inline
            // fallback carries the block header.
            return message.includes(RUNTIME_CACHE_ATTR_PREFIX) || message.includes('===DATALOG===');
        });
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