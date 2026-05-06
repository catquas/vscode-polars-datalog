import { DataFrameAssignment } from './pythonAnalyzer';

export interface ExportConfig {
  exportSamples: boolean;
  sampleRows: number;
  outputFolderAbsPath: string;
  logFileAbsPath: string;
  logTimestampLines: boolean;
}

const WRAP_AT = 90;
const DEFAULT_SAMPLE_ROWS = 1000;
const MAX_SAMPLE_ROWS = 100000;

function safeSampleRows(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SAMPLE_ROWS;
  }
  return Math.max(0, Math.min(Math.trunc(value), MAX_SAMPLE_ROWS));
}

/**
 * Return positions of all commas at the minimum bracket depth found (> 0),
 * skipping commas inside string literals and comments.
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

function breakLongLine(line: string): string {
  if (line.length <= WRAP_AT) { return line; }
  const commas = outermostCommaPositions(line);
  if (commas.length === 0) { return line; }

  const baseIndent = (line.match(/^(\s*)/) ?? ['', ''])[1];
  const contIndent = baseIndent + '    ';
  const segs: string[] = [];
  let prev = 0;
  for (const pos of commas) {
    segs.push(line.slice(prev, pos + 1).trim());
    prev = pos + 1;
  }
  segs.push(line.slice(prev).trim());

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

function wrapSourceText(text: string): string {
  return text.split('\n').map(breakLongLine).join('\n');
}

function normalizePathForPython(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Build a Python string expression without literal braces. VS Code logpoints
 * use braces as expression delimiters even when the brace appears in a Python
 * string literal, so source braces become chr(123)/chr(125) pieces.
 */
function pyStringExpr(text: string): string {
  const parts: string[] = [];
  let current = '';

  function flush(): void {
    if (current.length > 0) {
      parts.push(`'${current}'`);
      current = '';
    }
  }

  for (const ch of text) {
    if (ch === '{') {
      flush();
      parts.push('chr(123)');
    } else if (ch === '}') {
      flush();
      parts.push('chr(125)');
    } else if (ch === '\\') {
      current += '\\\\';
    } else if (ch === "'") {
      current += "\\'";
    } else if (ch === '\n') {
      current += '\\n';
    } else if (ch === '\r') {
      current += '\\r';
    } else if (ch === '\t') {
      current += '\\t';
    } else {
      current += ch;
    }
  }
  flush();

  return parts.length > 0 ? parts.join(' + ') : "''";
}

/**
 * Build a SAS-style logpoint message for a DataFrame assignment.
 *
 * The logpoint contains exactly one runtime expression. It captures all local
 * values as lambda default arguments before Python resumes, writes plog.log and
 * CSV samples as side effects, then returns the full block for the Debug Console.
 */
export function buildLogMessage(assignment: DataFrameAssignment, exportConfig?: ExportConfig): string {
  const v = assignment.varName;
  const inputs = assignment.inputVars;
  const hasCsv = !!(exportConfig?.exportSamples && exportConfig.outputFolderAbsPath);
  const hasLog = !!exportConfig?.logFileAbsPath;
  const hasTimestamp = !!(hasLog && exportConfig?.logTimestampLines);
  const csvDir = hasCsv ? normalizePathForPython(exportConfig!.outputFolderAbsPath) : '';
  const logPath = hasLog ? normalizePathForPython(exportConfig!.logFileAbsPath) : '';
  const sampleRows = safeSampleRows(exportConfig?.sampleRows);

  const captureArgs: string[] = [`_out=${v}`];
  for (let i = 0; i < inputs.length; i++) {
    captureArgs.push(`_in${i}=${inputs[i]}`);
  }

  const shapeOf = (arg: string) =>
    `str(getattr(${arg}, 'shape', ('?','?'))[0]) + ' rows and ' + ` +
    `str(getattr(${arg}, 'shape', ('?','?'))[1]) + ' columns'`;

  const blockParts: string[] = [
    pyStringExpr(`\n===DATALOG===\n${wrapSourceText(assignment.sourceText)}\n`),
  ];
  for (let i = 0; i < inputs.length; i++) {
    blockParts.push(
      `('Input dataframe' if hasattr(_in${i}, 'shape') else 'Input lazyframe') + ` +
      `${pyStringExpr(` "${inputs[i]}" has `)} + ${shapeOf(`_in${i}`)} + ${pyStringExpr('.\n')}`
    );
  }
  blockParts.push(
    `('New dataframe' if hasattr(_out, 'shape') else 'New lazyframe') + ` +
    `${pyStringExpr(` "${v}" has `)} + ${shapeOf('_out')} + ${pyStringExpr('.')}`
  );

  const timestampWrite = hasTimestamp
    ? `__import__('builtins').open(${pyStringExpr(logPath)}, 'a').write(` +
      `__import__('datetime').datetime.now().strftime('[%H:%M:%S] ') + ` +
      `${pyStringExpr(`${v}: `)} + str(getattr(_out, 'shape', ('?','?'))[0]) + ` +
      `${pyStringExpr(' obs x ')} + str(getattr(_out, 'shape', ('?','?'))[1]) + ` +
      `${pyStringExpr(' vars\n')})`
    : '0';
  const blockWrite = hasLog
    ? `__import__('builtins').open(${pyStringExpr(logPath)}, 'a').write(_block + '\\n')`
    : '0';
  const csvWrite = hasCsv
    ? `((lambda _d=__import__('pathlib').Path(${pyStringExpr(csvDir)}): ` +
      `(_d.mkdir(parents=True, exist_ok=True), ` +
      `_out.head(${sampleRows}).write_csv(str(_d / ${pyStringExpr(`${v}.csv`)}))))() ` +
      `if hasattr(_out, 'write_csv') else 0)`
    : '0';

  const blockExpr = blockParts.join(' + ');
  const body = `(lambda _block=${blockExpr}: (` +
    `${timestampWrite}, ${blockWrite}, ${csvWrite}, _block)[-1])()`;

  return `{(lambda ${captureArgs.join(', ')}: ${body})()}`;
}

export function buildPrintVarLogMessage(varName: string, exportConfig?: ExportConfig): string {
  const hasLog = !!exportConfig?.logFileAbsPath;
  const logPath = hasLog ? normalizePathForPython(exportConfig!.logFileAbsPath) : '';
  const blockExpr = `${pyStringExpr(`\n===DATALOG=== ${varName}=`)} + repr(_value)`;
  const blockWrite = hasLog
    ? `__import__('builtins').open(${pyStringExpr(logPath)}, 'a').write(_block + '\\n')`
    : '0';
  return `{(lambda _value=${varName}: (lambda _block=${blockExpr}: (` +
    `${blockWrite}, _block)[-1])())()}`;
}
