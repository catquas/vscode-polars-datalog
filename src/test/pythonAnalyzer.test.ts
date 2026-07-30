import { suite, test, strictEqual, deepEqual, includes, ok, notOk } from './runner';
import {
  analyzeFile,
  analyzeSource,
  collectStatements,
  countNetBrackets,
  findAssignmentOperator,
  findDfReturningFunctions,
  findInputVars,
  formatDetectionReport,
  parseTargets,
  scanLine,
} from '../pythonAnalyzer';

const config = { polarsAlias: 'pl', dfNameSuffixes: ['_df', 'df', '_data'] };

// ---------------------------------------------------------------------------
// countNetBrackets
// ---------------------------------------------------------------------------
suite('countNetBrackets', () => {
  test('returns 0 for empty string', () => strictEqual(countNetBrackets(''), 0));
  test('balanced parens', () => strictEqual(countNetBrackets('f(a, b)'), 0));
  test('unbalanced open paren', () => strictEqual(countNetBrackets('f(a, b'), 1));
  test('unbalanced open bracket', () => strictEqual(countNetBrackets('[1, 2, 3'), 1));
  test('unbalanced open brace', () => strictEqual(countNetBrackets('{'), 1));
  test('mixed balanced', () => strictEqual(countNetBrackets('f([a], {b: c})'), 0));
  test('mixed unbalanced', () => strictEqual(countNetBrackets('f([a, b'), 2));
  test('ignores brackets in single-quoted string', () => strictEqual(countNetBrackets("'(unclosed'"), 0));
  test('ignores brackets in double-quoted string', () => strictEqual(countNetBrackets('"(unclosed"'), 0));
  test('ignores brackets in triple-quoted string', () => strictEqual(countNetBrackets('"""(unclosed("""'), 0));
  test('comment stops counting', () => strictEqual(countNetBrackets('a # (opens'), 0));
  test('bracket after comment is ignored', () => strictEqual(countNetBrackets('x  # [('), 0));
  test('escaped quote inside string', () => strictEqual(countNetBrackets("'it\\'s (fine)'"), 0));
});

// ---------------------------------------------------------------------------
// findInputVars
// ---------------------------------------------------------------------------
suite('findInputVars', () => {
  test('finds a known var as whole word', () => {
    const known = new Set(['input_df']);
    deepEqual(findInputVars('input_df.filter(x)', known), ['input_df']);
  });

  test('does not match prefix of a longer name', () => {
    const known = new Set(['df']);
    deepEqual(findInputVars('my_df.filter()', known), []);
  });

  test('does not match suffix of a longer name', () => {
    const known = new Set(['input']);
    deepEqual(findInputVars('input_df.filter()', known), []);
  });

  test('finds multiple known vars', () => {
    const known = new Set(['a_df', 'b_df']);
    const found = findInputVars('a_df.join(b_df)', known);
    ok(found.includes('a_df'), 'a_df');
    ok(found.includes('b_df'), 'b_df');
  });

  test('empty known set returns empty array', () => {
    deepEqual(findInputVars('result = something()', new Set()), []);
  });
});

// ---------------------------------------------------------------------------
// analyzeFile — detection heuristics
// ---------------------------------------------------------------------------
suite('analyzeFile — name suffix heuristic', () => {
  test('detects _df suffix', () => {
    const r = analyzeFile('result_df = something()', config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'result_df');
  });

  test('detects bare "df" suffix', () => {
    const r = analyzeFile('df = something()', config);
    strictEqual(r.length, 1);
  });

  test('detects _data suffix', () => {
    const r = analyzeFile('my_data = something()', config);
    strictEqual(r.length, 1);
  });

  test('ignores plain variable with no suffix', () => {
    const r = analyzeFile('x = 42', config);
    strictEqual(r.length, 0);
  });
});

suite('analyzeFile — polars constructor heuristic', () => {
  test('detects pl.DataFrame()', () => {
    const r = analyzeFile('x = pl.DataFrame()', config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'x');
  });

  test('detects pl.read_csv()', () => {
    const r = analyzeFile('x = pl.read_csv("f.csv")', config);
    strictEqual(r.length, 1);
  });

  test('detects pl.read_parquet()', () => {
    const r = analyzeFile('x = pl.read_parquet("f.parquet")', config);
    strictEqual(r.length, 1);
  });

  test('detects pl.read_json()', () => {
    const r = analyzeFile('x = pl.read_json("f.json")', config);
    strictEqual(r.length, 1);
  });

  test('detects pl.from_pandas()', () => {
    const r = analyzeFile('x = pl.from_pandas(pdf)', config);
    strictEqual(r.length, 1);
  });

  test('detects pl.concat()', () => {
    const r = analyzeFile('x = pl.concat([a, b])', config);
    strictEqual(r.length, 1);
  });

  test('respects custom polarsAlias', () => {
    const r = analyzeFile('x = polars.DataFrame()', { polarsAlias: 'polars', dfNameSuffixes: [] });
    strictEqual(r.length, 1);
  });

  test('does not fire for different alias', () => {
    const r = analyzeFile('x = pd.DataFrame()', config); // pd ≠ pl
    strictEqual(r.length, 0);
  });

  test('detects pl.scan_csv()', () => {
    const r = analyzeFile('supra = pl.scan_csv("f.csv")', config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'supra');
  });

  test('detects pl.scan_parquet()', () => {
    const r = analyzeFile('x = pl.scan_parquet("f.parquet")', config);
    strictEqual(r.length, 1);
  });

  test('detects pl.scan_ndjson()', () => {
    const r = analyzeFile('x = pl.scan_ndjson("f.ndjson")', config);
    strictEqual(r.length, 1);
  });

  test('collect() on scan_csv var is detected', () => {
    const src = 'supra = pl.scan_csv("f.csv")\ndvar = supra.collect()';
    const r = analyzeFile(src, config);
    strictEqual(r.length, 2);
    strictEqual(r[0].varName, 'supra');
    strictEqual(r[1].varName, 'dvar');
    deepEqual(r[1].inputVars, ['supra']);
  });
});

suite('analyzeFile — method-chain heuristic', () => {
  test('detects filter on known var', () => {
    const src = 'input_df = pl.DataFrame()\nresult = input_df.filter(True)';
    const r = analyzeFile(src, config);
    strictEqual(r.length, 2);
    strictEqual(r[1].varName, 'result');
  });

  test('propagates inputVars correctly', () => {
    const src = 'input_df = pl.DataFrame()\nresult = input_df.select(["a"])';
    const r = analyzeFile(src, config);
    deepEqual(r[1].inputVars, ['input_df']);
  });

  test('chain of three frames', () => {
    const src = [
      'raw_df = pl.read_csv("f.csv")',
      'filtered = raw_df.filter(True)',
      'final = filtered.sort("col")',
    ].join('\n');
    const r = analyzeFile(src, config);
    strictEqual(r.length, 3);
    deepEqual(r[2].inputVars, ['filtered']);
  });

  test('does not fire for method on unknown var', () => {
    const src = 'result = unknown.filter(True)';
    const r = analyzeFile(src, config);
    strictEqual(r.length, 0);
  });

  test('multi-line parenthesized chain on known var is detected', () => {
    const src = [
      'raw_df = pl.read_csv("f.csv")',
      'result = (',
      '    raw_df',
      '    .filter(True)',
      ').collect()',
    ].join('\n');
    const r = analyzeFile(src, config);
    strictEqual(r.length, 2);
    strictEqual(r[1].varName, 'result');
  });

  test('subscript access + DataFrame method is detected', () => {
    const src = 'result = libs["df"].filter(True)';
    const r = analyzeFile(src, config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'result');
  });

  test('multi-line subscript chain is detected', () => {
    const src = 'result = (\n    libs["df"]\n    .filter(True)\n)';
    const r = analyzeFile(src, config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'result');
  });

  test('var from multi-line chain is tracked so downstream collect() is detected', () => {
    const src = [
      'raw_df = pl.read_csv("f.csv")',
      'lazy = (',
      '    raw_df.filter(True)',
      ')',
      'final = lazy.collect()',
    ].join('\n');
    const r = analyzeFile(src, config);
    strictEqual(r.length, 3);
    strictEqual(r[2].varName, 'final');
  });
});

suite('analyzeFile — annotated function return type', () => {
  test('function annotated -> pl.DataFrame is detected', () => {
    const src = [
      'def build_df() -> pl.DataFrame:',
      '    return pl.DataFrame()',
      'result = build_df()',
    ].join('\n');
    const r = analyzeFile(src, config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'result');
  });

  test('function annotated -> pl.LazyFrame is detected', () => {
    const src = [
      'def build_lazy() -> pl.LazyFrame:',
      '    return pl.scan_csv("f.csv")',
      'result = build_lazy()',
    ].join('\n');
    const r = analyzeFile(src, config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'result');
  });

  test('multi-line function signature -> pl.DataFrame is detected', () => {
    const src = [
      'def buildit(',
      '    libs: dict,',
      ') -> pl.DataFrame:',
      '    return pl.DataFrame()',
      'mdiff = buildit(libs)',
    ].join('\n');
    const r = analyzeFile(src, config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'mdiff');
  });

  test('unannotated function call is NOT detected', () => {
    const src = [
      'def some_func(x):',
      '    return x',
      'result = some_func(data)',
    ].join('\n');
    const r = analyzeFile(src, config);
    strictEqual(r.length, 0);
  });

  test('function annotated in another open source is detected', () => {
    const helperSrc = [
      'def build_df() -> pl.DataFrame:',
      '    return pl.DataFrame()',
    ].join('\n');
    const callerSrc = 'result = build_df()';
    const sharedFuncs = findDfReturningFunctions(helperSrc, config);
    const r = analyzeFile(callerSrc, config, sharedFuncs);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'result');
  });

  test('local annotations still work when shared functions are provided', () => {
    const src = [
      'def local_df() -> pl.DataFrame:',
      '    return pl.DataFrame()',
      'result = local_df()',
    ].join('\n');
    const r = analyzeFile(src, config, new Set(['external_df']));
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'result');
  });
});

suite('analyzeFile — multi-line assignments', () => {
  test('captures full range', () => {
    const src = 'result_df = pl.DataFrame(\n  {"a": [1, 2]}\n)';
    const r = analyzeFile(src, config);
    strictEqual(r.length, 1);
    strictEqual(r[0].range.startLine, 0);
    strictEqual(r[0].range.endLine, 2);
  });

  test('sourceText strips common indent', () => {
    const src = 'result_df = pl.DataFrame(\n  {"a": [1]}\n)';
    const r = analyzeFile(src, config);
    ok(!r[0].sourceText.startsWith(' '), 'should not start with indent');
  });
});

suite('analyzeFile — edge cases', () => {
  test('skips augmented assignments', () => {
    strictEqual(analyzeFile('result_df += something()', config).length, 0);
  });

  test('skips equality comparisons', () => {
    strictEqual(analyzeFile('result_df == something()', config).length, 0);
  });

  test('skips comment lines', () => {
    strictEqual(analyzeFile('# result_df = pl.DataFrame()', config).length, 0);
  });

  test('handles indented code (e.g. inside if)', () => {
    const src = 'if True:\n    result_df = pl.DataFrame()';
    const r = analyzeFile(src, config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'result_df');
  });

  test('handles empty source', () => {
    strictEqual(analyzeFile('', config).length, 0);
  });
});

// ---------------------------------------------------------------------------
// scanLine — multi-line string state
// ---------------------------------------------------------------------------
suite('scanLine', () => {
  test('reports an unterminated triple quote', () => {
    strictEqual(scanLine('text = """start').openQuote, '"""');
  });

  test('closes a triple quote opened on a previous line', () => {
    strictEqual(scanLine('end of docstring"""', '"""').openQuote, null);
  });

  test('stays open while the delimiter is absent', () => {
    strictEqual(scanLine('df = pl.read_csv("x")', "'''").openQuote, "'''");
  });

  test('ignores brackets inside a carried-over string', () => {
    strictEqual(scanLine('  df = f(', '"""').depth, 0);
  });
});

// ---------------------------------------------------------------------------
// collectStatements
// ---------------------------------------------------------------------------
suite('collectStatements', () => {
  test('joins bracket continuations into one statement', () => {
    const s = collectStatements(['df = pl.DataFrame({', '  "a": [1],', '})', 'x = 1']);
    strictEqual(s.length, 2);
    strictEqual(s[0].startLine, 0);
    strictEqual(s[0].endLine, 2);
  });

  test('joins backslash continuations', () => {
    const s = collectStatements(['total_df = a_df \\', '    .join(b_df)', 'y = 2']);
    strictEqual(s.length, 2);
    strictEqual(s[0].endLine, 1);
  });

  test('skips blank and comment lines', () => {
    const s = collectStatements(['# note', '', 'x = 1']);
    strictEqual(s.length, 1);
    strictEqual(s[0].startLine, 2);
  });

  test('does not treat docstring bodies as statements', () => {
    const s = collectStatements(['"""', 'df = pl.read_csv("nope")', '"""', 'real_df = pl.read_csv("y")']);
    strictEqual(s.length, 2);
    strictEqual(s[1].startLine, 3);
  });

  test('records indent width', () => {
    const s = collectStatements(['def f():', '    df = 1']);
    strictEqual(s[1].indent, 4);
  });
});

// ---------------------------------------------------------------------------
// Assignment targets
// ---------------------------------------------------------------------------
suite('parseTargets', () => {
  test('plain name', () => strictEqual(parseTargets('result_df')?.[0].name, 'result_df'));

  test('annotated name keeps the annotation', () => {
    const t = parseTargets('frame: pl.LazyFrame');
    strictEqual(t?.[0].name, 'frame');
    strictEqual(t?.[0].annotation, 'pl.LazyFrame');
  });

  test('tuple unpacking yields every target', () => {
    const t = parseTargets('train_df, test_df');
    strictEqual(t?.length, 2);
    ok(t?.every(x => x.fromUnpacking), 'marked as unpacking');
  });

  test('parenthesised tuple is unwrapped', () => {
    strictEqual(parseTargets('(a_df, b_df)')?.length, 2);
  });

  test('underscore placeholders are dropped', () => {
    const t = parseTargets('_, keep_df');
    strictEqual(t?.length, 1);
    strictEqual(t?.[0].name, 'keep_df');
  });

  test('attribute target keeps the full expression and tail name', () => {
    const t = parseTargets('self.raw_df');
    strictEqual(t?.[0].name, 'self.raw_df');
    strictEqual(t?.[0].tailName, 'raw_df');
    strictEqual(t?.[0].captureExpr, 'self.raw_df');
  });

  test('subscript target is accepted', () => {
    strictEqual(parseTargets('frames["train"]')?.[0].name, 'frames["train"]');
  });

  test('rejects expressions that are not targets', () => {
    strictEqual(parseTargets('f(x)'), null);
    strictEqual(parseTargets(''), null);
  });
});

suite('findAssignmentOperator', () => {
  test('finds a plain assignment', () => strictEqual(findAssignmentOperator('a = 1'), 2));
  test('ignores keyword arguments', () => strictEqual(findAssignmentOperator('f(a=1)'), -1));
  test('ignores equality', () => strictEqual(findAssignmentOperator('a == b'), -1));
  test('ignores augmented assignment', () => strictEqual(findAssignmentOperator('a += 1'), -1));
  test('ignores the walrus operator', () => strictEqual(findAssignmentOperator('(a := 1)'), -1));
  test('ignores = inside strings', () => strictEqual(findAssignmentOperator('f("a=1")'), -1));
  test('finds the operator after an annotation', () => {
    ok(findAssignmentOperator('df: pl.DataFrame = load()') > 0, 'found');
  });
});

// ---------------------------------------------------------------------------
// New detection paths
// ---------------------------------------------------------------------------
suite('analyzeFile — annotated assignments', () => {
  test('detects an annotated LazyFrame assignment', () => {
    const r = analyzeFile('frame: pl.LazyFrame = load()\nx = 1', config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'frame');
  });

  test('detects a bare DataFrame annotation', () => {
    strictEqual(analyzeFile('frame: DataFrame = load()\nx = 1', config).length, 1);
  });

  test('ignores non-frame annotations', () => {
    strictEqual(analyzeFile('count: int = len(rows)\nx = 1', config).length, 0);
  });

  test('ignores pandas annotations', () => {
    strictEqual(analyzeFile('frame: pd.DataFrame = load()\nx = 1', config).length, 0);
  });
});

suite('analyzeFile — tuple unpacking', () => {
  test('detects suffixed names on both sides of an unpacking', () => {
    const r = analyzeFile('train_df, test_df = split(raw)\nx = 1', config);
    deepEqual(r.map(a => a.varName), ['train_df', 'test_df']);
  });

  test('does not guess for unsuffixed unpacking targets', () => {
    strictEqual(analyzeFile('first, second = pl.read_csv("a"), 2\nx = 1', config).length, 0);
  });

  test('detects only the frame half of a mixed unpacking', () => {
    const r = analyzeFile('out_df, row_count = build()\nx = 1', config);
    deepEqual(r.map(a => a.varName), ['out_df']);
  });
});

suite('analyzeFile — attribute and subscript targets', () => {
  test('detects an attribute assignment', () => {
    const r = analyzeFile('self.raw_df = pl.read_csv("a.csv")\nprint(1)', config);
    strictEqual(r.length, 1);
    strictEqual(r[0].varName, 'self.raw_df');
    strictEqual(r[0].captureExpr, 'self.raw_df');
  });

  test('detects a subscript assignment from a known frame', () => {
    const src = 'base_df = pl.read_csv("a")\nframes["train"] = base_df.filter(x)\ny = 1';
    const r = analyzeFile(src, config);
    deepEqual(r.map(a => a.varName), ['base_df', 'frames["train"]']);
  });
});

suite('analyzeFile — for-loop targets', () => {
  test('detects a frame loop variable and logs inside the body', () => {
    const src = [
      'base_df = pl.read_csv("a")',
      'for key, part_df in base_df.partition_by("g", as_dict=True).items():',
      '    total = part_df.height',
      'print(1)',
    ].join('\n');
    const r = analyzeFile(src, config);
    const part = r.find(a => a.varName === 'part_df');
    ok(part, 'part_df detected');
    strictEqual(part?.logLine, 2);
  });

  test('does not log a loop variable with no body statement', () => {
    const r = analyzeFile('for part_df in frames: pass', config);
    strictEqual(r.length, 0);
  });
});

suite('analyzeFile — backslash continuations', () => {
  test('joins the statement and finds both inputs', () => {
    const src = [
      'a_df = pl.read_csv("a")',
      'b_df = pl.read_csv("b")',
      'total_df = a_df \\',
      '    .join(b_df, on="k")',
      'print(1)',
    ].join('\n');
    const r = analyzeFile(src, config);
    const total = r.find(a => a.varName === 'total_df');
    strictEqual(total?.range.endLine, 3);
    deepEqual(total?.inputVars, ['a_df', 'b_df']);
  });
});

suite('analyzeFile — frame-annotated parameters', () => {
  test('a chain on an annotated parameter is detected', () => {
    const src = [
      'def build(raw: pl.LazyFrame):',
      '    out = raw.filter(pl.col("a") > 1)',
      '    return out',
    ].join('\n');
    const r = analyzeFile(src, config);
    deepEqual(r.map(a => a.varName), ['out']);
    deepEqual(r[0].inputVars, ['raw']);
  });

  test('an unannotated parameter gives no signal', () => {
    const src = 'def build(raw):\n    out = raw.filter(x)\n    return out';
    strictEqual(analyzeFile(src, config).length, 0);
  });
});

suite('analyzeFile — polars-only methods on any receiver', () => {
  test('detects with_columns on an unknown receiver', () => {
    const r = analyzeFile('res = load().with_columns(pl.col("a") * 2)\nx = 1', config);
    deepEqual(r.map(a => a.varName), ['res']);
  });

  test('detects group_by on an attribute receiver', () => {
    strictEqual(analyzeFile('res = self.data.group_by("k").agg(x)\ny = 1', config).length, 1);
  });

  test('does not fire for generic filter on an unknown receiver', () => {
    strictEqual(analyzeFile('rows = Model.objects.filter(active=True)\nx = 1', config).length, 0);
  });
});

suite('analyzeFile — polars imported directly', () => {
  test('detects a constructor imported by name', () => {
    const src = 'from polars import read_csv\ntable = read_csv("a.csv")\nx = 1';
    deepEqual(analyzeFile(src, config).map(a => a.varName), ['table']);
  });

  test('an unrelated same-named import gives no signal', () => {
    const src = 'from pandas import read_csv\ntable = read_csv("a.csv")\nx = 1';
    strictEqual(analyzeFile(src, config).length, 0);
  });
});

suite('findDfReturningFunctions — annotation forms', () => {
  test('quoted annotation', () => {
    ok(findDfReturningFunctions('def f() -> "pl.DataFrame":\n    pass', config).has('f'));
  });

  test('optional union annotation', () => {
    ok(findDfReturningFunctions('def f() -> pl.DataFrame | None:\n    pass', config).has('f'));
  });

  test('Optional[...] annotation', () => {
    ok(findDfReturningFunctions('def f() -> Optional[pl.LazyFrame]:\n    pass', config).has('f'));
  });

  test('bare frame annotation', () => {
    ok(findDfReturningFunctions('def f() -> LazyFrame:\n    pass', config).has('f'));
  });

  test('pandas return type is not a polars frame', () => {
    notOk(findDfReturningFunctions('def f() -> pd.DataFrame:\n    pass', config).has('f'));
  });

  test('a tuple of frames is not a frame', () => {
    notOk(findDfReturningFunctions('def f() -> tuple[pl.DataFrame, pl.DataFrame]:\n    pass', config).has('f'));
  });

  test('async def is supported', () => {
    ok(findDfReturningFunctions('async def f() -> pl.DataFrame:\n    pass', config).has('f'));
  });
});

// ---------------------------------------------------------------------------
// Logpoint placement
// ---------------------------------------------------------------------------
suite('analyzeFile — logpoint placement', () => {
  test('uses the next statement in the same block', () => {
    const r = analyzeFile('a_df = pl.read_csv("a")\nb = 1', config);
    strictEqual(r[0].logLine, 1);
  });

  test('skips blank and comment lines', () => {
    const r = analyzeFile('a_df = pl.read_csv("a")\n\n# note\nb = 1', config);
    strictEqual(r[0].logLine, 3);
  });

  test('a last-line assignment cannot be logged', () => {
    const r = analyzeFile('a_df = pl.read_csv("a")', config);
    strictEqual(r[0].logLine, -1);
    ok(r[0].skipReason, 'explains why');
  });

  test('the last statement of a function cannot be logged', () => {
    const src = 'def f():\n    a_df = pl.read_csv("a")\nprint(1)';
    strictEqual(analyzeFile(src, config)[0].logLine, -1);
  });

  test('never places a logpoint outside the enclosing function', () => {
    const src = 'def f():\n    a_df = pl.read_csv("a")\n\ndef g():\n    pass';
    strictEqual(analyzeFile(src, config)[0].logLine, -1);
  });

  test('falls back to a dedented line inside the same function', () => {
    const src = 'def f():\n    if x:\n        a_df = pl.read_csv("a")\n    return a_df';
    strictEqual(analyzeFile(src, config)[0].logLine, 3);
  });

  test('prefers a same-indent line over a nested one', () => {
    const src = 'a_df = pl.read_csv("a")\nif x:\n    y = 1\nz = 2';
    strictEqual(analyzeFile(src, config)[0].logLine, 1);
  });

  test('skips past an except branch to the line that always runs', () => {
    const src = [
      'try:',
      '    a_df = pl.read_csv("a")',
      'except Exception:',
      '    pass',
      'z = 1',
    ].join('\n');
    strictEqual(analyzeFile(src, config)[0].logLine, 4);
  });

  test('never places a logpoint in a sibling else branch', () => {
    const src = [
      'if cond:',
      '    a_df = pl.read_csv("a")',
      'else:',
      '    other = 1',
      'z = 2',
    ].join('\n');
    strictEqual(analyzeFile(src, config)[0].logLine, 4);
  });

  test('steps over a for header so the block is not logged every iteration', () => {
    const src = [
      'a_df = pl.read_csv("a")',
      'for row in rows:',
      '    use(row)',
      'z = 1',
    ].join('\n');
    strictEqual(analyzeFile(src, config)[0].logLine, 3);
  });

  test('falls back to a while header when nothing else follows', () => {
    const src = [
      'def f():',
      '    a_df = pl.read_csv("a")',
      '    while go:',
      '        pass',
    ].join('\n');
    // The loop body is the only statement left, so it is used rather than
    // dropping the logpoint altogether.
    strictEqual(analyzeFile(src, config)[0].logLine, 3);
  });
});

// ---------------------------------------------------------------------------
// Scope-aware input capture
// ---------------------------------------------------------------------------
suite('analyzeFile — input scope', () => {
  test('module-level frames are inputs inside a function', () => {
    const src = [
      'base_df = pl.read_csv("a")',
      'def f():',
      '    out_df = base_df.filter(x)',
      '    return out_df',
    ].join('\n');
    const out = analyzeFile(src, config).find(a => a.varName === 'out_df');
    deepEqual(out?.inputVars, ['base_df']);
  });

  test('another function\'s local is not captured as an input', () => {
    const src = [
      'def a():',
      '    left_df = pl.read_csv("l")',
      '    return left_df',
      'def b(x):',
      '    out_df = x.join(left_df)',
      '    return out_df',
    ].join('\n');
    const out = analyzeFile(src, config).find(a => a.varName === 'out_df');
    deepEqual(out?.inputVars, []);
  });

  test('a frame assigned later in the same scope is not an input', () => {
    const src = [
      'first_df = pl.read_csv("a")',
      'joined_df = first_df.join(later_df)',
      'later_df = pl.read_csv("b")',
      'x = 1',
    ].join('\n');
    const joined = analyzeFile(src, config).find(a => a.varName === 'joined_df');
    deepEqual(joined?.inputVars, ['first_df']);
  });

  test('a variable never lists itself as an input', () => {
    const src = 'acc_df = pl.read_csv("a")\nacc_df = pl.concat([acc_df])\nx = 1';
    const r = analyzeFile(src, config);
    deepEqual(r[1].inputVars, []);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
suite('analyzeSource — detection report', () => {
  test('records the reason a frame matched', () => {
    const { candidates } = analyzeSource('a_df = pl.read_csv("a")\nx = 1', config);
    const hit = candidates.find(c => c.varName === 'a_df');
    strictEqual(hit?.detected, true);
    ok(hit?.reason.includes('name ends with'), hit?.reason);
  });

  test('explains constructor matches', () => {
    const { candidates } = analyzeSource('table = pl.scan_parquet("a")\nx = 1', config);
    ok(candidates.find(c => c.varName === 'table')?.reason.includes('pl.scan_parquet()'), 'names the call');
  });

  test('suggests a fix for assignments it skipped', () => {
    const { candidates } = analyzeSource('rows = len(items)\nx = 1', config);
    const miss = candidates.find(c => c.varName === 'rows');
    strictEqual(miss?.detected, false);
    ok(miss?.reason.includes('rows_df'), miss?.reason);
    ok(miss?.reason.includes('pl.DataFrame'), miss?.reason);
  });

  test('reports the line number of each candidate', () => {
    const { candidates } = analyzeSource('x = 1\na_df = pl.read_csv("a")\ny = 2', config);
    strictEqual(candidates.find(c => c.varName === 'a_df')?.line, 2);
  });
});

suite('analyzeFile — avoiding other libraries', () => {
  test('typing.cast is not a frame', () => {
    strictEqual(analyzeFile('value = typing.cast(int, raw)\nx = 1', config).length, 0);
  });

  test('pandas groupby on an unknown receiver is not a frame', () => {
    strictEqual(analyzeFile('agg = pdf.groupby("a").sum()\nx = 1', config).length, 0);
  });

  test('but cast on a known frame is', () => {
    const src = 'base_df = pl.read_csv("a")\ntyped = base_df.cast(pl.Int64)\nx = 1';
    deepEqual(analyzeFile(src, config).map(a => a.varName), ['base_df', 'typed']);
  });

  test('a sqlalchemy-style .sql() call is not a frame', () => {
    strictEqual(analyzeFile('rows = conn.sql("select 1")\nx = 1', config).length, 0);
  });
});

suite('formatDetectionReport', () => {
  const src = [
    'raw_df = pl.read_csv("a.csv")',
    'row_count = len(raw_df)',
    'def f():',
    '    out_df = raw_df.head(3)',
  ].join('\n');

  test('counts detected and skipped assignments', () => {
    const { assignments, candidates } = analyzeSource(src, config);
    const report = formatDetectionReport(candidates, assignments);
    includes(report, 'Detected 2 frame assignment(s), skipped 1 other assignment(s).');
  });

  test('lists each detected frame with its reason', () => {
    const { assignments, candidates } = analyzeSource(src, config);
    const report = formatDetectionReport(candidates, assignments);
    includes(report, 'line 1: raw_df — name ends with "_df"');
  });

  test('flags a detected frame that could not get a logpoint', () => {
    const { assignments, candidates } = analyzeSource(src, config);
    const report = formatDetectionReport(candidates, assignments);
    includes(report, 'line 4: out_df');
    includes(report, 'but no logpoint: no statement follows it inside the same function');
  });

  test('lists skipped assignments with a suggested fix', () => {
    const { assignments, candidates } = analyzeSource(src, config);
    const report = formatDetectionReport(candidates, assignments);
    includes(report, 'line 2: row_count — no Polars signal');
  });
});
