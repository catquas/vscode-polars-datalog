export interface DataFrameAssignment {
  /** Display name, also used for the sample file name. */
  varName: string;
  /** Python expression that reads the value; defaults to varName. */
  captureExpr?: string;
  /** Full multi-line source text of the assignment. */
  sourceText: string;
  /** 0-based line numbers of the statement. */
  range: { startLine: number; endLine: number };
  /** Known frame vars referenced in the RHS that are in scope at logLine. */
  inputVars: string[];
  /** 0-based line the logpoint goes on, or -1 when no in-scope line exists. */
  logLine: number;
  /** Why this assignment was treated as a frame (diagnostics). */
  reason?: string;
  /** Why no logpoint could be placed (diagnostics). */
  skipReason?: string;
  /** "file.py:12", filled in when the logpoint is built. */
  location?: string;
}

export interface AnalyzerConfig {
  polarsAlias: string;
  dfNameSuffixes: string[];
}

export interface LineScanState {
  depth: number;
  /** Triple-quote delimiter still open at end of line, else null. */
  openQuote: string | null;
}

/**
 * Walk text character-by-character tracking string state to count net bracket
 * depth. Brackets inside string literals and comments are ignored.
 * `openQuote` carries an unterminated triple-quoted string across lines.
 */
export function scanLine(text: string, openQuote: string | null = null): LineScanState {
  let depth = 0;
  let i = 0;
  let quote = openQuote;

  if (quote) {
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2;
      } else if (text.slice(i, i + 3) === quote) {
        i += 3;
        quote = null;
        break;
      } else {
        i++;
      }
    }
    if (quote) { return { depth: 0, openQuote: quote }; }
  }

  while (i < text.length) {
    const ch = text[i];

    // Triple-quoted strings first, so '"""' is not read as two quotes
    if ((ch === '"' || ch === "'") && text[i + 1] === ch && text[i + 2] === ch) {
      const delimiter = text.slice(i, i + 3);
      i += 3;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
        } else if (text.slice(i, i + 3) === delimiter) {
          i += 3;
          closed = true;
          break;
        } else {
          i++;
        }
      }
      if (!closed) { return { depth, openQuote: delimiter }; }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const delimiter = ch;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
        } else if (text[i] === delimiter) {
          i++;
          break;
        } else {
          i++;
        }
      }
      continue;
    }

    // Comment — rest of line doesn't count
    if (ch === '#') { break; }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    }

    i++;
  }

  return { depth, openQuote: null };
}

/** Net (opens - closes) for (), [], {} outside strings and comments. */
export function countNetBrackets(text: string): number {
  return scanLine(text).depth;
}

/**
 * Return all known frame var names that appear as whole words in rhs.
 */
export function findInputVars(rhs: string, knownDfVars: Set<string> | string[]): string[] {
  const found: string[] = [];
  for (const name of knownDfVars) {
    const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
    if (pattern.test(rhs)) {
      found.push(name);
    }
  }
  return found;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Polars vocabulary
// ---------------------------------------------------------------------------

/**
 * Methods that only Polars frames have — safe to match on any receiver.
 * Names other popular libraries also use (`groupby`, `cast`, `sql`) belong in
 * GENERIC_FRAME_METHODS instead, or `typing.cast()` and pandas `groupby()`
 * would be logged as frames.
 */
const POLARS_ONLY_METHODS = [
  'with_columns', 'with_columns_seq', 'select_seq', 'group_by', 'group_by_dynamic',
  'join_asof', 'join_where', 'drop_nulls', 'drop_nans', 'with_row_index',
  'with_row_count', 'unpivot', 'melt', 'pivot', 'unnest', 'unstack', 'collect',
  'lazy', 'explode', 'rechunk', 'set_sorted', 'top_k', 'bottom_k', 'to_dummies',
  'partition_by', 'hstack', 'vstack', 'upsample', 'approx_n_unique', 'collect_schema',
  'match_to_schema',
];

/** Generic method names — only matched on receivers already known to be frames. */
const GENERIC_FRAME_METHODS = [
  'filter', 'select', 'join', 'agg', 'rename', 'sort', 'unique', 'head', 'tail',
  'sample', 'limit', 'slice', 'drop', 'remove', 'fill_null', 'fill_nan',
  'interpolate', 'shift', 'reverse', 'describe', 'transpose', 'pipe', 'clone',
  'clear', 'extend', 'gather', 'count', 'mean', 'sum', 'min', 'max', 'median',
  'std', 'var', 'quantile', 'null_count', 'to_frame', 'cast', 'groupby', 'sql',
];

/** Polars entry points that create a frame. */
const POLARS_CONSTRUCTORS = [
  'DataFrame', 'LazyFrame', 'read_csv', 'read_csv_batched', 'read_parquet',
  'read_excel', 'read_json', 'read_ndjson', 'read_ipc', 'read_avro', 'read_delta',
  'read_database', 'read_database_uri', 'read_clipboard', 'from_pandas',
  'from_arrow', 'from_dict', 'from_dicts', 'from_records', 'from_numpy',
  'from_repr', 'concat', 'scan_csv', 'scan_parquet', 'scan_ipc', 'scan_ndjson',
  'scan_delta', 'scan_iceberg', 'scan_pyarrow_dataset', 'sql',
];

const FRAME_TYPE_NAMES = 'DataFrame|LazyFrame';

/** Return annotations that wrap frames in a container are not frames. */
const CONTAINER_ANNOTATION_RE =
  /\b(tuple|list|dict|set|frozenset|Tuple|List|Dict|Set|Iterable|Iterator|Generator|AsyncIterator|Sequence|Mapping|Awaitable|Coroutine)\s*\[/;

function frameAnnotationRe(alias: string): RegExp {
  const a = escapeRegex(alias);
  return new RegExp(`(?:${a}\\.(?:${FRAME_TYPE_NAMES})|(?<![\\w.])(?:${FRAME_TYPE_NAMES})(?![\\w]))`);
}

/** True when a type annotation denotes a bare Polars frame. */
export function isFrameAnnotation(annotation: string, config: AnalyzerConfig): boolean {
  const text = annotation.replace(/["']/g, '').trim();
  if (!text || CONTAINER_ANNOTATION_RE.test(text)) { return false; }
  return frameAnnotationRe(config.polarsAlias).test(text);
}

/**
 * Scan source for functions annotated to return a Polars frame and return their
 * names. Handles multi-line signatures by searching backward from the `->`
 * annotation line for the owning `def funcname(`.
 */
export function findDfReturningFunctions(source: string, config: AnalyzerConfig): Set<string> {
  const lines = source.replace(/\r/g, '').split('\n');
  const funcs = new Set<string>();
  const defRe = /(?:async\s+)?def\s+(\w+)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const arrow = lines[i].indexOf('->');
    if (arrow < 0) { continue; }
    const annotation = lines[i].slice(arrow + 2).replace(/:\s*(#.*)?$/, '');
    if (!isFrameAnnotation(annotation, config)) { continue; }
    for (let j = i; j >= Math.max(0, i - 20); j--) {
      const m = defRe.exec(lines[j]);
      if (m) { funcs.add(m[1]); break; }
    }
  }
  return funcs;
}

/**
 * Variables annotated as Polars frames anywhere in the file: function
 * parameters, attributes and annotated assignments. Seeding these makes
 * `out = frame_param.filter(...)` detectable inside helper functions.
 */
export function findAnnotatedFrameVars(source: string, config: AnalyzerConfig): Set<string> {
  const found = new Set<string>();
  const alias = escapeRegex(config.polarsAlias);
  const re = new RegExp(
    `\\b([A-Za-z_]\\w*)\\s*:\\s*"?(?:Optional\\s*\\[\\s*)?(?:${alias}\\.)?(${FRAME_TYPE_NAMES})\\b`,
    'g'
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    found.add(m[1]);
  }
  return found;
}

/** Names imported directly from polars, e.g. `from polars import read_csv`. */
export function findPolarsImportedNames(source: string): Set<string> {
  const found = new Set<string>();
  const re = /^\s*from\s+polars(?:\.\w+)*\s+import\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].replace(/[()]/g, '').split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_]\w*$/.test(name)) { found.add(name); }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Statement collection
// ---------------------------------------------------------------------------

export interface LogicalStatement {
  /** All physical lines joined with a space, continuations removed. */
  text: string;
  /** Physical lines, right-trimmed. */
  lines: string[];
  startLine: number;
  endLine: number;
  indent: number;
}

function indentWidth(line: string): number {
  const m = /^([ \t]*)/.exec(line);
  return m ? m[1].replace(/\t/g, '    ').length : 0;
}

function isBlank(line: string): boolean {
  const stripped = line.trim();
  return stripped === '' || stripped.startsWith('#');
}

/**
 * Group physical lines into logical statements, following bracket depth and
 * backslash continuations and skipping multi-line string bodies.
 */
export function collectStatements(lines: string[]): LogicalStatement[] {
  const statements: LogicalStatement[] = [];
  let i = 0;
  let openQuote: string | null = null;

  while (i < lines.length) {
    const first = lines[i];

    if (openQuote) {
      openQuote = scanLine(first, openQuote).openQuote;
      i++;
      continue;
    }
    if (isBlank(first)) {
      i++;
      continue;
    }

    const collected = [first.replace(/\s+$/, '')];
    let end = i;
    let state = scanLine(first);
    let depth = state.depth;
    openQuote = state.openQuote;
    let continued = /\\$/.test(collected[0]);

    while ((depth > 0 || continued || openQuote) && end + 1 < lines.length) {
      end++;
      const next = lines[end].replace(/\s+$/, '');
      collected.push(next);
      state = scanLine(next, openQuote);
      depth += state.depth;
      openQuote = state.openQuote;
      continued = /\\$/.test(next);
    }

    statements.push({
      text: collected.map(line => line.replace(/\\$/, '')).join(' '),
      lines: collected,
      startLine: i,
      endLine: end,
      indent: indentWidth(first),
    });
    i = end + 1;
  }

  return statements;
}

// ---------------------------------------------------------------------------
// Assignment targets
// ---------------------------------------------------------------------------

export interface AssignmentTarget {
  /** Display name, e.g. `self.raw_df`. */
  name: string;
  /** Trailing identifier used for suffix matching, e.g. `raw_df`. */
  tailName: string;
  /** Python expression to read the value. */
  captureExpr: string;
  annotation?: string;
  /** Part of a tuple/list unpacking target. */
  fromUnpacking: boolean;
}

const SIMPLE_NAME_RE = /^[A-Za-z_]\w*$/;
const TARGET_EXPR_RE = /^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[[^[\]]*\])*$/;

/** Split on top-level separators, ignoring strings and nested brackets. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = endOfStringLiteral(text, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; }
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; }
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(text.slice(start));
  return parts;
}

function endOfStringLiteral(text: string, start: number): number {
  const ch = text[start];
  if (text[start + 1] === ch && text[start + 2] === ch) {
    const delimiter = text.slice(start, start + 3);
    let i = start + 3;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; }
      else if (text.slice(i, i + 3) === delimiter) { return i + 3; }
      else { i++; }
    }
    return text.length;
  }
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; }
    else if (text[i] === ch) { return i + 1; }
    else { i++; }
  }
  return text.length;
}

const AUGMENTED_PREFIX = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '@', '>', '<', '!', '=', ':', '~']);

/** Index of the top-level `=` that starts a plain assignment, or -1. */
export function findAssignmentOperator(text: string): number {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") { i = endOfStringLiteral(text, i); continue; }
    if (ch === '#') { break; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; }
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; }
    else if (ch === '=' && depth === 0) {
      const prev = text[i - 1] ?? '';
      const next = text[i + 1] ?? '';
      if (next !== '=' && !AUGMENTED_PREFIX.has(prev)) { return i; }
    }
    i++;
  }
  return -1;
}

/** Parse the left side of an assignment into targets, or null if it isn't one. */
export function parseTargets(lhs: string): AssignmentTarget[] | null {
  const trimmed = lhs.trim();
  if (trimmed === '') { return null; }

  // Annotated single target: `name: pl.DataFrame`
  const colon = findTopLevelColon(trimmed);
  if (colon >= 0) {
    const name = trimmed.slice(0, colon).trim();
    const annotation = trimmed.slice(colon + 1).trim();
    if (!TARGET_EXPR_RE.test(name)) { return null; }
    return [makeTarget(name, annotation, false)];
  }

  const stripped = stripOuterGrouping(trimmed);
  const parts = splitTopLevel(stripped, ',').map(p => p.trim()).filter(p => p !== '');
  if (parts.length === 0) { return null; }
  const unpacking = parts.length > 1 || stripped !== trimmed;

  const targets: AssignmentTarget[] = [];
  for (const part of parts) {
    const name = part.replace(/^\*+/, '').trim();
    if (name === '_') { continue; }
    if (!TARGET_EXPR_RE.test(name)) { return null; }
    targets.push(makeTarget(name, undefined, unpacking));
  }
  return targets.length > 0 ? targets : null;
}

function stripOuterGrouping(text: string): string {
  const wrapped = (text.startsWith('(') && text.endsWith(')')) ||
    (text.startsWith('[') && text.endsWith(']'));
  if (wrapped) {
    const inner = text.slice(1, -1);
    if (countNetBrackets(inner) === 0) { return inner.trim(); }
  }
  return text;
}

function findTopLevelColon(text: string): number {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") { i = endOfStringLiteral(text, i); continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; }
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; }
    else if (ch === ':' && depth === 0) { return i; }
    i++;
  }
  return -1;
}

function makeTarget(name: string, annotation: string | undefined, fromUnpacking: boolean): AssignmentTarget {
  const normalized = name.replace(/\s+/g, '');
  const tail = /([A-Za-z_]\w*)\s*$/.exec(normalized.replace(/\[[^[\]]*\]$/, ''));
  return {
    name: normalized,
    tailName: tail ? tail[1] : normalized,
    captureExpr: normalized,
    annotation,
    fromUnpacking,
  };
}

// ---------------------------------------------------------------------------
// Scope tracking
// ---------------------------------------------------------------------------

interface Scope {
  /** Indent of the `def` line, -1 for module scope. */
  defIndent: number;
  /** Indent of the body, -1 for module scope. */
  bodyIndent: number;
  vars: Set<string>;
}

const DEF_RE = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/;
const CLASS_RE = /^\s*class\s+\w+/;
const BLOCK_CONTINUATION_RE = /^\s*(else|elif|except|finally|case|@)\b/;
const LOOP_HEADER_RE = /^\s*(?:async\s+)?(?:for|while)\b/;

/**
 * Find the line to attach a logpoint to.
 *
 * A logpoint fires *before* its line runs, so the line has to be one that runs
 * after the assignment, on the same path, while the value is still in scope.
 * Candidates in preference order:
 *   1. the next statement in the same block (fires once, same path);
 *   2. the first statement after the block closed, at or outside the indent
 *      that closed it — the join point of every branch, still in this function;
 *   3. a nested block that may or may not run;
 *   4. a `for`/`while` header in the same block, which re-fires every iteration.
 * Returns -1 when nothing qualifies, e.g. the assignment is the last statement
 * of its function or of the file.
 */
export function resolveLogLine(
  statements: LogicalStatement[],
  index: number,
  defIndent: number,
  requireBodyOf: 'statement' | 'block' = 'statement'
): number {
  const assignment = statements[index];
  const next = statements[index + 1];

  // Loop variables only exist inside the loop body, so the logpoint has to go
  // on the body's first statement to fire on every iteration.
  if (requireBodyOf === 'block') {
    return next && next.indent > assignment.indent ? next.startLine : -1;
  }

  let afterBlock = -1;
  let nested = -1;
  let loopHeader = -1;
  let closingIndent = -1;
  let blockEnded = false;

  for (let i = index + 1; i < statements.length; i++) {
    const candidate = statements[i];
    // Left the enclosing function body entirely — the locals are gone
    if (defIndent >= 0 && candidate.indent <= defIndent) { break; }
    if (!blockEnded && candidate.indent < assignment.indent) {
      blockEnded = true;
      closingIndent = candidate.indent;
    }
    // else/except/finally headers are not reliable logpoint targets
    if (BLOCK_CONTINUATION_RE.test(candidate.lines[0])) { continue; }

    if (blockEnded) {
      // Only the join point counts; a sibling branch body never sees our value
      if (candidate.indent <= closingIndent && afterBlock < 0) {
        afterBlock = candidate.startLine;
      }
      continue;
    }
    if (candidate.indent === assignment.indent) {
      if (!LOOP_HEADER_RE.test(candidate.lines[0])) { return candidate.startLine; }
      if (loopHeader < 0) { loopHeader = candidate.startLine; }
      continue;
    }
    if (nested < 0) { nested = candidate.startLine; }
  }

  if (afterBlock >= 0) { return afterBlock; }
  if (nested >= 0) { return nested; }
  return loopHeader;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

interface DetectionContext {
  config: AnalyzerConfig;
  dfReturningFuncs: Set<string>;
  constructorNames: Set<string>;
  likelyFrameNames: Set<string>;
}

function matchesSuffix(name: string, suffixes: string[]): string | null {
  for (const suffix of suffixes) {
    if (name === suffix || name.endsWith(suffix)) { return suffix; }
  }
  return null;
}

function methodPattern(receivers: string[], methods: string[]): RegExp {
  return new RegExp(
    `(?:${receivers.map(escapeRegex).join('|')})\\s*\\.\\s*(?:${methods.join('|')})\\s*\\(`
  );
}

/**
 * Decide whether an assignment produces a Polars frame.
 * Returns the reason it matched, or null.
 */
export function classifyTarget(
  target: AssignmentTarget,
  rhs: string,
  visibleFrameVars: Set<string>,
  context: DetectionContext
): string | null {
  const { config } = context;

  if (target.annotation && isFrameAnnotation(target.annotation, config)) {
    return `annotated as ${target.annotation.trim()}`;
  }

  const suffix = matchesSuffix(target.tailName, config.dfNameSuffixes);
  if (suffix) {
    return `name ends with "${suffix}"`;
  }

  // Tuple unpacking hides which element is a frame, so require a name or
  // annotation signal rather than guessing from the right-hand side.
  if (target.fromUnpacking) { return null; }

  const alias = escapeRegex(config.polarsAlias);
  const aliasCall = new RegExp(`\\b${alias}\\s*\\.\\s*(${POLARS_CONSTRUCTORS.join('|')})\\s*\\(`);
  const aliasMatch = aliasCall.exec(rhs);
  if (aliasMatch) {
    return `calls ${config.polarsAlias}.${aliasMatch[1]}()`;
  }

  for (const name of context.constructorNames) {
    if (POLARS_CONSTRUCTORS.includes(name) && new RegExp(`\\b${escapeRegex(name)}\\s*\\(`).test(rhs)) {
      return `calls ${name}() imported from polars`;
    }
  }

  const known = [...visibleFrameVars];
  if (known.length > 0) {
    const pattern = methodPattern(known, [...POLARS_ONLY_METHODS, ...GENERIC_FRAME_METHODS]);
    const match = pattern.exec(rhs);
    if (match) {
      return `frame method chained on ${match[0].split('.')[0].trim()}`;
    }
  }

  // Subscript receivers, e.g. libs["raw"].filter(...)
  if (new RegExp(`\\]\\s*\\.\\s*(?:${[...POLARS_ONLY_METHODS, ...GENERIC_FRAME_METHODS].join('|')})\\s*\\(`).test(rhs)) {
    return 'frame method chained on a subscript expression';
  }

  // Any receiver, but only for methods unique to Polars frames
  const polarsOnly = new RegExp(`\\.\\s*(${POLARS_ONLY_METHODS.join('|')})\\s*\\(`);
  const polarsOnlyMatch = polarsOnly.exec(rhs);
  if (polarsOnlyMatch) {
    return `calls .${polarsOnlyMatch[1]}(), which only Polars frames have`;
  }

  for (const fn of context.dfReturningFuncs) {
    if (new RegExp(`\\b${escapeRegex(fn)}\\s*\\(`).test(rhs)) {
      return `calls ${fn}(), annotated as returning a frame`;
    }
  }

  if (context.likelyFrameNames.size > 0) {
    const pattern = methodPattern([...context.likelyFrameNames], POLARS_ONLY_METHODS);
    if (pattern.test(rhs)) {
      return 'frame method chained on a variable assigned elsewhere in the file';
    }
  }

  return null;
}

export interface PrintVarStatement {
  varName: string;
  line: number; // 0-based
}

const PRINT_VAR_RE = /^\s*print\s*\(\s*([A-Za-z_]\w*)\s*\)\s*(?:#.*)?$/;

export function findPrintVarStatements(source: string): PrintVarStatement[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const results: PrintVarStatement[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = PRINT_VAR_RE.exec(lines[i]);
    if (m) { results.push({ varName: m[1], line: i }); }
  }
  return results;
}

const FOR_RE = /^\s*(?:async\s+)?for\s+(.+?)\s+in\s+(.+?):\s*(?:#.*)?$/;

interface ParsedStatement {
  targets: AssignmentTarget[];
  rhs: string;
  kind: 'assignment' | 'for';
}

/** Pull assignment targets and right-hand side out of a logical statement. */
export function parseStatement(text: string): ParsedStatement | null {
  const forMatch = FOR_RE.exec(text);
  if (forMatch) {
    const targets = parseTargets(forMatch[1]);
    if (!targets) { return null; }
    const marked = targets.map(t => ({ ...t, fromUnpacking: true }));
    return { targets: marked, rhs: forMatch[2], kind: 'for' };
  }

  if (/^\s*(?:def|class|if|elif|while|with|return|yield|assert|del|import|from|raise|lambda)\b/.test(text)) {
    return null;
  }

  const operator = findAssignmentOperator(text);
  if (operator < 0) { return null; }

  const targets = parseTargets(text.slice(0, operator));
  if (!targets) { return null; }

  let rhs = text.slice(operator + 1).trim();
  // Chained assignment: a = b = expr
  let guard = 0;
  while (guard++ < 5) {
    const next = findAssignmentOperator(rhs);
    if (next < 0) { break; }
    const more = parseTargets(rhs.slice(0, next));
    if (!more) { break; }
    targets.push(...more);
    rhs = rhs.slice(next + 1).trim();
  }

  return { targets, rhs, kind: 'assignment' };
}

export interface AnalysisCandidate {
  varName: string;
  line: number; // 1-based, for messages
  detected: boolean;
  reason: string;
}

interface AnalysisResult {
  assignments: DataFrameAssignment[];
  candidates: AnalysisCandidate[];
}

/**
 * Parse a Python source string and return all detected frame assignments plus
 * a diagnostic record of every assignment that was considered.
 */
export function analyzeSource(
  source: string,
  config: AnalyzerConfig,
  externalDfReturningFuncs: Set<string> = new Set<string>()
): AnalysisResult {
  const lines = source.replace(/\r/g, '').split('\n');
  const statements = collectStatements(lines);

  const context: DetectionContext = {
    config,
    dfReturningFuncs: new Set([
      ...externalDfReturningFuncs,
      ...findDfReturningFunctions(source, config),
    ]),
    constructorNames: findPolarsImportedNames(source),
    likelyFrameNames: new Set<string>(),
  };

  // Pre-pass: names that look like frames regardless of context. Used only to
  // recognise method chains on variables assigned later in the file.
  for (const name of findAnnotatedFrameVars(source, config)) {
    context.likelyFrameNames.add(name);
  }
  for (const statement of statements) {
    const parsed = parseStatement(statement.text);
    if (!parsed) { continue; }
    for (const target of parsed.targets) {
      if (matchesSuffix(target.tailName, config.dfNameSuffixes)) {
        context.likelyFrameNames.add(target.name);
      }
    }
  }

  const moduleScope: Scope = { defIndent: -1, bodyIndent: -1, vars: new Set<string>() };
  const annotated = findAnnotatedFrameVars(source, config);
  const scopes: Scope[] = [moduleScope];
  const assignments: DataFrameAssignment[] = [];
  const candidates: AnalysisCandidate[] = [];

  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index];

    // Leave scopes whose body we have dedented out of
    while (scopes.length > 1 && statement.indent <= scopes[scopes.length - 1].defIndent) {
      scopes.pop();
    }

    const defMatch = DEF_RE.exec(statement.lines[0]);
    if (defMatch || CLASS_RE.test(statement.lines[0])) {
      const scope: Scope = {
        defIndent: statement.indent,
        bodyIndent: statement.indent + 1,
        vars: new Set<string>(),
      };
      if (defMatch) {
        // Parameters annotated as frames are known frames inside the body
        for (const name of findAnnotatedFrameVars(statement.text, config)) {
          scope.vars.add(name);
        }
      }
      scopes.push(scope);
      continue;
    }

    const parsed = parseStatement(statement.text);
    if (!parsed) { continue; }

    const visible = new Set<string>();
    for (const scope of scopes) {
      for (const name of scope.vars) { visible.add(name); }
    }
    // Frames annotated elsewhere (parameters, attributes) that this statement
    // actually mentions. Captures are looked up defensively at runtime, so a
    // name that turns out not to be in scope is reported, not fatal.
    for (const name of annotated) {
      if (new RegExp(`\\b${escapeRegex(name)}\\b`).test(statement.text)) { visible.add(name); }
    }

    const currentScope = scopes[scopes.length - 1];
    const defIndent = currentScope.defIndent;

    for (const target of parsed.targets) {
      const reason = classifyTarget(target, parsed.rhs, visible, context);
      candidates.push({
        varName: target.name,
        line: statement.startLine + 1,
        detected: reason !== null,
        reason: reason ?? noSignalHint(target, config),
      });
      if (reason === null) { continue; }

      const indent = statement.lines[0].slice(0, statement.lines[0].length - statement.lines[0].trimStart().length);
      const sourceText = statement.lines
        .map(line => (line.startsWith(indent) ? line.slice(indent.length) : line))
        .join('\n');

      const logLine = resolveLogLine(
        statements,
        index,
        defIndent,
        parsed.kind === 'for' ? 'block' : 'statement'
      );
      const inputVars = findInputVars(parsed.rhs, visible).filter(name => name !== target.name);

      assignments.push({
        varName: target.name,
        captureExpr: target.captureExpr,
        sourceText,
        range: { startLine: statement.startLine, endLine: statement.endLine },
        inputVars,
        logLine,
        reason,
        skipReason: logLine < 0
          ? 'no statement follows it inside the same function, so there is no line where the value is in scope'
          : undefined,
      });

      currentScope.vars.add(target.name);
      if (SIMPLE_NAME_RE.test(target.name)) {
        context.likelyFrameNames.add(target.name);
      }
    }
  }

  return { assignments, candidates };
}

function noSignalHint(target: AssignmentTarget, config: AnalyzerConfig): string {
  return `no Polars signal — rename to ${target.tailName}${config.dfNameSuffixes[0] ?? '_df'}, ` +
    `annotate it as ${config.polarsAlias}.DataFrame, or annotate the function it calls`;
}

/** Backwards-compatible wrapper returning only the detected assignments. */
export function analyzeFile(
  source: string,
  config: AnalyzerConfig,
  externalDfReturningFuncs: Set<string> = new Set<string>()
): DataFrameAssignment[] {
  return analyzeSource(source, config, externalDfReturningFuncs).assignments;
}

/**
 * Human-readable detection report: what was logged and why, what was skipped
 * and how to make it detectable. Backs the explainDetection command.
 */
export function formatDetectionReport(
  candidates: AnalysisCandidate[],
  assignments: DataFrameAssignment[]
): string {
  const unplaceable = new Map<string, string>();
  for (const a of assignments) {
    if (a.skipReason) { unplaceable.set(`${a.varName}@${a.range.startLine + 1}`, a.skipReason); }
  }

  const detected = candidates.filter(c => c.detected);
  const missed = candidates.filter(c => !c.detected);
  const lines = [
    `  Detected ${detected.length} frame assignment(s), ` +
    `skipped ${missed.length} other assignment(s).`,
  ];

  for (const c of detected) {
    lines.push(`  \u2713 line ${c.line}: ${c.varName} — ${c.reason}`);
    const skipReason = unplaceable.get(`${c.varName}@${c.line}`);
    if (skipReason) {
      lines.push(`      but no logpoint: ${skipReason}`);
    }
  }
  for (const c of missed) {
    lines.push(`  \u00b7 line ${c.line}: ${c.varName} — ${c.reason}`);
  }
  return lines.join('\n');
}
