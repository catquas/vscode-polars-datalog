"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countNetBrackets = countNetBrackets;
exports.findInputVars = findInputVars;
exports.analyzeFile = analyzeFile;
/**
 * Walk text character-by-character tracking string state to count net bracket depth.
 * Brackets inside string literals are ignored.
 * Returns net (opens - closes) for (), [], {}.
 */
function countNetBrackets(text) {
    let depth = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        // Check for triple-quote strings first
        if ((ch === '"' || ch === "'") && text[i + 1] === ch && text[i + 2] === ch) {
            const quote = text.slice(i, i + 3);
            i += 3;
            // Scan for closing triple quote
            while (i < text.length) {
                if (text[i] === '\\') {
                    i += 2; // skip escaped char
                }
                else if (text.slice(i, i + 3) === quote) {
                    i += 3;
                    break;
                }
                else {
                    i++;
                }
            }
            continue;
        }
        // Single-character string
        if (ch === '"' || ch === "'") {
            const quote = ch;
            i++;
            while (i < text.length) {
                if (text[i] === '\\') {
                    i += 2;
                }
                else if (text[i] === quote) {
                    i++;
                    break;
                }
                else {
                    i++;
                }
            }
            continue;
        }
        // Comment — rest of line doesn't count
        if (ch === '#') {
            break;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        }
        else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
        }
        i++;
    }
    return depth;
}
/**
 * Return all known DF var names that appear as whole words in rhs.
 */
function findInputVars(rhs, knownDfVars) {
    const found = [];
    for (const name of knownDfVars) {
        const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
        if (pattern.test(rhs)) {
            found.push(name);
        }
    }
    return found;
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Decide whether an assignment creates a DataFrame variable.
 */
function isDataFrameAssignment(varName, rhs, knownDfVars, config) {
    // Heuristic 1: variable name ends with a known suffix
    for (const suffix of config.dfNameSuffixes) {
        if (varName === suffix || varName.endsWith(suffix)) {
            return true;
        }
    }
    // Heuristic 2: RHS calls a Polars constructor
    const alias = escapeRegex(config.polarsAlias);
    const constructorPattern = new RegExp(`${alias}\\.(DataFrame|read_csv|read_parquet|read_excel|read_json|from_pandas|concat)\\s*\\(`);
    if (constructorPattern.test(rhs)) {
        return true;
    }
    // Heuristic 3: RHS chains a DataFrame transformation method on a known DF var
    const dfMethods = [
        'filter', 'select', 'with_columns', 'join', 'group_by', 'agg',
        'rename', 'sort', 'unique', 'drop', 'head', 'tail', 'sample',
        'explode', 'melt', 'pivot', 'unpivot', 'cast', 'fill_null',
        'fill_nan', 'drop_nulls', 'limit', 'slice', 'gather', 'transpose',
        'lazy', 'collect', 'pipe', 'with_row_index'
    ];
    const methodPattern = new RegExp(`\\b(${[...knownDfVars].map(escapeRegex).join('|')})\\.(${dfMethods.join('|')})\\s*\\(`);
    if (knownDfVars.size > 0 && methodPattern.test(rhs)) {
        return true;
    }
    return false;
}
// Matches: [optional indent] varName = rhs (plain assignment only, not ==, +=, -=, etc.)
// No lookbehind needed: augmented assignments like += naturally fail because \s*= won't match "+="
const ASSIGNMENT_RE = /^(\s*)([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/;
/**
 * Parse a Python source string and return all detected DataFrame assignments.
 */
function analyzeFile(source, config) {
    // Strip \r to handle Windows line endings (\r\n)
    const lines = source.replace(/\r/g, '').split('\n');
    const results = [];
    const knownDfVars = new Set();
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const match = ASSIGNMENT_RE.exec(line);
        if (!match) {
            i++;
            continue;
        }
        const varName = match[2];
        const rhs = match[3];
        if (!isDataFrameAssignment(varName, rhs, knownDfVars, config)) {
            i++;
            continue;
        }
        // Collect the full multi-line expression by tracking bracket depth
        const startLine = i;
        let endLine = i;
        let bracketDepth = countNetBrackets(line);
        const sourceLines = [line.trimEnd()];
        while (bracketDepth > 0 && endLine + 1 < lines.length) {
            endLine++;
            const nextLine = lines[endLine];
            sourceLines.push(nextLine.trimEnd());
            bracketDepth += countNetBrackets(nextLine);
        }
        // Reconstruct source text (trim common leading whitespace for display)
        const indent = match[1];
        const sourceText = sourceLines
            .map(l => l.startsWith(indent) ? l.slice(indent.length) : l)
            .join('\n');
        // Collect full RHS text for input var detection
        const fullRhs = sourceLines.join(' ');
        const inputVars = findInputVars(fullRhs, knownDfVars);
        results.push({
            varName,
            sourceText,
            range: { startLine, endLine },
            inputVars,
        });
        knownDfVars.add(varName);
        i = endLine + 1;
    }
    return results;
}
//# sourceMappingURL=pythonAnalyzer.js.map