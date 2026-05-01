import { suite, test, strictEqual, deepEqual, ok, notOk } from './runner';
import { countNetBrackets, findInputVars, analyzeFile } from '../pythonAnalyzer';

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
