"use strict";
/**
 * Helpers for building Python source fragments that are safe to embed in a
 * VS Code logpoint message.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePathForPython = normalizePathForPython;
exports.pyStringExpr = pyStringExpr;
exports.safeFileStem = safeFileStem;
exports.safeCaptureExpr = safeCaptureExpr;
exports.shortHash = shortHash;
/** Convert Windows separators so the text can sit inside a Python string literal. */
function normalizePathForPython(path) {
    return path.replace(/\\/g, '/');
}
/**
 * Build a Python string expression without literal braces. VS Code logpoints
 * use braces as expression delimiters even when the brace appears in a Python
 * string literal, so source braces become chr(123)/chr(125) pieces.
 */
function pyStringExpr(text) {
    const parts = [];
    let current = '';
    function flush() {
        if (current.length > 0) {
            parts.push(`'${current}'`);
            current = '';
        }
    }
    for (const ch of text) {
        if (ch === '{') {
            flush();
            parts.push('chr(123)');
        }
        else if (ch === '}') {
            flush();
            parts.push('chr(125)');
        }
        else if (ch === '\\') {
            current += '\\\\';
        }
        else if (ch === "'") {
            current += "\\'";
        }
        else if (ch === '\n') {
            current += '\\n';
        }
        else if (ch === '\r') {
            current += '\\r';
        }
        else if (ch === '\t') {
            current += '\\t';
        }
        else {
            current += ch;
        }
    }
    flush();
    return parts.length > 0 ? parts.join(' + ') : "''";
}
/**
 * Reduce a variable name or target expression to a safe file stem.
 * `self.raw_df` becomes `self_raw_df`; anything that could escape the output
 * folder (dots, separators) is replaced.
 */
function safeFileStem(name) {
    const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned.length > 0 ? cleaned.slice(0, 120) : 'datalog_output';
}
/**
 * Read a variable without risking a NameError.
 *
 * pydevd evaluates a logpoint with `eval(expr, frame.f_globals, frame.f_locals)`,
 * so `locals()` inside the expression is the frame's locals and `globals()` its
 * module namespace. A name that is not bound yields NotImplemented, which the
 * runtime reports as "not in scope" instead of losing the whole block.
 * Attribute and subscript targets are read directly — there is no name to look up.
 */
function safeCaptureExpr(target) {
    if (!/^[A-Za-z_]\w*$/.test(target)) {
        return target;
    }
    const name = pyStringExpr(target);
    return `locals().get(${name}, globals().get(${name}, NotImplemented))`;
}
/** Deterministic 32-bit FNV-1a hash, rendered as 8 hex chars. */
function shortHash(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
//# sourceMappingURL=pyExpr.js.map