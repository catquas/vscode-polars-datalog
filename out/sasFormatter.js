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
function buildLogMessage(assignment, exportConfig) {
    const parts = [];
    parts.push('\n===DATALOG===');
    parts.push(`\n${escapeForLogpoint(assignment.sourceText)}`);
    for (const inputVar of assignment.inputVars) {
        parts.push(`\nInput dataframe "${inputVar}" has ${shapeRows(inputVar)} rows and ${shapeCols(inputVar)} columns.`);
    }
    parts.push(`\nNew dataframe "${assignment.varName}" has ` +
        `${shapeRows(assignment.varName)} rows and ` +
        `${shapeCols(assignment.varName)} columns.`);
    const hasCsv = !!(exportConfig?.exportSamples && exportConfig.outputFolderAbsPath);
    const hasLog = !!(exportConfig?.logFileAbsPath);
    if (hasCsv) {
        const absPath = exportConfig.outputFolderAbsPath.replace(/\\/g, '/');
        const logPath = exportConfig.logFileAbsPath.replace(/\\/g, '/');
        const v = assignment.varName;
        const n = exportConfig.sampleRows;
        // Optional log-write action appended inside the tuple
        const logAction = (logPath && exportConfig?.logTimestampLines)
            ? `, open('${logPath}', 'a').write(` +
                `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
                `'${v}: ' + str(_r[0]) + ' obs x ' + str(_r[1]) + ' vars\\n')`
            : '';
        parts.push(`{(lambda _d, _r: (_d.mkdir(parents=True, exist_ok=True), ` +
            `${v}.head(${n}).write_csv(str(_d / '${v}.csv'))${logAction}) ` +
            `and ('→ ' + str('${v}.csv')))` +
            `(__import__('pathlib').Path('${absPath}'), ${v}.shape) ` +
            `if hasattr(${v}, 'write_csv') else '→ LazyFrame, skipped'}`);
    }
    else if (hasLog && exportConfig?.logTimestampLines) {
        // CSV disabled but timestamp lines requested
        const logPath = exportConfig.logFileAbsPath.replace(/\\/g, '/');
        const v = assignment.varName;
        parts.push(`{open('${logPath}', 'a').write(` +
            `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
            `'${v}: ' + str(${v}.shape[0]) + ' obs x ' + str(${v}.shape[1]) + ' vars\\n') ` +
            `and '→ logged' if hasattr(${v}, 'shape') else ''}`);
    }
    // Break after the Code block so metadata stays on its own line
    const [header, code, ...rest] = parts;
    return `${header}${code}${rest.join(' ')}`;
}
//# sourceMappingURL=sasFormatter.js.map