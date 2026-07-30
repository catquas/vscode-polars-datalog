import * as vscode from 'vscode';
import {
  analyzeSource,
  AnalyzerConfig,
  findDfReturningFunctions,
  findPrintVarStatements,
  formatDetectionReport,
} from './pythonAnalyzer';
import { LogpointManager } from './logpointManager';
import { ExportConfig } from './sasFormatter';
import {
  coerceLazyFrameMode,
  DATALOG_RUNTIME_SOURCE,
  DEFAULT_LAZY_FRAME_MODE,
  RUNTIME_FILE_NAME,
} from './pyRuntime';
import {
  coerceOutputLocation,
  DEFAULT_OUTPUT_LOCATION,
  deleteInside,
  ensureDir,
  FileSystemLike,
  joinPath,
  OutputLocation,
  pruneStaleEntries,
  sessionDir,
  tempRootDir,
  workspaceKey,
  writeFileIfChanged,
} from './outputPaths';

// Available at runtime in VS Code's Node.js extension host; not in @types/vscode
declare function require(id: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any

let manager: LogpointManager;
let log: vscode.OutputChannel;
let currentLogFilePath = '';
let currentLogExtensionOutput = false;
/**
 * Rewrite the runtime module even if its content is unchanged, so its mtime
 * keeps the temp folder clear of age pruning while a session is using it.
 */
let forceRuntimeRewrite = true;

interface DatalogConfig extends AnalyzerConfig, ExportConfig {
  enabled: boolean;
  outputLocation: OutputLocation;
  tempRetentionHours: number;
  deleteTempOnClose: boolean;
}

function fs(): FileSystemLike {
  return require('fs');
}

function osTmpDir(): string {
  try {
    return require('os').tmpdir();
  } catch {
    return '';
  }
}

function getWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function safeWorkspaceRelativeSetting(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: string
): string {
  const raw = cfg.get<unknown>(key, defaultValue);
  if (typeof raw !== 'string' || raw.trim() === '') {
    return defaultValue;
  }

  const normalized = raw.replace(/\\/g, '/');
  const isAbsolute = normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z]:\//.test(normalized);
  const parts = normalized.split('/');
  if (isAbsolute || parts.some(part => part === '' || part === '.' || part === '..')) {
    logLine(`Ignoring unsafe vscode-datalog.${key} setting: ${raw}`);
    return defaultValue;
  }

  return normalized;
}

function getOutputLocation(): OutputLocation {
  const cfg = vscode.workspace.getConfiguration('vscode-datalog');
  return coerceOutputLocation(cfg.get<unknown>('outputLocation', DEFAULT_OUTPUT_LOCATION));
}

/** Per-workspace folder under the OS temp directory. */
function currentSessionDir(): string {
  const tmp = osTmpDir();
  if (!tmp) { return ''; }
  return sessionDir(tmp, getWorkspaceRoot()?.fsPath);
}

/**
 * Absolute path for one of the workspace-relative settings, honouring
 * vscode-datalog.outputLocation.
 */
function outputPath(key: string, defaultValue: string): string {
  const cfg = vscode.workspace.getConfiguration('vscode-datalog');
  const relative = safeWorkspaceRelativeSetting(cfg, key, defaultValue);
  if (getOutputLocation() === 'temp') {
    const dir = currentSessionDir();
    return dir ? joinPath(dir, relative) : '';
  }
  const wsRoot = getWorkspaceRoot();
  return wsRoot ? vscode.Uri.joinPath(wsRoot, relative).fsPath : '';
}

function outputUri(key: string, defaultValue: string): vscode.Uri | undefined {
  const path = outputPath(key, defaultValue);
  return path ? vscode.Uri.file(path) : undefined;
}

function getSampleRows(): number {
  const value = vscode.workspace.getConfiguration('vscode-datalog').get<unknown>('sampleRows', 1000);
  return typeof value === 'number' && Number.isFinite(value) ? value : 1000;
}

function getNumberSetting(key: string, defaultValue: number): number {
  const value = vscode.workspace.getConfiguration('vscode-datalog').get<unknown>(key, defaultValue);
  return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
}

/** Write to the Output Channel; also write to the log file if enabled. */
function logLine(text: string): void {
  log.appendLine(text);
  if (!currentLogFilePath || !currentLogExtensionOutput) { return; }
  try {
    require('fs').appendFileSync(currentLogFilePath, text + '\n');
  } catch { /* ignore write errors */ }
}

/**
 * Write the Python runtime module the logpoints load. Keeping it on disk keeps
 * logpoint expressions short — pydevd re-compiles the expression on every hit.
 * Returns the absolute path, or '' when it could not be written.
 */
function ensureRuntimeFile(): string {
  const dir = currentSessionDir();
  if (!dir || !ensureDir(fs(), dir)) {
    logLine('Could not create the Datalog temp folder; falling back to inline logpoints.');
    return '';
  }
  const path = joinPath(dir, RUNTIME_FILE_NAME);
  if (!writeFileIfChanged(fs(), path, DATALOG_RUNTIME_SOURCE, forceRuntimeRewrite)) {
    logLine(`Could not write ${path}; falling back to inline logpoints.`);
    return '';
  }
  forceRuntimeRewrite = false;
  return path;
}

function getConfig(): DatalogConfig {
  const cfg = vscode.workspace.getConfiguration('vscode-datalog');
  currentLogFilePath = outputPath('logFile', 'plog.log');
  currentLogExtensionOutput = cfg.get<boolean>('logExtensionOutput', false);
  return {
    polarsAlias: cfg.get<string>('polarsAlias', 'pl'),
    dfNameSuffixes: cfg.get<string[]>('dfNameSuffixes', ['_df', 'df', '_data']),
    enabled: cfg.get<boolean>('enabled', true),
    exportSamples: cfg.get<boolean>('exportSamples', true),
    sampleRows: getSampleRows(),
    outputFolderAbsPath: outputPath('sampleOutputFolder', 'worklib'),
    logFileAbsPath: currentLogFilePath,
    logTimestampLines: cfg.get<boolean>('logTimestampLines', false),
    runtimeFileAbsPath: ensureRuntimeFile(),
    lazyFrames: coerceLazyFrameMode(cfg.get<unknown>('lazyFrames', DEFAULT_LAZY_FRAME_MODE)),
    outputLocation: getOutputLocation(),
    tempRetentionHours: getNumberSetting('tempRetentionHours', 12),
    deleteTempOnClose: cfg.get<boolean>('deleteTempOnClose', true),
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

  const documents = getOpenWorkspacePythonDocuments();
  const sources = documents.map(document => ({
    document,
    source: document.getText(),
  }));
  const dfReturningFuncs = collectOpenDfReturningFunctions(sources, config);
  const totalBps = vscode.debug.breakpoints.length;
  const purged = manager.purgeStale();
  logLine(`  → purgeStale: ${totalBps} total breakpoints, removed ${purged} stale`);
  logLine(`Open workspace Python documents: ${documents.length}`);
  logLine(`Shared frame-returning functions: ${dfReturningFuncs.size}`);
  logLine(`LazyFrame mode: ${config.lazyFrames}; output: ${config.outputLocation}`);
  if (config.runtimeFileAbsPath) {
    logLine(`Runtime module: ${config.runtimeFileAbsPath}`);
  }

  for (const { document, source } of sources) {
    await syncDocument(document, config, source, dfReturningFuncs);
  }
}

function getOpenWorkspacePythonDocuments(): vscode.TextDocument[] {
  const docs = new Map<string, vscode.TextDocument>();

  for (const document of vscode.workspace.textDocuments) {
    if (isOpenWorkspacePythonDocument(document)) {
      docs.set(document.uri.toString(), document);
    }
  }

  return [...docs.values()];
}

function isOpenWorkspacePythonDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'python' &&
    document.uri.scheme === 'file' &&
    vscode.workspace.getWorkspaceFolder(document.uri) !== undefined;
}

function collectOpenDfReturningFunctions(
  sources: Array<{ source: string }>,
  config: AnalyzerConfig
): Set<string> {
  const funcs = new Set<string>();

  for (const { source } of sources) {
    for (const fn of findDfReturningFunctions(source, config)) {
      funcs.add(fn);
    }
  }

  return funcs;
}

async function syncDocument(
  document: vscode.TextDocument,
  config: AnalyzerConfig & ExportConfig,
  source: string = document.getText(),
  dfReturningFuncs: Set<string> = findDfReturningFunctions(source, config)
): Promise<void> {
  const sourceLines = source.replace(/\r/g, '').split('\n');
  const { assignments } = analyzeSource(source, config, dfReturningFuncs);
  const printVars = findPrintVarStatements(source);
  logLine(`  ${document.fileName}: found ${assignments.length} frame assignment(s), ${printVars.length} print-var statement(s)`);
  for (const a of assignments) {
    logLine(`    → ${a.varName} (lines ${a.range.startLine + 1}–${a.range.endLine + 1}), inputs: [${a.inputVars.join(', ')}], ${a.reason ?? ''}`);
  }
  const result = await manager.syncForFile(document.uri, assignments, printVars, sourceLines, config);
  for (const skipped of result.skipped) {
    logLine(`    ! ${skipped.varName} (line ${skipped.line}) not logged: ${skipped.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Temp output housekeeping
// ---------------------------------------------------------------------------

function pruneTempOutput(): void {
  const tmp = osTmpDir();
  if (!tmp) { return; }
  const root = tempRootDir(tmp);
  const hours = getNumberSetting('tempRetentionHours', 12);
  if (hours <= 0) { return; }
  const maxAgeMs = hours * 60 * 60 * 1000;
  const now = Date.now();
  const current = workspaceKey(getWorkspaceRoot()?.fsPath);

  // Other workspaces' folders first, then anything stale inside our own.
  const removedRoots = pruneStaleEntries(fs(), root, root, maxAgeMs, now, [current]);
  const removedOwn = pruneStaleEntries(fs(), root, joinPath(root, current), maxAgeMs, now, [RUNTIME_FILE_NAME]);
  const total = removedRoots.length + removedOwn.length;
  if (total > 0) {
    logLine(`Pruned ${total} Datalog temp entr${total === 1 ? 'y' : 'ies'} older than ${hours}h.`);
  }
}

function clearTempOutput(): number {
  const tmp = osTmpDir();
  if (!tmp) { return 0; }
  const root = tempRootDir(tmp);
  const dir = joinPath(root, workspaceKey(getWorkspaceRoot()?.fsPath));
  return deleteInside(fs(), root, dir) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel('Datalog');
  context.subscriptions.push(log);

  manager = new LogpointManager();
  context.subscriptions.push(manager);

  // Resolve log file path and extension-output flag before first logLine call
  currentLogFilePath = outputPath('logFile', 'plog.log');
  currentLogExtensionOutput = vscode.workspace.getConfiguration('vscode-datalog')
    .get<boolean>('logExtensionOutput', false);

  logLine('Datalog extension activated.');
  log.show(true); // show without stealing focus
  pruneTempOutput();

  // --- Debug session lifecycle ---

  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async (session) => {
      if (!isPythonSession(session)) {
        logLine(`Debug session started: type="${session.type}" name="${session.name}"`);
        logLine('  → Not a Python/debugpy session, skipping.');
        return;
      }
      // Clear the log file so each run starts fresh
      forceRuntimeRewrite = true;
      currentLogFilePath = outputPath('logFile', 'plog.log');
      if (currentLogFilePath) {
        try {
          const dir = currentLogFilePath.replace(/[/\\][^/\\]*$/, '');
          ensureDir(fs(), dir);
          require('fs').writeFileSync(currentLogFilePath, '');
        } catch { /* ignore */ }
      }
      logLine(`Debug session started: type="${session.type}" name="${session.name}"`);
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
        logLine(`File saved, re-syncing open workspace Python documents: ${document.fileName}`);
        await syncAllPythonEditors();
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
      const folderUri = outputUri('sampleOutputFolder', 'worklib');
      if (!folderUri) {
        vscode.window.showWarningMessage('Datalog: No output folder is configured.');
        return;
      }
      try {
        await vscode.workspace.fs.stat(folderUri);
      } catch {
        vscode.window.showWarningMessage(`Datalog: "${folderUri.fsPath}" does not exist yet. Run a debug session first.`);
        return;
      }
      if (getOutputLocation() === 'temp') {
        // Temp folders live outside the workspace, so the Explorer cannot reveal them.
        await vscode.commands.executeCommand('revealFileInOS', folderUri);
        return;
      }
      await vscode.commands.executeCommand('workbench.view.explorer');
      await vscode.commands.executeCommand('revealInExplorer', folderUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.openPlog', async () => {
      const logUri = outputUri('logFile', 'plog.log');
      if (!logUri) {
        vscode.window.showWarningMessage('Datalog: No log file is configured.');
        return;
      }
      try {
        await vscode.workspace.fs.stat(logUri);
      } catch {
        vscode.window.showWarningMessage(`Datalog: "${logUri.fsPath}" does not exist yet. Run a debug session first.`);
        return;
      }
      const doc = await vscode.workspace.openTextDocument(logUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.openCsvForVar', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Datalog: No active editor.');
        return;
      }
      const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
      const varName = wordRange ? editor.document.getText(wordRange) : '';
      if (!varName) {
        vscode.window.showWarningMessage('Datalog: No variable name under cursor.');
        return;
      }
      const folderUri = outputUri('sampleOutputFolder', 'worklib');
      if (!folderUri) {
        vscode.window.showWarningMessage('Datalog: No output folder is configured.');
        return;
      }
      const csvUri = vscode.Uri.joinPath(folderUri, `${varName}.csv`);
      try {
        await vscode.workspace.fs.stat(csvUri);
      } catch {
        vscode.window.showWarningMessage(
          `Datalog: No CSV found for "${varName}" in ${folderUri.fsPath}. ` +
          'LazyFrames need vscode-datalog.lazyFrames set to "sample".'
        );
        return;
      }
      await vscode.commands.executeCommand('vscode.open', csvUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.explainDetection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'python') {
        vscode.window.showWarningMessage('Datalog: Open a Python file first.');
        return;
      }
      const config = getConfig();
      const source = editor.document.getText();
      const sources = getOpenWorkspacePythonDocuments().map(d => ({ source: d.getText() }));
      const { assignments, candidates } = analyzeSource(
        source,
        config,
        collectOpenDfReturningFunctions(sources, config)
      );
      log.show(true);
      logLine('');
      logLine(`Datalog detection report for ${editor.document.fileName}`);
      logLine(formatDetectionReport(candidates, assignments));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-datalog.clearTempOutput', () => {
      const removed = clearTempOutput();
      vscode.window.showInformationMessage(
        removed > 0
          ? 'Datalog: Temporary output folder deleted.'
          : 'Datalog: No temporary output folder to delete.'
      );
    })
  );

  // --- plog.log line colorization ---

  const plogBlue = vscode.window.createTextEditorDecorationType({
    light: { color: '#0070C1' },
    dark:  { color: '#4FC1FF' },
  });
  const plogRed = vscode.window.createTextEditorDecorationType({
    light: { color: '#A31515', fontWeight: 'bold' },
    dark:  { color: '#F48771', fontWeight: 'bold' },
  });
  context.subscriptions.push(plogBlue, plogRed);

  function applyPlogDecorations(editor: vscode.TextEditor): void {
    const logPath = outputPath('logFile', 'plog.log');
    if (!logPath) { return; }
    if (editor.document.uri.fsPath !== vscode.Uri.file(logPath).fsPath) { return; }

    const shapes: vscode.Range[] = [];
    const errors: vscode.Range[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
      const line = editor.document.lineAt(i);
      const text = line.text;
      if (text.startsWith('ERROR')) {
        errors.push(line.range);
      } else if (/^(Input|New) (dataframe|lazyframe|value)\b/.test(text) ||
                 /^(Input|New) "/.test(text)) {
        shapes.push(line.range);
      }
    }
    editor.setDecorations(plogBlue, shapes);
    editor.setDecorations(plogRed, errors);
  }

  for (const editor of vscode.window.visibleTextEditors) {
    applyPlogDecorations(editor);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) { applyPlogDecorations(editor); }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) { applyPlogDecorations(editor); }
      }
    })
  );
}

export function deactivate(): void {
  const cfg = vscode.workspace.getConfiguration('vscode-datalog');
  if (coerceOutputLocation(cfg.get<unknown>('outputLocation', DEFAULT_OUTPUT_LOCATION)) === 'temp' &&
      cfg.get<boolean>('deleteTempOnClose', true)) {
    clearTempOutput();
  }
}
