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
let manager;
let log;
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('vscode-datalog');
    const sampleOutputFolder = cfg.get('sampleOutputFolder', 'worklib');
    const logFile = cfg.get('logFile', 'plog.log');
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    return {
        polarsAlias: cfg.get('polarsAlias', 'pl'),
        dfNameSuffixes: cfg.get('dfNameSuffixes', ['_df', 'df', '_data']),
        enabled: cfg.get('enabled', true),
        exportSamples: cfg.get('exportSamples', true),
        sampleRows: cfg.get('sampleRows', 1000),
        outputFolderAbsPath: wsRoot ? vscode.Uri.joinPath(wsRoot, sampleOutputFolder).fsPath : '',
        logFileAbsPath: wsRoot && logFile ? vscode.Uri.joinPath(wsRoot, logFile).fsPath : '',
    };
}
function isPythonSession(session) {
    return session.type === 'python' || session.type === 'debugpy';
}
async function syncAllPythonEditors() {
    const config = getConfig();
    if (!config.enabled) {
        log.appendLine('Skipping sync — extension is disabled in settings.');
        return;
    }
    const editors = vscode.window.visibleTextEditors.filter(e => e.document.languageId === 'python');
    log.appendLine(`Visible Python editors: ${editors.length}`);
    for (const editor of editors) {
        await syncDocument(editor.document, config);
    }
}
async function syncDocument(document, config) {
    const source = document.getText();
    const sourceLines = source.replace(/\r/g, '').split('\n');
    const assignments = (0, pythonAnalyzer_1.analyzeFile)(source, config);
    log.appendLine(`  ${document.fileName}: found ${assignments.length} DataFrame assignment(s)`);
    for (const a of assignments) {
        log.appendLine(`    → ${a.varName} (lines ${a.range.startLine + 1}–${a.range.endLine + 1}), inputs: [${a.inputVars.join(', ')}]`);
    }
    await manager.syncForFile(document.uri, assignments, sourceLines, config);
}
function activate(context) {
    log = vscode.window.createOutputChannel('Datalog');
    context.subscriptions.push(log);
    manager = new logpointManager_1.LogpointManager();
    context.subscriptions.push(manager);
    log.appendLine('Datalog extension activated.');
    log.show(true); // show without stealing focus
    // --- Debug session lifecycle ---
    context.subscriptions.push(vscode.debug.onDidStartDebugSession(async (session) => {
        log.appendLine(`Debug session started: type="${session.type}" name="${session.name}"`);
        if (!isPythonSession(session)) {
            log.appendLine('  → Not a Python/debugpy session, skipping.');
            return;
        }
        log.appendLine('  → Python session detected, syncing logpoints...');
        await syncAllPythonEditors();
    }));
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => {
        log.appendLine(`Debug session ended: type="${session.type}"`);
        if (isPythonSession(session)) {
            manager.clearAll();
            log.appendLine('  → Logpoints cleared.');
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
            log.appendLine(`File saved, re-syncing: ${document.fileName}`);
            await syncDocument(document, config);
        }
    }));
    // --- Commands ---
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.refreshLogpoints', async () => {
        log.appendLine('Command: refreshLogpoints');
        const config = getConfig();
        if (!config.enabled) {
            vscode.window.showInformationMessage('Datalog is disabled. Enable it in settings first.');
            return;
        }
        await syncAllPythonEditors();
        vscode.window.showInformationMessage('Datalog: Logpoints refreshed.');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-datalog.clearLogpoints', () => {
        log.appendLine('Command: clearLogpoints');
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