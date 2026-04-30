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
    logLine(`  ${document.fileName}: found ${assignments.length} DataFrame assignment(s)`);
    for (const a of assignments) {
        logLine(`    → ${a.varName} (lines ${a.range.startLine + 1}–${a.range.endLine + 1}), inputs: [${a.inputVars.join(', ')}]`);
    }
    await manager.syncForFile(document.uri, assignments, sourceLines, config);
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
}
function deactivate() {
    // manager and log disposed via context.subscriptions
}
//# sourceMappingURL=extension.js.map