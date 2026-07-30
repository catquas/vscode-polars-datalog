"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLogMessage = buildLogMessage;
exports.buildPrintVarLogMessage = buildPrintVarLogMessage;
exports.buildInlineLogMessage = buildInlineLogMessage;
exports.buildInlinePrintVarLogMessage = buildInlinePrintVarLogMessage;
const pyExpr_1 = require("./pyExpr");
const pyRuntime_1 = require("./pyRuntime");
const WRAP_AT = 90;
const DEFAULT_SAMPLE_ROWS = 1000;
const MAX_SAMPLE_ROWS = 100000;
function safeSampleRows(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_SAMPLE_ROWS;
    }
    return Math.max(0, Math.min(Math.trunc(value), MAX_SAMPLE_ROWS));
}
/**
 * Return positions of all commas at the minimum bracket depth found (> 0),
 * skipping commas inside string literals and comments.
 */
function outermostCommaPositions(line) {
    const found = [];
    let depth = 0;
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if ((ch === '"' || ch === "'") && line[i + 1] === ch && line[i + 2] === ch) {
            const q = line.slice(i, i + 3);
            i += 3;
            while (i < line.length) {
                if (line[i] === '\\') {
                    i += 2;
                }
                else if (line.slice(i, i + 3) === q) {
                    i += 3;
                    break;
                }
                else {
                    i++;
                }
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            const q = ch;
            i++;
            while (i < line.length) {
                if (line[i] === '\\') {
                    i += 2;
                }
                else if (line[i] === q) {
                    i++;
                    break;
                }
                else {
                    i++;
                }
            }
            continue;
        }
        if (ch === '#') {
            break;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        }
        else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
        }
        else if (ch === ',' && depth > 0) {
            found.push({ pos: i, depth });
        }
        i++;
    }
    if (found.length === 0) {
        return [];
    }
    const min = Math.min(...found.map(c => c.depth));
    return found.filter(c => c.depth === min).map(c => c.pos);
}
function breakLongLine(line) {
    if (line.length <= WRAP_AT) {
        return line;
    }
    const commas = outermostCommaPositions(line);
    if (commas.length === 0) {
        return line;
    }
    const baseIndent = (line.match(/^(\s*)/) ?? ['', ''])[1];
    const contIndent = baseIndent + '    ';
    const segs = [];
    let prev = 0;
    for (const pos of commas) {
        segs.push(line.slice(prev, pos + 1).trim());
        prev = pos + 1;
    }
    segs.push(line.slice(prev).trim());
    const outLines = [];
    let cur = baseIndent + segs[0];
    for (let j = 1; j < segs.length; j++) {
        const candidate = cur + ' ' + segs[j];
        if (candidate.length <= WRAP_AT) {
            cur = candidate;
        }
        else {
            outLines.push(cur);
            cur = contIndent + segs[j];
        }
    }
    outLines.push(cur);
    return outLines.join('\n');
}
function wrapSourceText(text) {
    return text.split('\n').map(breakLongLine).join('\n');
}
/**
 * Build a SAS-style logpoint message for a DataFrame or LazyFrame assignment.
 *
 * The logpoint contains exactly one runtime expression. It captures the values
 * it needs as lambda default arguments before Python resumes, hands them to the
 * generated runtime module, and returns the block for the Debug Console.
 */
function buildLogMessage(assignment, exportConfig) {
    const runtimeFile = exportConfig?.runtimeFileAbsPath ?? '';
    if (!runtimeFile) {
        return buildInlineLogMessage(assignment, exportConfig);
    }
    const inputs = assignment.inputVars;
    const captureArgs = [`_out=${(0, pyExpr_1.safeCaptureExpr)(assignment.captureExpr ?? assignment.varName)}`];
    for (let i = 0; i < inputs.length; i++) {
        captureArgs.push(`_in${i}=${(0, pyExpr_1.safeCaptureExpr)(inputs[i])}`);
    }
    const hasCsv = !!(exportConfig?.exportSamples && exportConfig.outputFolderAbsPath);
    const inputPairs = inputs.map((name, i) => `(${(0, pyExpr_1.pyStringExpr)(name)}, _in${i})`).join(', ');
    const payload = pyDict([
        ['source', (0, pyExpr_1.pyStringExpr)(wrapSourceText(assignment.sourceText))],
        ['location', (0, pyExpr_1.pyStringExpr)(assignment.location ?? '')],
        ['out_name', (0, pyExpr_1.pyStringExpr)(assignment.varName)],
        ['out', '_out'],
        ['inputs', `[${inputPairs}]`],
        ['log_path', (0, pyExpr_1.pyStringExpr)((0, pyExpr_1.normalizePathForPython)(exportConfig?.logFileAbsPath ?? ''))],
        ['csv_dir', (0, pyExpr_1.pyStringExpr)(hasCsv ? (0, pyExpr_1.normalizePathForPython)(exportConfig.outputFolderAbsPath) : '')],
        ['csv_name', (0, pyExpr_1.pyStringExpr)((0, pyExpr_1.safeFileStem)(assignment.varName))],
        ['sample_rows', String(safeSampleRows(exportConfig?.sampleRows))],
        ['lazy_mode', (0, pyExpr_1.pyStringExpr)((0, pyRuntime_1.coerceLazyFrameMode)(exportConfig?.lazyFrames))],
        ['timestamps', exportConfig?.logTimestampLines ? 'True' : 'False'],
    ]);
    return `{(lambda ${captureArgs.join(', ')}: ` +
        `${(0, pyRuntime_1.runtimeCallExpr)('datalog_emit', payload, runtimeFile)})()}`;
}
function buildPrintVarLogMessage(varName, exportConfig) {
    const runtimeFile = exportConfig?.runtimeFileAbsPath ?? '';
    if (!runtimeFile) {
        return buildInlinePrintVarLogMessage(varName, exportConfig);
    }
    const payload = pyDict([
        ['name', (0, pyExpr_1.pyStringExpr)(varName)],
        ['value', '_value'],
        ['log_path', (0, pyExpr_1.pyStringExpr)((0, pyExpr_1.normalizePathForPython)(exportConfig?.logFileAbsPath ?? ''))],
        ['lazy_mode', (0, pyExpr_1.pyStringExpr)((0, pyRuntime_1.coerceLazyFrameMode)(exportConfig?.lazyFrames))],
        ['sample_rows', String(safeSampleRows(exportConfig?.sampleRows))],
    ]);
    return `{(lambda _value=${varName}: ` +
        `${(0, pyRuntime_1.runtimeCallExpr)('datalog_value', payload, runtimeFile)})()}`;
}
/** `dict(a=1, b=2)` — a dict literal would need braces, which logpoints eat. */
function pyDict(entries) {
    return `dict(${entries.map(([key, value]) => `${key}=${value}`).join(', ')})`;
}
// ---------------------------------------------------------------------------
// Fallback builders
//
// Used only when no runtime module could be written to disk. They keep the
// pre-runtime behaviour: DataFrame shapes, CSV samples and log writes, but no
// LazyFrame inspection and no error reporting.
// ---------------------------------------------------------------------------
const PRINT_DICT_ENTRY_LIMIT = 8;
const PRINT_VALUE_ITEM_LIMIT = 5;
const PRINT_VALUE_FORMATTER_SOURCE = `
def _datalog_preview_seq(seq, limit):
    try:
        items = list(seq[:limit])
    except Exception:
        try:
            items = list(seq)[:limit]
        except Exception:
            return repr(seq)
    try:
        total = len(seq)
    except Exception:
        total = len(items)
    suffix = "" if total <= limit else ", ... " + str(total - limit) + " more items"
    return "[" + ", ".join(repr(item) for item in items) + suffix + "]"

def _datalog_preview_value(value):
    if hasattr(value, "to_list") and not isinstance(value, (str, bytes, bytearray)):
        name = getattr(value, "name", None)
        try:
            total = len(value)
        except Exception:
            total = "?"
        try:
            values = value.to_list()[:${PRINT_VALUE_ITEM_LIMIT}]
        except Exception:
            values = []
        suffix = "" if total == "?" or total <= ${PRINT_VALUE_ITEM_LIMIT} else ", ... " + str(total - ${PRINT_VALUE_ITEM_LIMIT}) + " more items"
        label = type(value).__name__
        details = []
        if name is not None:
            details.append("name=" + repr(name))
        details.append("len=" + str(total))
        details.append("values=[" + ", ".join(repr(item) for item in values) + suffix + "]")
        return label + "(" + ", ".join(details) + ")"
    if isinstance(value, (list, tuple)):
        open_ch, close_ch = ("[", "]") if isinstance(value, list) else ("(", ")")
        preview = _datalog_preview_seq(value, ${PRINT_VALUE_ITEM_LIMIT})
        return open_ch + preview[1:-1] + close_ch
    return repr(value)

def datalog_fmt(value):
    if not isinstance(value, dict):
        return repr(value)
    items = list(value.items())
    shown = items[:${PRINT_DICT_ENTRY_LIMIT}]
    omitted = len(items) - ${PRINT_DICT_ENTRY_LIMIT}
    lines = [chr(123)]
    for idx, pair in enumerate(shown):
        key, item = pair
        comma = "," if idx < len(shown) - 1 or omitted > 0 else ""
        lines.append("  " + repr(key) + ": " + _datalog_preview_value(item) + comma)
    if omitted > 0:
        lines.append("  ... " + str(omitted) + " more entries")
    lines.append(chr(125))
    return "\\n".join(lines)
`.trim();
function printValueFormatExpr(valueExpr) {
    return `(lambda _ns=dict(): (` +
        `exec(${(0, pyExpr_1.pyStringExpr)(PRINT_VALUE_FORMATTER_SOURCE)}, _ns), ` +
        `_ns[${(0, pyExpr_1.pyStringExpr)('datalog_fmt')}](${valueExpr}))[1])()`;
}
function buildInlineLogMessage(assignment, exportConfig) {
    const v = assignment.varName;
    const inputs = assignment.inputVars;
    const hasCsv = !!(exportConfig?.exportSamples && exportConfig.outputFolderAbsPath);
    const hasLog = !!exportConfig?.logFileAbsPath;
    const hasTimestamp = !!(hasLog && exportConfig?.logTimestampLines);
    const csvDir = hasCsv ? (0, pyExpr_1.normalizePathForPython)(exportConfig.outputFolderAbsPath) : '';
    const logPath = hasLog ? (0, pyExpr_1.normalizePathForPython)(exportConfig.logFileAbsPath) : '';
    const sampleRows = safeSampleRows(exportConfig?.sampleRows);
    const captureArgs = [`_out=${assignment.captureExpr ?? v}`];
    for (let i = 0; i < inputs.length; i++) {
        captureArgs.push(`_in${i}=${inputs[i]}`);
    }
    const shapeOf = (arg) => `str(getattr(${arg}, 'shape', ('?','?'))[0]) + ' rows and ' + ` +
        `str(getattr(${arg}, 'shape', ('?','?'))[1]) + ' columns'`;
    const blockParts = [
        (0, pyExpr_1.pyStringExpr)(`\n===DATALOG===\n${wrapSourceText(assignment.sourceText)}\n`),
    ];
    for (let i = 0; i < inputs.length; i++) {
        blockParts.push(`('Input dataframe' if hasattr(_in${i}, 'shape') else 'Input lazyframe') + ` +
            `${(0, pyExpr_1.pyStringExpr)(` "${inputs[i]}" has `)} + ${shapeOf(`_in${i}`)} + ${(0, pyExpr_1.pyStringExpr)('.\n')}`);
    }
    blockParts.push(`('New dataframe' if hasattr(_out, 'shape') else 'New lazyframe') + ` +
        `${(0, pyExpr_1.pyStringExpr)(` "${v}" has `)} + ${shapeOf('_out')} + ${(0, pyExpr_1.pyStringExpr)('.')}`);
    const timestampWrite = hasTimestamp
        ? `__import__('builtins').open(${(0, pyExpr_1.pyStringExpr)(logPath)}, 'a').write(` +
            `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
            `${(0, pyExpr_1.pyStringExpr)(`${v}: `)} + str(getattr(_out, 'shape', ('?','?'))[0]) + ` +
            `${(0, pyExpr_1.pyStringExpr)(' obs x ')} + str(getattr(_out, 'shape', ('?','?'))[1]) + ` +
            `${(0, pyExpr_1.pyStringExpr)(' vars\n')})`
        : '0';
    const blockWrite = hasLog
        ? `__import__('builtins').open(${(0, pyExpr_1.pyStringExpr)(logPath)}, 'a').write(_block + '\\n')`
        : '0';
    const csvWrite = hasCsv
        ? `((lambda _d=__import__('pathlib').Path(${(0, pyExpr_1.pyStringExpr)(csvDir)}): ` +
            `(_d.mkdir(parents=True, exist_ok=True), ` +
            `_out.head(${sampleRows}).write_csv(str(_d / ${(0, pyExpr_1.pyStringExpr)(`${(0, pyExpr_1.safeFileStem)(v)}.csv`)}))))() ` +
            `if hasattr(_out, 'write_csv') else 0)`
        : '0';
    const blockExpr = blockParts.join(' + ');
    const body = `(lambda _block=${blockExpr}: (` +
        `${timestampWrite}, ${blockWrite}, ${csvWrite}, _block)[-1])()`;
    return `{(lambda ${captureArgs.join(', ')}: ${body})()}`;
}
function buildInlinePrintVarLogMessage(varName, exportConfig) {
    const hasLog = !!exportConfig?.logFileAbsPath;
    const logPath = hasLog ? (0, pyExpr_1.normalizePathForPython)(exportConfig.logFileAbsPath) : '';
    const blockExpr = `${(0, pyExpr_1.pyStringExpr)(`\n===DATALOG=== ${varName}=`)} + ${printValueFormatExpr('_value')}`;
    const blockWrite = hasLog
        ? `__import__('builtins').open(${(0, pyExpr_1.pyStringExpr)(logPath)}, 'a').write(_block + '\\n')`
        : '0';
    return `{(lambda _value=${varName}: (lambda _block=${blockExpr}: (` +
        `${blockWrite}, _block)[-1])())()}`;
}
//# sourceMappingURL=sasFormatter.js.map