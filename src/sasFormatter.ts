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
 * Return a one-line label for the logpoint Code: section.
 * For single-line source the text is returned as-is.
 * For multi-line source we use the first line + " ...", but truncate just
 * before any { that would be left unmatched — an unmatched {{ in a logpoint
 * template causes debugpy to print "Unbalanced braces" and skip evaluation.
 */
function codeLabel(sourceText: string): string {
  const nl = sourceText.indexOf('\n');
  if (nl === -1) { return sourceText; }
  const firstLine = sourceText.slice(0, nl);

  let depth = 0;
  let lastBalancedEnd = 0;
  for (let i = 0; i < firstLine.length; i++) {
    if (firstLine[i] === '{') { depth++; }
    else if (firstLine[i] === '}') { depth--; }
    if (depth === 0) { lastBalancedEnd = i + 1; }
  }

  const safe = depth === 0 ? firstLine : firstLine.slice(0, lastBalancedEnd);
  return safe + ' ...';
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
 * Wrap a logpoint expression in a deduplication guard keyed on id(varName).
 *
 * Multiple debugpy sub-sessions can evaluate the same logpoint concurrently
 * in the same Python process — this guard ensures only the first evaluation
 * per unique DataFrame object (identified by id()) does any work.
 * sys._dl_datalog is a set that persists for the life of the process and is
 * automatically cleared when the next debug run starts a fresh process.
 */
function dedupWrap(varName: string, innerExpr: string): string {
  return (
    `{(lambda _i=id(${varName}),` +
    `_dl=__import__('sys').__dict__.setdefault('_dl_datalog',set()):` +
    `''if _i in _dl else` +
    `(lambda _x:(_dl.add(_i),_x)[1])(${innerExpr}))()}`
  );
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
  parts.push(`Code: ${escapeForLogpoint(codeLabel(assignment.sourceText))}`);

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

    const logAction = logPath
      ? `, open('${logPath}', 'a').write(` +
        `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
        `'${v}: ' + str(_r[0]) + ' obs x ' + str(_r[1]) + ' vars\\n')`
      : '';

    const innerExpr =
      `(lambda _d, _r: (_d.mkdir(parents=True, exist_ok=True), ` +
      `${v}.head(${n}).write_csv(str(_d / '${v}.csv'))${logAction}) ` +
      `and ('→ CSV: ' + str(_d / '${v}.csv')))` +
      `(__import__('pathlib').Path('${absPath}'), ${v}.shape) ` +
      `if hasattr(${v}, 'write_csv') else '→ LazyFrame, skipped'`;

    parts.push(dedupWrap(v, innerExpr));
  } else if (hasLog) {
    const logPath = exportConfig!.logFileAbsPath.replace(/\\/g, '/');
    const v = assignment.varName;

    const innerExpr =
      `open('${logPath}', 'a').write(` +
      `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
      `'${v}: ' + str(${v}.shape[0]) + ' obs x ' + str(${v}.shape[1]) + ' vars\\n') ` +
      `and '→ logged' if hasattr(${v}, 'shape') else ''`;

    parts.push(dedupWrap(v, innerExpr));
  }

  return parts.join(' | ');
}
