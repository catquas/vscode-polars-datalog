"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLogMessage = buildLogMessage;
/**
 * Escape literal { and } in text so VS Code logpoint interpolation
 * does not treat them as expression delimiters.
 */
function escapeForLogpoint(text) {
    return text.replace(/\{/g, '{{').replace(/\}/g, '}}');
}
/**
 * Build a Python expression that evaluates to the row count of varName,
 * or '?' if the variable doesn't have a .shape attribute.
 */
function shapeRows(varName) {
    return `{${varName}.shape[0] if hasattr(${varName}, 'shape') else '?'}`;
}
/**
 * Build a Python expression that evaluates to the column count of varName,
 * or '?' if the variable doesn't have a .shape attribute.
 */
function shapeCols(varName) {
    return `{${varName}.shape[1] if hasattr(${varName}, 'shape') else '?'}`;
}
/**
 * Build a SAS-style logpoint message for a DataFrame assignment.
 *
 * Example output:
 *   ===DATALOG=== | Code: result_df = input_df.filter(pl.col("age") > 25) |
 *   input_df: {input_df.shape[0] if ...} obs x {input_df.shape[1] if ...} vars |
 *   NOTE: The data set result_df has {result_df.shape[0] if ...} observations
 *         and {result_df.shape[1] if ...} variables.
 */
function buildLogMessage(assignment) {
    const parts = [];
    parts.push('===DATALOG===');
    parts.push(`Code: ${escapeForLogpoint(assignment.sourceText)}`);
    for (const inputVar of assignment.inputVars) {
        parts.push(`${inputVar}: ${shapeRows(inputVar)} obs x ${shapeCols(inputVar)} vars`);
    }
    parts.push(`NOTE: The data set ${assignment.varName} has ` +
        `${shapeRows(assignment.varName)} observations and ` +
        `${shapeCols(assignment.varName)} variables.`);
    return parts.join(' | ');
}
//# sourceMappingURL=sasFormatter.js.map