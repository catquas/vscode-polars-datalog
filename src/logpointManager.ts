import * as vscode from 'vscode';
import { DataFrameAssignment } from './pythonAnalyzer';
import { buildLogMessage, ExportConfig } from './sasFormatter';

/**
 * Find the first executable line at or after `startAt` (0-based).
 * Skips blank lines and comment-only lines.
 * Falls back to `startAt` capped at `maxLine` if nothing found.
 */
function nextExecutableLine(sourceLines: string[], startAt: number, maxLine: number): number {
  for (let i = startAt; i <= maxLine; i++) {
    const stripped = (sourceLines[i] ?? '').trim();
    if (stripped && !stripped.startsWith('#')) {
      return i;
    }
  }
  return Math.min(startAt, maxLine);
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
    sourceLines: string[],
    exportConfig?: ExportConfig
  ): Promise<void> {
    this.removeForFile(uri);

    if (assignments.length === 0) {
      return;
    }

    const maxLine = sourceLines.length - 1;
    const breakpoints: vscode.SourceBreakpoint[] = [];

    for (const assignment of assignments) {
      // Start looking from the line after the assignment ends.
      // nextExecutableLine skips blanks/comments so we always land on a
      // real Python statement where all assigned variables are in scope.
      const logLine = nextExecutableLine(sourceLines, assignment.range.endLine + 1, maxLine);
      const logMessage = buildLogMessage(assignment, exportConfig);

      const bp = new vscode.SourceBreakpoint(
        new vscode.Location(uri, new vscode.Range(logLine, 0, logLine, 0)),
        true,
        undefined,
        undefined,
        logMessage
      );

      breakpoints.push(bp);
    }

    this.managedBreakpoints.set(uri.toString(), breakpoints);
    vscode.debug.addBreakpoints(breakpoints);
  }

  removeForFile(uri: vscode.Uri): void {
    const key = uri.toString();
    const existing = this.managedBreakpoints.get(key);
    if (existing && existing.length > 0) {
      vscode.debug.removeBreakpoints(existing);
    }
    this.managedBreakpoints.delete(key);
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
