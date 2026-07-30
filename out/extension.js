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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const pythonAnalyzer_1 = require("./pythonAnalyzer");
const logpointManager_1 = require("./logpointManager");
const pyRuntime_1 = require("./pyRuntime");
const outputPaths_1 = require("./outputPaths");
let manager;
let log;
let currentLogFilePath = '';
let currentLogExtensionOutput = false;
/**
 * Rewrite the runtime module even if its content is unchanged, so its mtime
 * keeps the temp folder clear of age pruning while a session is using it.
 */
let forceRuntimeRewrite = true;
function fs() {
    return require('fs');
}
function osTmpDir() {
    try {
        return require('os').tmpdir();
    }
    catch {
        return '';
    }
}
function getWorkspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}
function safeWorkspaceRelativeSetting(cfg, key, defaultValue) {
    const raw = cfg.get(key, defaultValue);
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
function getOutputLocation() {
    const cfg = vscode.workspace.getConfiguration('vscode-datalog');
    return (0, outputPaths_1.coerceOutputLocation)(cfg.get('outputLocation', outputPaths_1.DEFAULT_OUTPUT_LOCATION));
}
/** Per-workspace folder under the OS temp directory. */
function currentSessionDir() {
    const tmp = osTmpDir();
    if (!tmp) {
        return '';
    }
    return (0, outputPaths_1.sessionDir)(tmp, getWorkspaceRoot()?.fsPath);
}
/**
 * Absolute path for one of the workspace-relative settings, honouring
 * vscode-datalog.outputLocation.
 */
function outputPath(key, defaultValue) {
    const cfg = vscode.workspace.getConfiguration('vscode-datalog');
    const relative = safeWorkspaceRelativeSetting(cfg, key, defaultValue);
    if (getOutputLocation() === 'temp') {
        const dir = currentSessionDir();
        return dir ? (0, outputPaths_1.joinPath)(dir, relative) : '';
    }
    const wsRoot = getWorkspaceRoot();
    return wsRoot ? vscode.Uri.joinPath(wsRoot, relative).fsPath : '';
}
function outputUri(key, defaultValue) {
    const path = outputPath(key, defaultValue);
    return path ? vscode.Uri.file(path) : undefined;
}
function getSampleRows() {
    const value = vscode.workspace.getConfiguration('vscode-datalog').get('sampleRows', 1000);
    return typeof value === 'number' && Number.isFinite(value) ? value : 1000;
}
function getNumberSetting(key, defaultValue) {
    const value = vscode.workspace.getConfiguration('vscode-datalog').get(key, defaultValue);
    return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
}
/** Write to the Output Channel; also write to the log file if enabled. */
function logLine(text) {
    log.appendLine(text);
    if (!currentLogFilePath || !currentLogExtensionOutput) {
        return;
    }
    try {
        require('fs').appendFileSync(currentLogFilePath, text + '\n');
    }
    catch { /* ignore write errors */ }
}
/**
 * Write the Python runtime module the logpoints load. Keeping it on disk keeps
 * logpoint expressions short — pydevd re-compiles the expression on every hit.
 * Returns the absolute path, or '' when it could not be written.
 */
function ensureRuntimeFile() {
    const dir = currentSessionDir();
    if (!dir || !(0, outputPaths_1.ensureDir)(fs(), dir)) {
        logLine('Could not create the Datalog temp folder; falling back to inline logpoints.');
        return '';
    }
    const path = (0, outputPaths_1.joinPath)(dir, pyRuntime_1.RUNTIME_FILE_NAME);
    if (!(0, outputPaths_1.writeFileIfChanged)(fs(), path, pyRuntime_1.DATALOG_RUNTIME_SOURCE, forceRuntimeRewrite)) {
        logLine(`Could not write ${path}; falling back to inline logpoints.`);
        return '';
    }
    forceRuntimeRewrite = false;
    return path;
}
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('vscode-datalog');
    currentLogFilePath = outputPath('logFile', 'plog.log');
    currentLogExtensionOutput = cfg.get('logExtensionOutput', false);
    return {
        polarsAlias: cfg.get('polarsAlias', 'pl'),
        dfNameSuffixes: cfg.get('dfNameSuffixes', ['_df', 'df', '_data']),
        enabled: cfg.get('enabled', true),
        exportSamples: cfg.get('exportSamples', true),
        sampleRows: getSampleRows(),
        outputFolderAbsPath: outputPath('sampleOutputFolder', 'worklib'),
        logFileAbsPath: currentLogFilePath,
        logTimestampLines: cfg.get('logTimestampLines', false),
        runtimeFileAbsPath: ensureRuntimeFile(),
        lazyFrames: (0, pyRuntime_1.coerceLazyFrameMode)(cfg.get('lazyFrames', pyRuntime_1.DEFAULT_LAZY_FRAME_MODE)),
        outputLocation: getOutputLocation(),
        tempRetentionHours: getNumberSetting('tempRetentionHours', 12),
        deleteTempOnClose: cfg.get('deleteTempOnClose', true),
    };
}
function isPythonSession(session) {
    return session.type === 'python' || session.type === 'debugpy';
}
async function syncAllPythonEditors() {
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
function getOpenWorkspacePythonDocuments() {
    const docs = new Map();
    for (const document of vscode.workspace.textDocuments) {
        if (isOpenWorkspacePythonDocument(document)) {
            docs.set(document.uri.toString(), document);
        }
    }
    return [...docs.values()];
}
function isOpenWorkspacePythonDocument(document) {
    return document.languageId === 'python' &&
        document.uri.scheme === 'file' &&
        vscode.workspace.getWorkspaceFolder(document.uri) !== undefined;
}
function collectOpenDfReturningFunctions(sources, config) {
    const funcs = new Set();
    for (const { source } of sources) {
        for (const fn of (0, pythonAnalyzer_1.findDfReturningFunctions)(source, config)) {
            funcs.add(fn);
        }
    }
    return funcs;
}
async function syncDocument(document, config, source = document.getText(), dfReturningFuncs = (0, pythonAnalyzer_1.findDfReturningFunctions)(source, config)) {
    const sourceLines = source.replace(/\r/g, '').split('\n');
    const { assignments } = (0, pythonAnalyzer_1.analyzeSource)(source, config, dfReturningFuncs);
    const printVars = (0, pythonAnalyzer_1.findPrintVarStatements)(source);
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
function pruneTempOutput() {
    const tmp = osTmpDir();
    if (!tmp) {
        return;
    }
    const root = (0, outputPaths_1.tempRootDir)(tmp);
    const hours = getNumberSetting('tempRetentionHours', 12);
    if (hours <= 0) {
        return;
    }
    const maxAgeMs = hours * 60 * 60 * 1000;
    const now = Date.now();
    const current = (0, outputPaths_1.workspaceKey)(getWorkspaceRoot()?.fsPath);
    // Other workspaces' folders first, then anything stale inside our own.
    const removedRoots = (0, outputPaths_1.pruneStaleEntries)(fs(), root, root, maxAgeMs, now, [current]);
    const removedOwn = (0, outputPaths_1.pruneStaleEntries)(fs(), root, (0, outputPaths_1.joinPath)(root, current), maxAgeMs, now, [pyRuntime_1.RUNTIME_FILE_NAME]);
    const total = removedRoots.length + removedOwn.length;
    if (total > 0) {
        logLine(`Pruned ${total} Datalog temp entr${total === 1 ? 'y' : 'ies'} older than ${hours}h.`);
    }
}
function clearTempOutput() {
    const tmp = osTmpDir();
    if (!tmp) {
        return 0;
    }
    const root = (0, outputPaths_1.tempRootDir)(tmp);
    const dir = (0, outputPaths_1.joinPath)(root, (0, outputPaths_1.workspaceKey)(getWorkspaceRoot()?.fsPath));
    return (0, outputPaths_1.deleteInside)(fs(), root, dir) ? 1 : 0;
}
// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------
function activate(context) {
    log = vscode.window.createOutputChannel('Datalog');
    context.subscriptions.push(log);
    manager = new logpointManager_1.LogpointManager();
    context.subscriptions.push(manager);
    // Resolve log file path and extension-output flag before first logLine call
    currentLogFilePath = outputPath('logFile', 'plog.log');
    currentLogExtensionOutput = vscode.workspace.getConfiguration('vscode-datalog')
        .get('logExtensionOutput', false);
    logLine('Datalog extension activated.');
    log.show(true); // show without stealing focus
    pruneTempOutput();
    // --- Debug session lifecycle ---
    context.subscriptions.push(vscode.debug.onDidStartDebugSession(async (session) => {
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
                (0, outputPaths_1.ensureDir)(fs(), dir);
                require('fs').writeFileSync(currentLogFilePath, '');
            }
            catch { /* ignore */ }
        }
        logLine(`Debug session started: type="${session.type}" name="${session.name}"`);
        logLine('  → Python session detected, syncing logpoints...');
        await syncAllPythonEditors();
    }));
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => {
        logLine(`Debug session ended: type="${session.type}"`);
        if (isPythonSession(session)) {
            manager.clearAll();
            logLine('  → Logpoints cleared.');
        }
    }));
    // --- Auto-refresh on save ---
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
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
    }));
    // --- Commands ---
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.refreshLogpoints', async () => {
        logLine('Command: refreshLogpoints');
        const config = getConfig();
        if (!config.enabled) {
            vscode.window.showInformationMessage('Datalog is disabled. Enable it in settings first.');
            return;
        }
        await syncAllPythonEditors();
        vscode.window.showInformationMessage('Datalog: Logpoints refreshed.');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.clearLogpoints', () => {
        logLine('Command: clearLogpoints');
        manager.clearAll();
        vscode.window.showInformationMessage('Datalog: All logpoints cleared.');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.focusWorklib', async () => {
        const folderUri = outputUri('sampleOutputFolder', 'worklib');
        if (!folderUri) {
            vscode.window.showWarningMessage('Datalog: No output folder is configured.');
            return;
        }
        try {
            await vscode.workspace.fs.stat(folderUri);
        }
        catch {
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
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.openPlog', async () => {
        const logUri = outputUri('logFile', 'plog.log');
        if (!logUri) {
            vscode.window.showWarningMessage('Datalog: No log file is configured.');
            return;
        }
        try {
            await vscode.workspace.fs.stat(logUri);
        }
        catch {
            vscode.window.showWarningMessage(`Datalog: "${logUri.fsPath}" does not exist yet. Run a debug session first.`);
            return;
        }
        const doc = await vscode.workspace.openTextDocument(logUri);
        await vscode.window.showTextDocument(doc, { preview: false });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.openCsvForVar', async () => {
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
        }
        catch {
            vscode.window.showWarningMessage(`Datalog: No CSV found for "${varName}" in ${folderUri.fsPath}. ` +
                'LazyFrames need vscode-datalog.lazyFrames set to "sample".');
            return;
        }
        await vscode.commands.executeCommand('vscode.open', csvUri);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.explainDetection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'python') {
            vscode.window.showWarningMessage('Datalog: Open a Python file first.');
            return;
        }
        const config = getConfig();
        const source = editor.document.getText();
        const sources = getOpenWorkspacePythonDocuments().map(d => ({ source: d.getText() }));
        const { assignments, candidates } = (0, pythonAnalyzer_1.analyzeSource)(source, config, collectOpenDfReturningFunctions(sources, config));
        log.show(true);
        logLine('');
        logLine(`Datalog detection report for ${editor.document.fileName}`);
        logLine((0, pythonAnalyzer_1.formatDetectionReport)(candidates, assignments));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.clearTempOutput', () => {
        const removed = clearTempOutput();
        vscode.window.showInformationMessage(removed > 0
            ? 'Datalog: Temporary output folder deleted.'
            : 'Datalog: No temporary output folder to delete.');
    }));
    // --- plog.log line colorization ---
    const plogBlue = vscode.window.createTextEditorDecorationType({
        light: { color: '#0070C1' },
        dark: { color: '#4FC1FF' },
    });
    const plogRed = vscode.window.createTextEditorDecorationType({
        light: { color: '#A31515', fontWeight: 'bold' },
        dark: { color: '#F48771', fontWeight: 'bold' },
    });
    context.subscriptions.push(plogBlue, plogRed);
    function applyPlogDecorations(editor) {
        const logPath = outputPath('logFile', 'plog.log');
        if (!logPath) {
            return;
        }
        if (editor.document.uri.fsPath !== vscode.Uri.file(logPath).fsPath) {
            return;
        }
        const shapes = [];
        const errors = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            const line = editor.document.lineAt(i);
            const text = line.text;
            if (text.startsWith('ERROR')) {
                errors.push(line.range);
            }
            else if (/^(Input|New) (dataframe|lazyframe|value)\b/.test(text) ||
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
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            applyPlogDecorations(editor);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document === event.document) {
                applyPlogDecorations(editor);
            }
        }
    }));
}
function deactivate() {
    const cfg = vscode.workspace.getConfiguration('vscode-datalog');
    if ((0, outputPaths_1.coerceOutputLocation)(cfg.get('outputLocation', outputPaths_1.DEFAULT_OUTPUT_LOCATION)) === 'temp' &&
        cfg.get('deleteTempOnClose', true)) {
        clearTempOutput();
    }
}
//# sourceMappingURL=extension.js.map