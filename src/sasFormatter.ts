import { DataFrameAssignment } from './pythonAnalyzer';

export interface ExportConfig {
  exportSamples: boolean;
  sampleRows: number;
  outputFolderAbsPath: string;
  logFileAbsPath: string;
}

/**
 * Escape literal { and } in text so VS Code logpoint interpolation
 * does not treat them as expression delimiters.
 */
function escapeForLogpoint(text: string): string {
  return text.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

/**
 * Build a Python expression that evaluates to the row count of varName,
 * or '?' if the variable doesn't have a .shape attribute.
 */
function shapeRows(varName: string): string {
  return `{${varName}.shape[0] if hasattr(${varName}, 'shape') else '?'}`;
}

/**
 * Build a Python expression that evaluates to the column count of varName,
 * or '?' if the variable doesn't have a .shape attribute.
 */
function shapeCols(varName: string): string {
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
export function buildLogMessage(assignment: DataFrameAssignment, exportConfig?: ExportConfig): string {
  const parts: string[] = [];

  parts.push('===DATALOG===');
  parts.push(`Code: ${escapeForLogpoint(assignment.sourceText)}`);

  for (const inputVar of assignment.inputVars) {
    parts.push(`${inputVar}: ${shapeRows(inputVar)} obs x ${shapeCols(inputVar)} vars`);
  }

  parts.push(
    `NOTE: The data set ${assignment.varName} has ` +
    `${shapeRows(assignment.varName)} observations and ` +
    `${shapeCols(assignment.varName)} variables.`
  );

  const hasCsv = !!(exportConfig?.exportSamples && exportConfig.outputFolderAbsPath);
  const hasLog = !!(exportConfig?.logFileAbsPath);

  if (hasCsv) {
    const absPath = exportConfig!.outputFolderAbsPath.replace(/\\/g, '/');
    const logPath = exportConfig!.logFileAbsPath.replace(/\\/g, '/');
    const v = assignment.varName;
    const n = exportConfig!.sampleRows;

    // Optional log-write action appended inside the tuple
    const logAction = logPath
      ? `, open('${logPath}', 'a').write(` +
        `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
        `'${v}: ' + str(_r[0]) + ' obs x ' + str(_r[1]) + ' vars\\n')`
      : '';

    parts.push(
      `{(lambda _d, _r: (_d.mkdir(parents=True, exist_ok=True), ` +
      `${v}.head(${n}).write_csv(str(_d / '${v}.csv'))${logAction}) ` +
      `and ('→ CSV: ' + str(_d / '${v}.csv')))` +
      `(__import__('pathlib').Path('${absPath}'), ${v}.shape) ` +
      `if hasattr(${v}, 'write_csv') else '→ LazyFrame, skipped'}`
    );
  } else if (hasLog) {
    // CSV disabled but log still requested
    const logPath = exportConfig!.logFileAbsPath.replace(/\\/g, '/');
    const v = assignment.varName;
    parts.push(
      `{open('${logPath}', 'a').write(` +
      `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
      `'${v}: ' + str(${v}.shape[0]) + ' obs x ' + str(${v}.shape[1]) + ' vars\\n') ` +
      `and '→ logged' if hasattr(${v}, 'shape') else ''}`
    );
  }

  return parts.join(' | ');
}
