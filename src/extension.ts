import * as vscode from 'vscode';
import { analyzeFile, AnalyzerConfig } from './pythonAnalyzer';
import { LogpointManager } from './logpointManager';

let manager: LogpointManager;
let log: vscode.OutputChannel;

function getConfig(): AnalyzerConfig & { enabled: boolean } {
  const cfg = vscode.workspace.getConfiguration('vscode-datalog');
  return {
    polarsAlias: cfg.get<string>('polarsAlias', 'pl'),
    dfNameSuffixes: cfg.get<string[]>('dfNameSuffixes', ['_df', 'df', '_data']),
    enabled: cfg.get<boolean>('enabled', true),
  };
}

function isPythonSession(session: vscode.DebugSession): boolean {
  return session.type === 'python' || session.type === 'debugpy';
}

async function syncAllPythonEditors(): Promise<void> {
  const config = getConfig();
  if (!config.enabled) {
    log.appendLine('Skipping sync — extension is disabled in settings.');
    return;
  }

  const editors = vscode.window.visibleTextEditors.filter(
    e => e.document.languageId === 'python'
  );
  log.appendLine(`Visible Python editors: ${editors.length}`);

  for (const editor of editors) {
    await syncDocument(editor.document, config);
  }
}

async function syncDocument(
  document: vscode.TextDocument,
  config: AnalyzerConfig
): Promise<void> {
  const source = document.getText();
  const sourceLines = source.replace(/\r/g, '').split('\n');
  const assignments = analyzeFile(source, config);
  log.appendLine(`  ${document.fileName}: found ${assignments.length} DataFrame assignment(s)`);
  for (const a of assignments) {
    log.appendLine(`    → ${a.varName} (lines ${a.range.startLine + 1}–${a.range.endLine + 1}), inputs: [${a.inputVars.join(', ')}]`);
  }
  await manager.syncForFile(document.uri, assignments, sourceLines);
}

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel('Datalog');
  context.subscriptions.push(log);

  manager = new LogpointManager();
  context.subscriptions.push(manager);

  log.appendLine('Datalog extension activated.');
  log.show(true); // show without stealing focus

  // --- Debug session lifecycle ---

  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async (session) => {
      log.appendLine(`Debug session started: type="${session.type}" name="${session.name}"`);
      if (!isPythonSession(session)) {
        log.appendLine('  → Not a Python/debugpy session, skipping.');
        return;
      }
      log.appendLine('  → Python session detected, syncing logpoints...');
      await syncAllPythonEditors();
    })
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      log.appendLine(`Debug session ended: type="${session.type}"`);
      if (isPythonSession(session)) {
        manager.clearAll();
        log.appendLine('  → Logpoints cleared.');
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
        log.appendLine(`File saved, re-syncing: ${document.fileName}`);
        await syncDocument(document, config);
      }
    })
  );

  // --- Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.refreshLogpoints', async () => {
      log.appendLine('Command: refreshLogpoints');
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
      log.appendLine('Command: clearLogpoints');
      manager.clearAll();
      vscode.window.showInformationMessage('Datalog: All logpoints cleared.');
    })
  );
}

export function deactivate(): void {
  // manager and log disposed via context.subscriptions
}
