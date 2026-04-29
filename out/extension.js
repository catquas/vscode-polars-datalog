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
const outputFilter_1 = require("./outputFilter");
let manager;
let log;
let currentLogFilePath = '';
let currentLogExtensionOutput = false;
// Count of active Python debug sessions in the current run. Sync runs only
// on the first session start; logpoints are cleared only when it drops to 0.
let activePythonSessions = 0;
// Session ID of the one DAP tracker we attach per debug run (to prevent
// duplicating plog.log writes when debugpy spawns multiple sub-sessions).
let activeTrackerSessionId;
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
        logLine(`Debug session started: type="${session.type}" name="${session.name}"`);
        if (!isPythonSession(session)) {
            logLine('  → Not a Python/debugpy session, skipping.');
            return;
        }
        const isFirst = activePythonSessions === 0;
        activePythonSessions++;
        logLine(`  → Python session #${activePythonSessions} detected.`);
        if (isFirst) {
            logLine('  → First session — syncing logpoints...');
            await syncAllPythonEditors();
        }
        else {
            logLine('  → Sub-session — skipping duplicate sync.');
        }
    }));
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => {
        logLine(`Debug session ended: type="${session.type}"`);
        if (!isPythonSession(session)) {
            return;
        }
        activePythonSessions = Math.max(0, activePythonSessions - 1);
        if (activePythonSessions === 0) {
            manager.clearAll();
            activeTrackerSessionId = undefined;
            logLine('  → All sessions ended, logpoints cleared.');
        }
        else {
            logLine(`  → ${activePythonSessions} session(s) still active.`);
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
    // --- Capture stdout/stderr from Python debug sessions → plog.log ---
    //
    // We use a DebugAdapterTrackerFactory to intercept DAP 'output' events.
    // Only 'stdout' and 'stderr' categories are written; 'console' is skipped
    // because that is where evaluated logpoint expressions appear — they already
    // write directly to plog.log via the Python side-effect expression, so
    // capturing them here would duplicate entries.
    context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker(session) {
            if (!isPythonSession(session)) {
                return undefined;
            }
            // Allow only one tracker per debug run to prevent duplicate plog.log
            // writes when debugpy spawns multiple sub-sessions.
            if (activeTrackerSessionId !== undefined) {
                return undefined;
            }
            activeTrackerSessionId = session.id;
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
            const filter = new outputFilter_1.TracebackFilter(wsRoot.fsPath);
            function appendFiltered(text) {
                if (!text) {
                    return;
                }
                try {
                    require('fs').appendFileSync(logPath, text);
                }
                catch { /* ignore */ }
            }
            return {
                onDidSendMessage(message) {
                    if (message.type !== 'event' || message.event !== 'output') {
                        return;
                    }
                    const cat = message.body?.category ?? 'stdout';
                    if (cat !== 'stdout' && cat !== 'stderr') {
                        return;
                    }
                    appendFiltered(filter.feed(message.body?.output ?? ''));
                },
                onWillStopSession() {
                    appendFiltered(filter.flush());
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