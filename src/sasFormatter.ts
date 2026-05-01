import { DataFrameAssignment } from './pythonAnalyzer';

export interface ExportConfig {
  exportSamples: boolean;
  sampleRows: number;
  outputFolderAbsPath: string;
  logFileAbsPath: string;
  logTimestampLines: boolean;
}

/**
 * Escape literal { and } in text so VS Code logpoint interpolation
 * does not treat them as expression delimiters.
 */
function escapeForLogpoint(text: string): string {
  // VS Code logpoints treat { as expression-start, so we can't use {{ as an
  // escape. Use Python chr() expressions instead. Single pass avoids the } in
  // {chr(123)} being re-escaped by a second replacement.
  return text.replace(/[{}]/g, ch => ch === '{' ? '{chr(123)}' : '{chr(125)}');
}

const WRAP_AT = 90;

/**
 * Return positions of all commas at the minimum bracket depth found (> 0),
 * skipping commas inside string literals and comments.
 * These are the "outermost" commas — dict keys, function args, list elements
 * at the top-most nesting level present in the line.
 */
function outermostCommaPositions(line: string): number[] {
  const found: { pos: number; depth: number }[] = [];
  let depth = 0;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && line[i + 1] === ch && line[i + 2] === ch) {
      const q = line.slice(i, i + 3);
      i += 3;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; }
        else if (line.slice(i, i + 3) === q) { i += 3; break; }
        else { i++; }
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch; i++;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; }
        else if (line[i] === q) { i++; break; }
        else { i++; }
      }
      continue;
    }
    if (ch === '#') { break; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; }
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; }
    else if (ch === ',' && depth > 0) { found.push({ pos: i, depth }); }
    i++;
  }
  if (found.length === 0) { return []; }
  const min = Math.min(...found.map(c => c.depth));
  return found.filter(c => c.depth === min).map(c => c.pos);
}

/**
 * Wrap a single long line at outermost commas so each output line stays
 * under WRAP_AT characters. Returns the line unchanged if it already fits
 * or has no breakable commas.
 */
function breakLongLine(line: string): string {
  if (line.length <= WRAP_AT) { return line; }
  const commas = outermostCommaPositions(line);
  if (commas.length === 0) { return line; }

  const baseIndent = (line.match(/^(\s*)/) ?? ['', ''])[1];
  const contIndent = baseIndent + '    ';

  // Split into segments; each segment (except the last) includes its trailing comma.
  const segs: string[] = [];
  let prev = 0;
  for (const pos of commas) {
    segs.push(line.slice(prev, pos + 1).trim());
    prev = pos + 1;
  }
  segs.push(line.slice(prev).trim());

  // Greedy: extend current line if it still fits, otherwise start a new one.
  const outLines: string[] = [];
  let cur = baseIndent + segs[0];
  for (let j = 1; j < segs.length; j++) {
    const candidate = cur + ' ' + segs[j];
    if (candidate.length <= WRAP_AT) {
      cur = candidate;
    } else {
      outLines.push(cur);
      cur = contIndent + segs[j];
    }
  }
  outLines.push(cur);
  return outLines.join('\n');
}

/** Apply breakLongLine to every line in a (possibly multi-line) source text. */
function wrapSourceText(text: string): string {
  return text.split('\n').map(breakLongLine).join('\n');
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

  parts.push('\n===DATALOG===');
  parts.push(`\n${wrapSourceText(escapeForLogpoint(assignment.sourceText))}`);

  for (const inputVar of assignment.inputVars) {
    parts.push(
      `\n{('Input lazyframe' if not hasattr(${inputVar}, 'shape') else 'Input dataframe')} ` +
      `"${inputVar}" has ${shapeRows(inputVar)} rows and ${shapeCols(inputVar)} columns.`
    );
  }

  parts.push(
    `\n{('New lazyframe' if not hasattr(${assignment.varName}, 'shape') else 'New dataframe')} ` +
    `"${assignment.varName}" has ` +
    `${shapeRows(assignment.varName)} rows and ` +
    `${shapeCols(assignment.varName)} columns.`
  );

  const hasCsv = !!(exportConfig?.exportSamples && exportConfig.outputFolderAbsPath);
  const hasLog = !!(exportConfig?.logFileAbsPath);

  if (hasCsv) {
    const absPath = exportConfig!.outputFolderAbsPath.replace(/\\/g, '/').replace(/'/g, "\\'");
    const logPath = exportConfig!.logFileAbsPath.replace(/\\/g, '/').replace(/'/g, "\\'");
    const v = assignment.varName;
    const n = exportConfig!.sampleRows;

    // Optional log-write action appended inside the tuple
    const logAction = (logPath && exportConfig?.logTimestampLines)
      ? `, open('${logPath}', 'a').write(` +
        `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
        `'${v}: ' + str(_r[0]) + ' obs x ' + str(_r[1]) + ' vars\\n')`
      : '';

    parts.push(
      `{(lambda _d, _r: (_d.mkdir(parents=True, exist_ok=True), ` +
      `${v}.head(${n}).write_csv(str(_d / '${v}.csv'))${logAction}) ` +
      `and ('→ ' + str('${v}.csv')))` +
      `(__import__('pathlib').Path('${absPath}'), ${v}.shape) ` +
      `if hasattr(${v}, 'write_csv') else '→ LazyFrame, skipped'}`
    );
  } else if (hasLog && exportConfig?.logTimestampLines) {
    // CSV disabled but timestamp lines requested
    const logPath = exportConfig!.logFileAbsPath.replace(/\\/g, '/').replace(/'/g, "\\'");
    const v = assignment.varName;
    parts.push(
      `{open('${logPath}', 'a').write(` +
      `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
      `'${v}: ' + str(${v}.shape[0]) + ' obs x ' + str(${v}.shape[1]) + ' vars\\n') ` +
      `and '→ logged' if hasattr(${v}, 'shape') else ''}`
    );
  }

  // Break after the Code block so metadata stays on its own line
  const [header, code, ...rest] = parts;
  return `${header}${code}${rest.join(' ')}`;
}

export function buildPrintVarLogMessage(varName: string): string {
  return `\n===DATALOG=== ${varName}={repr(${varName})}`;
}
