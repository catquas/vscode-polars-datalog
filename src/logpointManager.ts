import * as vscode from 'vscode';
import { DataFrameAssignment, PrintVarStatement } from './pythonAnalyzer';
import { buildLogMessage, buildPrintVarLogMessage, ExportConfig } from './sasFormatter';

/** Shared by every generated runtime logpoint, whatever the runtime version. */
const RUNTIME_CACHE_ATTR_PREFIX = '_datalog_rt_';

export interface SyncResult {
  placed: number;
  skipped: Array<{ varName: string; line: number; reason: string }>;
}

function fileLabel(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? uri.path;
}

export class LogpointManager implements vscode.Disposable {
  private managedBreakpoints = new Map<string, vscode.SourceBreakpoint[]>();

  /**
   * Sync logpoints for a single file.
   * sourceLines must be the file content split by '\n' (with \r already stripped).
   */
  async syncForFile(
    uri: vscode.Uri,
    assignments: DataFrameAssignment[],
    printVars: PrintVarStatement[],
    sourceLines: string[],
    exportConfig?: ExportConfig
  ): Promise<SyncResult> {
    this.removeForFile(uri);

    const result: SyncResult = { placed: 0, skipped: [] };
    if (assignments.length === 0 && printVars.length === 0) {
      return result;
    }

    const maxLine = Math.max(0, sourceLines.length - 1);
    const label = fileLabel(uri);
    const breakpoints: vscode.SourceBreakpoint[] = [];

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
      const located: DataFrameAssignment = {
        ...assignment,
        location: `${label}:${assignment.range.startLine + 1}`,
      };
      const line = assignment.logLine;
      breakpoints.push(new vscode.SourceBreakpoint(
        new vscode.Location(uri, new vscode.Range(line, 0, line, 0)),
        true, undefined, undefined,
        buildLogMessage(located, exportConfig)
      ));
      result.placed++;
    }

    for (const pv of printVars) {
      const line = Math.min(pv.line, maxLine);
      breakpoints.push(new vscode.SourceBreakpoint(
        new vscode.Location(uri, new vscode.Range(line, 0, line, 0)),
        true, undefined, undefined,
        buildPrintVarLogMessage(pv.varName, exportConfig)
      ));
    }

    if (breakpoints.length > 0) {
      this.managedBreakpoints.set(uri.toString(), breakpoints);
      vscode.debug.addBreakpoints(breakpoints);
    }
    return result;
  }

  removeForFile(uri: vscode.Uri): void {
    const key = uri.toString();
    const existing = this.managedBreakpoints.get(key);
    if (existing && existing.length > 0) {
      vscode.debug.removeBreakpoints(existing);
    }
    this.managedBreakpoints.delete(key);
  }

  purgeStale(): number {
    // Use duck-typing instead of instanceof — VS Code may return proxy objects
    // from vscode.debug.breakpoints that don't pass instanceof checks.
    const stale = vscode.debug.breakpoints.filter(bp => {
      const message = (bp as vscode.SourceBreakpoint).logMessage ?? '';
      // Runtime-backed logpoints carry the cache attribute; the inline
      // fallback carries the block header.
      return message.includes(RUNTIME_CACHE_ATTR_PREFIX) || message.includes('===DATALOG===');
    });
    if (stale.length > 0) {
      vscode.debug.removeBreakpoints(stale);
    }
    return stale.length;
  }

  clearAll(): void {
    const all: vscode.SourceBreakpoint[] = [];
    for (const bps of this.managedBreakpoints.values()) {
      all.push(...bps);
    }
    if (all.length > 0) {
      vscode.debug.removeBreakpoints(all);
    }
    this.managedBreakpoints.clear();
  }

  dispose(): void {
    this.clearAll();
  }
}
