"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const pythonAnalyzer_1 = require("./pythonAnalyzer");
const logpointManager_1 = require("./logpointManager");
let manager;
let log;
let currentLogFilePath = '';
let currentLogExtensionOutput = false;
/** Write to the Output Channel; also write to plog.log if logExtensionOutput is enabled. */
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
function resolveLogFilePath() {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!wsRoot) {
        return '';
    }
    const logFile = vscode.workspace.getConfiguration('vscode-datalog').get('logFile', 'plog.log');
    return logFile ? vscode.Uri.joinPath(wsRoot, logFile).fsPath : '';
}
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('vscode-datalog');
    const sampleOutputFolder = cfg.get('sampleOutputFolder', 'worklib');
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    currentLogFilePath = resolveLogFilePath();
    currentLogExtensionOutput = cfg.get('logExtensionOutput', false);
    return {
        polarsAlias: cfg.get('polarsAlias', 'pl'),
        dfNameSuffixes: cfg.get('dfNameSuffixes', ['_df', 'df', '_data']),
        enabled: cfg.get('enabled', true),
        exportSamples: cfg.get('exportSamples', true),
        sampleRows: cfg.get('sampleRows', 1000),
        outputFolderAbsPath: wsRoot ? vscode.Uri.joinPath(wsRoot, sampleOutputFolder).fsPath : '',
        logFileAbsPath: currentLogFilePath,
        logTimestampLines: cfg.get('logTimestampLines', false),
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
    const editors = vscode.window.visibleTextEditors.filter(e => e.document.languageId === 'python');
    const totalBps = vscode.debug.breakpoints.length;
    const purged = manager.purgeStale();
    logLine(`  → purgeStale: ${totalBps} total breakpoints, removed ${purged} stale`);
    logLine(`Visible Python editors: ${editors.length}`);
    for (const editor of editors) {
        await syncDocument(editor.document, config);
    }
}
async function syncDocument(document, config) {
    const source = document.getText();
    const sourceLines = source.replace(/\r/g, '').split('\n');
    const assignments = (0, pythonAnalyzer_1.analyzeFile)(source, config);
    const printVars = (0, pythonAnalyzer_1.findPrintVarStatements)(source);
    logLine(`  ${document.fileName}: found ${assignments.length} DataFrame assignment(s), ${printVars.length} print-var statement(s)`);
    for (const a of assignments) {
        logLine(`    → ${a.varName} (lines ${a.range.startLine + 1}–${a.range.endLine + 1}), inputs: [${a.inputVars.join(', ')}]`);
    }
    await manager.syncForFile(document.uri, assignments, printVars, sourceLines, config);
}
function activate(context) {
    log = vscode.window.createOutputChannel('Datalog');
    context.subscriptions.push(log);
    manager = new logpointManager_1.LogpointManager();
    context.subscriptions.push(manager);
    // Resolve log file path and extension-output flag before first logLine call
    currentLogFilePath = resolveLogFilePath();
    currentLogExtensionOutput = vscode.workspace.getConfiguration('vscode-datalog')
        .get('logExtensionOutput', false);
    logLine('Datalog extension activated.');
    log.show(true); // show without stealing focus
    // --- Debug session lifecycle ---
    context.subscriptions.push(vscode.debug.onDidStartDebugSession(async (session) => {
        if (!isPythonSession(session)) {
            logLine(`Debug session started: type="${session.type}" name="${session.name}"`);
            logLine('  → Not a Python/debugpy session, skipping.');
            return;
        }
        // Clear the log file so each run starts fresh
        if (currentLogFilePath) {
            try {
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
            logLine(`File saved, re-syncing: ${document.fileName}`);
            await syncDocument(document, config);
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
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!wsRoot) {
            vscode.window.showWarningMessage('Datalog: No workspace folder is open.');
            return;
        }
        const cfg = vscode.workspace.getConfiguration('vscode-datalog');
        const folder = cfg.get('sampleOutputFolder', 'worklib');
        const folderUri = vscode.Uri.joinPath(wsRoot, folder);
        try {
            await vscode.workspace.fs.stat(folderUri);
        }
        catch {
            vscode.window.showWarningMessage(`Datalog: Folder "${folder}" does not exist yet.`);
            return;
        }
        await vscode.commands.executeCommand('workbench.view.explorer');
        await vscode.commands.executeCommand('revealInExplorer', folderUri);
    }));
    // --- Capture logpoint output from Python debug sessions → plog.log ---
    //
    // Intercept DAP 'output' events for the '===DATALOG===' marker that
    // logpoint expressions emit, writing those verbatim to plog.log.
    context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker(session) {
            if (!isPythonSession(session)) {
                return undefined;
            }
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!wsRoot) {
                return undefined;
            }
            const cfg = vscode.workspace.getConfiguration('vscode-datalog');
            const logFile = cfg.get('logFile', 'plog.log');
            if (!logFile) {
                return undefined;
            }
            const logPath = vscode.Uri.joinPath(wsRoot, logFile).fsPath;
            return {
                onDidSendMessage(message) {
                    if (message.type !== 'event' || message.event !== 'output') {
                        return;
                    }
                    const cat = message.body?.category ?? 'console';
                    const output = message.body?.output ?? '';
                    if (cat === 'stdout') {
                        try {
                            require('fs').appendFileSync(logPath, output);
                        }
                        catch { /* ignore */ }
                    }
                    else if (cat === 'console' && output.startsWith('===DATALOG===')) {
                        try {
                            require('fs').appendFileSync(logPath, '\n\n' + output);
                        }
                        catch { /* ignore */ }
                    }
                },
            };
        },
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.openPlog', async () => {
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!wsRoot) {
            vscode.window.showWarningMessage('Datalog: No workspace folder is open.');
            return;
        }
        const cfg = vscode.workspace.getConfiguration('vscode-datalog');
        const logFile = cfg.get('logFile', 'plog.log');
        const logUri = vscode.Uri.joinPath(wsRoot, logFile);
        try {
            await vscode.workspace.fs.stat(logUri);
        }
        catch {
            vscode.window.showWarningMessage(`Datalog: "${logFile}" does not exist yet. Run a debug session first.`);
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
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!wsRoot) {
            vscode.window.showWarningMessage('Datalog: No workspace folder is open.');
            return;
        }
        const cfg = vscode.workspace.getConfiguration('vscode-datalog');
        const folder = cfg.get('sampleOutputFolder', 'worklib');
        const csvUri = vscode.Uri.joinPath(wsRoot, folder, `${varName}.csv`);
        try {
            await vscode.workspace.fs.stat(csvUri);
        }
        catch {
            vscode.window.showWarningMessage(`Datalog: No CSV found for "${varName}" in ${folder}/.`);
            return;
        }
        await vscode.commands.executeCommand('vscode.open', csvUri);
    }));
    // --- plog.log line colorization ---
    const plogBlue = vscode.window.createTextEditorDecorationType({
        light: { color: '#0070C1' },
        dark: { color: '#4FC1FF' },
    });
    context.subscriptions.push(plogBlue);
    function applyPlogDecorations(editor) {
        const cfg = vscode.workspace.getConfiguration('vscode-datalog');
        const logFile = cfg.get('logFile', 'plog.log');
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!wsRoot || !logFile) {
            return;
        }
        if (editor.document.uri.fsPath !== vscode.Uri.joinPath(wsRoot, logFile).fsPath) {
            return;
        }
        const ranges = [];
        for (let i = 0; i < editor.document.lineCount; i++) {
            const text = editor.document.lineAt(i).text;
            if (text.startsWith('Input dataframe') || text.startsWith('New dataframe') ||
                text.startsWith('Input lazyframe') || text.startsWith('New lazyframe')) {
                ranges.push(editor.document.lineAt(i).range);
            }
        }
        editor.setDecorations(plogBlue, ranges);
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
    // manager and log disposed via context.subscriptions
}
//# sourceMappingURL=extension.js.map