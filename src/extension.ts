import * as vscode from 'vscode';
import { analyzeFile, AnalyzerConfig } from './pythonAnalyzer';
import { LogpointManager } from './logpointManager';
import { ExportConfig } from './sasFormatter';
import { TracebackFilter } from './outputFilter';

// Available at runtime in VS Code's Node.js extension host; not in @types/vscode
declare function require(id: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any

let manager: LogpointManager;
let log: vscode.OutputChannel;
let currentLogFilePath = '';

/** Write to both the Output Channel and plog.log (fire-and-forget for the file). */
function logLine(text: string): void {
  log.appendLine(text);
  if (!currentLogFilePath) { return; }
  try {
    // require is available at runtime in VS Code's CommonJS extension host
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('fs').appendFileSync(currentLogFilePath, text + '\n');
  } catch { /* ignore write errors */ }
}

function resolveLogFilePath(): string {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!wsRoot) { return ''; }
  const logFile = vscode.workspace.getConfiguration('vscode-datalog').get<string>('logFile', 'plog.log');
  return logFile ? vscode.Uri.joinPath(wsRoot, logFile).fsPath : '';
}

function getConfig(): AnalyzerConfig & { enabled: boolean } & ExportConfig {
  const cfg = vscode.workspace.getConfiguration('vscode-datalog');
  const sampleOutputFolder = cfg.get<string>('sampleOutputFolder', 'worklib');
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  currentLogFilePath = resolveLogFilePath();
  return {
    polarsAlias: cfg.get<string>('polarsAlias', 'pl'),
    dfNameSuffixes: cfg.get<string[]>('dfNameSuffixes', ['_df', 'df', '_data']),
    enabled: cfg.get<boolean>('enabled', true),
    exportSamples: cfg.get<boolean>('exportSamples', true),
    sampleRows: cfg.get<number>('sampleRows', 1000),
    outputFolderAbsPath: wsRoot ? vscode.Uri.joinPath(wsRoot, sampleOutputFolder).fsPath : '',
    logFileAbsPath: currentLogFilePath,
  };
}

function isPythonSession(session: vscode.DebugSession): boolean {
  return session.type === 'python' || session.type === 'debugpy';
}

async function syncAllPythonEditors(): Promise<void> {
  const config = getConfig();
  if (!config.enabled) {
    logLine('Skipping sync — extension is disabled in settings.');
    return;
  }

  const editors = vscode.window.visibleTextEditors.filter(
    e => e.document.languageId === 'python'
  );
  logLine(`Visible Python editors: ${editors.length}`);

  for (const editor of editors) {
    await syncDocument(editor.document, config);
  }
}

async function syncDocument(
  document: vscode.TextDocument,
  config: AnalyzerConfig & ExportConfig
): Promise<void> {
  const source = document.getText();
  const sourceLines = source.replace(/\r/g, '').split('\n');
  const assignments = analyzeFile(source, config);
  logLine(`  ${document.fileName}: found ${assignments.length} DataFrame assignment(s)`);
  for (const a of assignments) {
    logLine(`    → ${a.varName} (lines ${a.range.startLine + 1}–${a.range.endLine + 1}), inputs: [${a.inputVars.join(', ')}]`);
  }
  await manager.syncForFile(document.uri, assignments, sourceLines, config);
}

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel('Datalog');
  context.subscriptions.push(log);

  manager = new LogpointManager();
  context.subscriptions.push(manager);

  // Resolve log file path before first logLine call
  currentLogFilePath = resolveLogFilePath();

  logLine('Datalog extension activated.');
  log.show(true); // show without stealing focus

  // --- Debug session lifecycle ---

  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async (session) => {
      logLine(`Debug session started: type="${session.type}" name="${session.name}"`);
      if (!isPythonSession(session)) {
        logLine('  → Not a Python/debugpy session, skipping.');
        return;
      }
      logLine('  → Python session detected, syncing logpoints...');
      await syncAllPythonEditors();
    })
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      logLine(`Debug session ended: type="${session.type}"`);
      if (isPythonSession(session)) {
        manager.clearAll();
        logLine('  → Logpoints cleared.');
      }
    })
  );

  // --- Auto-refresh on save ---

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId !== 'python') {
        return;
      }
      const config = getConfig();
      if (!config.enabled) {
        return;
      }
      const activeSession = vscode.debug.activeDebugSession;
      if (activeSession && isPythonSession(activeSession)) {
        logLine(`File saved, re-syncing: ${document.fileName}`);
        await syncDocument(document, config);
      }
    })
  );

  // --- Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.refreshLogpoints', async () => {
      logLine('Command: refreshLogpoints');
      const config = getConfig();
      if (!config.enabled) {
        vscode.window.showInformationMessage('Datalog is disabled. Enable it in settings first.');
        return;
      }
      await syncAllPythonEditors();
      vscode.window.showInformationMessage('Datalog: Logpoints refreshed.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.clearLogpoints', () => {
      logLine('Command: clearLogpoints');
      manager.clearAll();
      vscode.window.showInformationMessage('Datalog: All logpoints cleared.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.focusWorklib', async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!wsRoot) {
        vscode.window.showWarningMessage('Datalog: No workspace folder is open.');
        return;
      }
      const cfg = vscode.workspace.getConfiguration('vscode-datalog');
      const folder = cfg.get<string>('sampleOutputFolder', 'worklib');
      const folderUri = vscode.Uri.joinPath(wsRoot, folder);
      try {
        await vscode.workspace.fs.stat(folderUri);
      } catch {
        vscode.window.showWarningMessage(`Datalog: Folder "${folder}" does not exist yet.`);
        return;
      }
      await vscode.commands.executeCommand('workbench.view.explorer');
      await vscode.commands.executeCommand('revealInExplorer', folderUri);
    })
  );

  // --- Capture stdout/stderr from Python debug sessions → plog.log ---
  //
  // We use a DebugAdapterTrackerFactory to intercept DAP 'output' events.
  // Only 'stdout' and 'stderr' categories are written; 'console' is skipped
  // because that is where evaluated logpoint expressions appear — they already
  // write directly to plog.log via the Python side-effect expression, so
  // capturing them here would duplicate entries.

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker(session: vscode.DebugSession) {
        if (!isPythonSession(session)) { return undefined; }

        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!wsRoot) { return undefined; }

        const cfg = vscode.workspace.getConfiguration('vscode-datalog');
        const logFile = cfg.get<string>('logFile', 'plog.log');
        if (!logFile) { return undefined; }
        const logPath = vscode.Uri.joinPath(wsRoot, logFile).fsPath;

        const filter = new TracebackFilter(wsRoot.fsPath);

        function appendFiltered(text: string): void {
          if (!text) { return; }
          try { require('fs').appendFileSync(logPath, text); } catch { /* ignore */ }
        }

        return {
          onDidSendMessage(message: { type: string; event?: string; body?: { category?: string; output?: string } }): void {
            if (message.type !== 'event' || message.event !== 'output') { return; }
            const cat = message.body?.category ?? 'stdout';
            if (cat !== 'stdout' && cat !== 'stderr') { return; }
            appendFiltered(filter.feed(message.body?.output ?? ''));
          },
          onWillStopSession(): void {
            appendFiltered(filter.flush());
          },
        };
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.openPlog', async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!wsRoot) {
        vscode.window.showWarningMessage('Datalog: No workspace folder is open.');
        return;
      }
      const cfg = vscode.workspace.getConfiguration('vscode-datalog');
      const logFile = cfg.get<string>('logFile', 'plog.log');
      const logUri = vscode.Uri.joinPath(wsRoot, logFile);
      try {
        await vscode.workspace.fs.stat(logUri);
      } catch {
        vscode.window.showWarningMessage(`Datalog: "${logFile}" does not exist yet. Run a debug session first.`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument(logUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );
}

export function deactivate(): void {
  // manager and log disposed via context.subscriptions
}
