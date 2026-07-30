"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("./runner");
const pythonAnalyzer_1 = require("../pythonAnalyzer");
const config = { polarsAlias: 'pl', dfNameSuffixes: ['_df', 'df', '_data'] };
// ---------------------------------------------------------------------------
// countNetBrackets
// ---------------------------------------------------------------------------
(0, runner_1.suite)('countNetBrackets', () => {
    (0, runner_1.test)('returns 0 for empty string', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)(''), 0));
    (0, runner_1.test)('balanced parens', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('f(a, b)'), 0));
    (0, runner_1.test)('unbalanced open paren', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('f(a, b'), 1));
    (0, runner_1.test)('unbalanced open bracket', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('[1, 2, 3'), 1));
    (0, runner_1.test)('unbalanced open brace', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('{'), 1));
    (0, runner_1.test)('mixed balanced', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('f([a], {b: c})'), 0));
    (0, runner_1.test)('mixed unbalanced', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('f([a, b'), 2));
    (0, runner_1.test)('ignores brackets in single-quoted string', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)("'(unclosed'"), 0));
    (0, runner_1.test)('ignores brackets in double-quoted string', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('"(unclosed"'), 0));
    (0, runner_1.test)('ignores brackets in triple-quoted string', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('"""(unclosed("""'), 0));
    (0, runner_1.test)('comment stops counting', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('a # (opens'), 0));
    (0, runner_1.test)('bracket after comment is ignored', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)('x  # [('), 0));
    (0, runner_1.test)('escaped quote inside string', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.countNetBrackets)("'it\\'s (fine)'"), 0));
});
// ---------------------------------------------------------------------------
// findInputVars
// ---------------------------------------------------------------------------
(0, runner_1.suite)('findInputVars', () => {
    (0, runner_1.test)('finds a known var as whole word', () => {
        const known = new Set(['input_df']);
        (0, runner_1.deepEqual)((0, pythonAnalyzer_1.findInputVars)('input_df.filter(x)', known), ['input_df']);
    });
    (0, runner_1.test)('does not match prefix of a longer name', () => {
        const known = new Set(['df']);
        (0, runner_1.deepEqual)((0, pythonAnalyzer_1.findInputVars)('my_df.filter()', known), []);
    });
    (0, runner_1.test)('does not match suffix of a longer name', () => {
        const known = new Set(['input']);
        (0, runner_1.deepEqual)((0, pythonAnalyzer_1.findInputVars)('input_df.filter()', known), []);
    });
    (0, runner_1.test)('finds multiple known vars', () => {
        const known = new Set(['a_df', 'b_df']);
        const found = (0, pythonAnalyzer_1.findInputVars)('a_df.join(b_df)', known);
        (0, runner_1.ok)(found.includes('a_df'), 'a_df');
        (0, runner_1.ok)(found.includes('b_df'), 'b_df');
    });
    (0, runner_1.test)('empty known set returns empty array', () => {
        (0, runner_1.deepEqual)((0, pythonAnalyzer_1.findInputVars)('result = something()', new Set()), []);
    });
});
// ---------------------------------------------------------------------------
// analyzeFile — detection heuristics
// ---------------------------------------------------------------------------
(0, runner_1.suite)('analyzeFile — name suffix heuristic', () => {
    (0, runner_1.test)('detects _df suffix', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('result_df = something()', config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'result_df');
    });
    (0, runner_1.test)('detects bare "df" suffix', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('df = something()', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('detects _data suffix', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('my_data = something()', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('ignores plain variable with no suffix', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = 42', config);
        (0, runner_1.strictEqual)(r.length, 0);
    });
});
(0, runner_1.suite)('analyzeFile — polars constructor heuristic', () => {
    (0, runner_1.test)('detects pl.DataFrame()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pl.DataFrame()', config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'x');
    });
    (0, runner_1.test)('detects pl.read_csv()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pl.read_csv("f.csv")', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('detects pl.read_parquet()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pl.read_parquet("f.parquet")', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('detects pl.read_json()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pl.read_json("f.json")', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('detects pl.from_pandas()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pl.from_pandas(pdf)', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('detects pl.concat()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pl.concat([a, b])', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('respects custom polarsAlias', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = polars.DataFrame()', { polarsAlias: 'polars', dfNameSuffixes: [] });
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('does not fire for different alias', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pd.DataFrame()', config); // pd ≠ pl
        (0, runner_1.strictEqual)(r.length, 0);
    });
    (0, runner_1.test)('detects pl.scan_csv()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('supra = pl.scan_csv("f.csv")', config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'supra');
    });
    (0, runner_1.test)('detects pl.scan_parquet()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pl.scan_parquet("f.parquet")', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('detects pl.scan_ndjson()', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('x = pl.scan_ndjson("f.ndjson")', config);
        (0, runner_1.strictEqual)(r.length, 1);
    });
    (0, runner_1.test)('collect() on scan_csv var is detected', () => {
        const src = 'supra = pl.scan_csv("f.csv")\ndvar = supra.collect()';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 2);
        (0, runner_1.strictEqual)(r[0].varName, 'supra');
        (0, runner_1.strictEqual)(r[1].varName, 'dvar');
        (0, runner_1.deepEqual)(r[1].inputVars, ['supra']);
    });
});
(0, runner_1.suite)('analyzeFile — method-chain heuristic', () => {
    (0, runner_1.test)('detects filter on known var', () => {
        const src = 'input_df = pl.DataFrame()\nresult = input_df.filter(True)';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 2);
        (0, runner_1.strictEqual)(r[1].varName, 'result');
    });
    (0, runner_1.test)('propagates inputVars correctly', () => {
        const src = 'input_df = pl.DataFrame()\nresult = input_df.select(["a"])';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.deepEqual)(r[1].inputVars, ['input_df']);
    });
    (0, runner_1.test)('chain of three frames', () => {
        const src = [
            'raw_df = pl.read_csv("f.csv")',
            'filtered = raw_df.filter(True)',
            'final = filtered.sort("col")',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 3);
        (0, runner_1.deepEqual)(r[2].inputVars, ['filtered']);
    });
    (0, runner_1.test)('does not fire for method on unknown var', () => {
        const src = 'result = unknown.filter(True)';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 0);
    });
    (0, runner_1.test)('multi-line parenthesized chain on known var is detected', () => {
        const src = [
            'raw_df = pl.read_csv("f.csv")',
            'result = (',
            '    raw_df',
            '    .filter(True)',
            ').collect()',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 2);
        (0, runner_1.strictEqual)(r[1].varName, 'result');
    });
    (0, runner_1.test)('subscript access + DataFrame method is detected', () => {
        const src = 'result = libs["df"].filter(True)';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'result');
    });
    (0, runner_1.test)('multi-line subscript chain is detected', () => {
        const src = 'result = (\n    libs["df"]\n    .filter(True)\n)';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'result');
    });
    (0, runner_1.test)('var from multi-line chain is tracked so downstream collect() is detected', () => {
        const src = [
            'raw_df = pl.read_csv("f.csv")',
            'lazy = (',
            '    raw_df.filter(True)',
            ')',
            'final = lazy.collect()',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 3);
        (0, runner_1.strictEqual)(r[2].varName, 'final');
    });
});
(0, runner_1.suite)('analyzeFile — annotated function return type', () => {
    (0, runner_1.test)('function annotated -> pl.DataFrame is detected', () => {
        const src = [
            'def build_df() -> pl.DataFrame:',
            '    return pl.DataFrame()',
            'result = build_df()',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'result');
    });
    (0, runner_1.test)('function annotated -> pl.LazyFrame is detected', () => {
        const src = [
            'def build_lazy() -> pl.LazyFrame:',
            '    return pl.scan_csv("f.csv")',
            'result = build_lazy()',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'result');
    });
    (0, runner_1.test)('multi-line function signature -> pl.DataFrame is detected', () => {
        const src = [
            'def buildit(',
            '    libs: dict,',
            ') -> pl.DataFrame:',
            '    return pl.DataFrame()',
            'mdiff = buildit(libs)',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'mdiff');
    });
    (0, runner_1.test)('unannotated function call is NOT detected', () => {
        const src = [
            'def some_func(x):',
            '    return x',
            'result = some_func(data)',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 0);
    });
    (0, runner_1.test)('function annotated in another open source is detected', () => {
        const helperSrc = [
            'def build_df() -> pl.DataFrame:',
            '    return pl.DataFrame()',
        ].join('\n');
        const callerSrc = 'result = build_df()';
        const sharedFuncs = (0, pythonAnalyzer_1.findDfReturningFunctions)(helperSrc, config);
        const r = (0, pythonAnalyzer_1.analyzeFile)(callerSrc, config, sharedFuncs);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'result');
    });
    (0, runner_1.test)('local annotations still work when shared functions are provided', () => {
        const src = [
            'def local_df() -> pl.DataFrame:',
            '    return pl.DataFrame()',
            'result = local_df()',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config, new Set(['external_df']));
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'result');
    });
});
(0, runner_1.suite)('analyzeFile — multi-line assignments', () => {
    (0, runner_1.test)('captures full range', () => {
        const src = 'result_df = pl.DataFrame(\n  {"a": [1, 2]}\n)';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].range.startLine, 0);
        (0, runner_1.strictEqual)(r[0].range.endLine, 2);
    });
    (0, runner_1.test)('sourceText strips common indent', () => {
        const src = 'result_df = pl.DataFrame(\n  {"a": [1]}\n)';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.ok)(!r[0].sourceText.startsWith(' '), 'should not start with indent');
    });
});
(0, runner_1.suite)('analyzeFile — edge cases', () => {
    (0, runner_1.test)('skips augmented assignments', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('result_df += something()', config).length, 0);
    });
    (0, runner_1.test)('skips equality comparisons', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('result_df == something()', config).length, 0);
    });
    (0, runner_1.test)('skips comment lines', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('# result_df = pl.DataFrame()', config).length, 0);
    });
    (0, runner_1.test)('handles indented code (e.g. inside if)', () => {
        const src = 'if True:\n    result_df = pl.DataFrame()';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'result_df');
    });
    (0, runner_1.test)('handles empty source', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('', config).length, 0);
    });
});
// ---------------------------------------------------------------------------
// scanLine — multi-line string state
// ---------------------------------------------------------------------------
(0, runner_1.suite)('scanLine', () => {
    (0, runner_1.test)('reports an unterminated triple quote', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.scanLine)('text = """start').openQuote, '"""');
    });
    (0, runner_1.test)('closes a triple quote opened on a previous line', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.scanLine)('end of docstring"""', '"""').openQuote, null);
    });
    (0, runner_1.test)('stays open while the delimiter is absent', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.scanLine)('df = pl.read_csv("x")', "'''").openQuote, "'''");
    });
    (0, runner_1.test)('ignores brackets inside a carried-over string', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.scanLine)('  df = f(', '"""').depth, 0);
    });
});
// ---------------------------------------------------------------------------
// collectStatements
// ---------------------------------------------------------------------------
(0, runner_1.suite)('collectStatements', () => {
    (0, runner_1.test)('joins bracket continuations into one statement', () => {
        const s = (0, pythonAnalyzer_1.collectStatements)(['df = pl.DataFrame({', '  "a": [1],', '})', 'x = 1']);
        (0, runner_1.strictEqual)(s.length, 2);
        (0, runner_1.strictEqual)(s[0].startLine, 0);
        (0, runner_1.strictEqual)(s[0].endLine, 2);
    });
    (0, runner_1.test)('joins backslash continuations', () => {
        const s = (0, pythonAnalyzer_1.collectStatements)(['total_df = a_df \\', '    .join(b_df)', 'y = 2']);
        (0, runner_1.strictEqual)(s.length, 2);
        (0, runner_1.strictEqual)(s[0].endLine, 1);
    });
    (0, runner_1.test)('skips blank and comment lines', () => {
        const s = (0, pythonAnalyzer_1.collectStatements)(['# note', '', 'x = 1']);
        (0, runner_1.strictEqual)(s.length, 1);
        (0, runner_1.strictEqual)(s[0].startLine, 2);
    });
    (0, runner_1.test)('does not treat docstring bodies as statements', () => {
        const s = (0, pythonAnalyzer_1.collectStatements)(['"""', 'df = pl.read_csv("nope")', '"""', 'real_df = pl.read_csv("y")']);
        (0, runner_1.strictEqual)(s.length, 2);
        (0, runner_1.strictEqual)(s[1].startLine, 3);
    });
    (0, runner_1.test)('records indent width', () => {
        const s = (0, pythonAnalyzer_1.collectStatements)(['def f():', '    df = 1']);
        (0, runner_1.strictEqual)(s[1].indent, 4);
    });
});
// ---------------------------------------------------------------------------
// Assignment targets
// ---------------------------------------------------------------------------
(0, runner_1.suite)('parseTargets', () => {
    (0, runner_1.test)('plain name', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.parseTargets)('result_df')?.[0].name, 'result_df'));
    (0, runner_1.test)('annotated name keeps the annotation', () => {
        const t = (0, pythonAnalyzer_1.parseTargets)('frame: pl.LazyFrame');
        (0, runner_1.strictEqual)(t?.[0].name, 'frame');
        (0, runner_1.strictEqual)(t?.[0].annotation, 'pl.LazyFrame');
    });
    (0, runner_1.test)('tuple unpacking yields every target', () => {
        const t = (0, pythonAnalyzer_1.parseTargets)('train_df, test_df');
        (0, runner_1.strictEqual)(t?.length, 2);
        (0, runner_1.ok)(t?.every(x => x.fromUnpacking), 'marked as unpacking');
    });
    (0, runner_1.test)('parenthesised tuple is unwrapped', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.parseTargets)('(a_df, b_df)')?.length, 2);
    });
    (0, runner_1.test)('underscore placeholders are dropped', () => {
        const t = (0, pythonAnalyzer_1.parseTargets)('_, keep_df');
        (0, runner_1.strictEqual)(t?.length, 1);
        (0, runner_1.strictEqual)(t?.[0].name, 'keep_df');
    });
    (0, runner_1.test)('attribute target keeps the full expression and tail name', () => {
        const t = (0, pythonAnalyzer_1.parseTargets)('self.raw_df');
        (0, runner_1.strictEqual)(t?.[0].name, 'self.raw_df');
        (0, runner_1.strictEqual)(t?.[0].tailName, 'raw_df');
        (0, runner_1.strictEqual)(t?.[0].captureExpr, 'self.raw_df');
    });
    (0, runner_1.test)('subscript target is accepted', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.parseTargets)('frames["train"]')?.[0].name, 'frames["train"]');
    });
    (0, runner_1.test)('rejects expressions that are not targets', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.parseTargets)('f(x)'), null);
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.parseTargets)(''), null);
    });
});
(0, runner_1.suite)('findAssignmentOperator', () => {
    (0, runner_1.test)('finds a plain assignment', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.findAssignmentOperator)('a = 1'), 2));
    (0, runner_1.test)('ignores keyword arguments', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.findAssignmentOperator)('f(a=1)'), -1));
    (0, runner_1.test)('ignores equality', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.findAssignmentOperator)('a == b'), -1));
    (0, runner_1.test)('ignores augmented assignment', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.findAssignmentOperator)('a += 1'), -1));
    (0, runner_1.test)('ignores the walrus operator', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.findAssignmentOperator)('(a := 1)'), -1));
    (0, runner_1.test)('ignores = inside strings', () => (0, runner_1.strictEqual)((0, pythonAnalyzer_1.findAssignmentOperator)('f("a=1")'), -1));
    (0, runner_1.test)('finds the operator after an annotation', () => {
        (0, runner_1.ok)((0, pythonAnalyzer_1.findAssignmentOperator)('df: pl.DataFrame = load()') > 0, 'found');
    });
});
// ---------------------------------------------------------------------------
// New detection paths
// ---------------------------------------------------------------------------
(0, runner_1.suite)('analyzeFile — annotated assignments', () => {
    (0, runner_1.test)('detects an annotated LazyFrame assignment', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('frame: pl.LazyFrame = load()\nx = 1', config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'frame');
    });
    (0, runner_1.test)('detects a bare DataFrame annotation', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('frame: DataFrame = load()\nx = 1', config).length, 1);
    });
    (0, runner_1.test)('ignores non-frame annotations', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('count: int = len(rows)\nx = 1', config).length, 0);
    });
    (0, runner_1.test)('ignores pandas annotations', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('frame: pd.DataFrame = load()\nx = 1', config).length, 0);
    });
});
(0, runner_1.suite)('analyzeFile — tuple unpacking', () => {
    (0, runner_1.test)('detects suffixed names on both sides of an unpacking', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('train_df, test_df = split(raw)\nx = 1', config);
        (0, runner_1.deepEqual)(r.map(a => a.varName), ['train_df', 'test_df']);
    });
    (0, runner_1.test)('does not guess for unsuffixed unpacking targets', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('first, second = pl.read_csv("a"), 2\nx = 1', config).length, 0);
    });
    (0, runner_1.test)('detects only the frame half of a mixed unpacking', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('out_df, row_count = build()\nx = 1', config);
        (0, runner_1.deepEqual)(r.map(a => a.varName), ['out_df']);
    });
});
(0, runner_1.suite)('analyzeFile — attribute and subscript targets', () => {
    (0, runner_1.test)('detects an attribute assignment', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('self.raw_df = pl.read_csv("a.csv")\nprint(1)', config);
        (0, runner_1.strictEqual)(r.length, 1);
        (0, runner_1.strictEqual)(r[0].varName, 'self.raw_df');
        (0, runner_1.strictEqual)(r[0].captureExpr, 'self.raw_df');
    });
    (0, runner_1.test)('detects a subscript assignment from a known frame', () => {
        const src = 'base_df = pl.read_csv("a")\nframes["train"] = base_df.filter(x)\ny = 1';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.deepEqual)(r.map(a => a.varName), ['base_df', 'frames["train"]']);
    });
});
(0, runner_1.suite)('analyzeFile — for-loop targets', () => {
    (0, runner_1.test)('detects a frame loop variable and logs inside the body', () => {
        const src = [
            'base_df = pl.read_csv("a")',
            'for key, part_df in base_df.partition_by("g", as_dict=True).items():',
            '    total = part_df.height',
            'print(1)',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        const part = r.find(a => a.varName === 'part_df');
        (0, runner_1.ok)(part, 'part_df detected');
        (0, runner_1.strictEqual)(part?.logLine, 2);
    });
    (0, runner_1.test)('does not log a loop variable with no body statement', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('for part_df in frames: pass', config);
        (0, runner_1.strictEqual)(r.length, 0);
    });
});
(0, runner_1.suite)('analyzeFile — backslash continuations', () => {
    (0, runner_1.test)('joins the statement and finds both inputs', () => {
        const src = [
            'a_df = pl.read_csv("a")',
            'b_df = pl.read_csv("b")',
            'total_df = a_df \\',
            '    .join(b_df, on="k")',
            'print(1)',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        const total = r.find(a => a.varName === 'total_df');
        (0, runner_1.strictEqual)(total?.range.endLine, 3);
        (0, runner_1.deepEqual)(total?.inputVars, ['a_df', 'b_df']);
    });
});
(0, runner_1.suite)('analyzeFile — frame-annotated parameters', () => {
    (0, runner_1.test)('a chain on an annotated parameter is detected', () => {
        const src = [
            'def build(raw: pl.LazyFrame):',
            '    out = raw.filter(pl.col("a") > 1)',
            '    return out',
        ].join('\n');
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.deepEqual)(r.map(a => a.varName), ['out']);
        (0, runner_1.deepEqual)(r[0].inputVars, ['raw']);
    });
    (0, runner_1.test)('an unannotated parameter gives no signal', () => {
        const src = 'def build(raw):\n    out = raw.filter(x)\n    return out';
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config).length, 0);
    });
});
(0, runner_1.suite)('analyzeFile — polars-only methods on any receiver', () => {
    (0, runner_1.test)('detects with_columns on an unknown receiver', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('res = load().with_columns(pl.col("a") * 2)\nx = 1', config);
        (0, runner_1.deepEqual)(r.map(a => a.varName), ['res']);
    });
    (0, runner_1.test)('detects group_by on an attribute receiver', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('res = self.data.group_by("k").agg(x)\ny = 1', config).length, 1);
    });
    (0, runner_1.test)('does not fire for generic filter on an unknown receiver', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('rows = Model.objects.filter(active=True)\nx = 1', config).length, 0);
    });
});
(0, runner_1.suite)('analyzeFile — polars imported directly', () => {
    (0, runner_1.test)('detects a constructor imported by name', () => {
        const src = 'from polars import read_csv\ntable = read_csv("a.csv")\nx = 1';
        (0, runner_1.deepEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config).map(a => a.varName), ['table']);
    });
    (0, runner_1.test)('an unrelated same-named import gives no signal', () => {
        const src = 'from pandas import read_csv\ntable = read_csv("a.csv")\nx = 1';
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config).length, 0);
    });
});
(0, runner_1.suite)('findDfReturningFunctions — annotation forms', () => {
    (0, runner_1.test)('quoted annotation', () => {
        (0, runner_1.ok)((0, pythonAnalyzer_1.findDfReturningFunctions)('def f() -> "pl.DataFrame":\n    pass', config).has('f'));
    });
    (0, runner_1.test)('optional union annotation', () => {
        (0, runner_1.ok)((0, pythonAnalyzer_1.findDfReturningFunctions)('def f() -> pl.DataFrame | None:\n    pass', config).has('f'));
    });
    (0, runner_1.test)('Optional[...] annotation', () => {
        (0, runner_1.ok)((0, pythonAnalyzer_1.findDfReturningFunctions)('def f() -> Optional[pl.LazyFrame]:\n    pass', config).has('f'));
    });
    (0, runner_1.test)('bare frame annotation', () => {
        (0, runner_1.ok)((0, pythonAnalyzer_1.findDfReturningFunctions)('def f() -> LazyFrame:\n    pass', config).has('f'));
    });
    (0, runner_1.test)('pandas return type is not a polars frame', () => {
        (0, runner_1.notOk)((0, pythonAnalyzer_1.findDfReturningFunctions)('def f() -> pd.DataFrame:\n    pass', config).has('f'));
    });
    (0, runner_1.test)('a tuple of frames is not a frame', () => {
        (0, runner_1.notOk)((0, pythonAnalyzer_1.findDfReturningFunctions)('def f() -> tuple[pl.DataFrame, pl.DataFrame]:\n    pass', config).has('f'));
    });
    (0, runner_1.test)('async def is supported', () => {
        (0, runner_1.ok)((0, pythonAnalyzer_1.findDfReturningFunctions)('async def f() -> pl.DataFrame:\n    pass', config).has('f'));
    });
});
// ---------------------------------------------------------------------------
// Logpoint placement
// ---------------------------------------------------------------------------
(0, runner_1.suite)('analyzeFile — logpoint placement', () => {
    (0, runner_1.test)('uses the next statement in the same block', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('a_df = pl.read_csv("a")\nb = 1', config);
        (0, runner_1.strictEqual)(r[0].logLine, 1);
    });
    (0, runner_1.test)('skips blank and comment lines', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('a_df = pl.read_csv("a")\n\n# note\nb = 1', config);
        (0, runner_1.strictEqual)(r[0].logLine, 3);
    });
    (0, runner_1.test)('a last-line assignment cannot be logged', () => {
        const r = (0, pythonAnalyzer_1.analyzeFile)('a_df = pl.read_csv("a")', config);
        (0, runner_1.strictEqual)(r[0].logLine, -1);
        (0, runner_1.ok)(r[0].skipReason, 'explains why');
    });
    (0, runner_1.test)('the last statement of a function cannot be logged', () => {
        const src = 'def f():\n    a_df = pl.read_csv("a")\nprint(1)';
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config)[0].logLine, -1);
    });
    (0, runner_1.test)('never places a logpoint outside the enclosing function', () => {
        const src = 'def f():\n    a_df = pl.read_csv("a")\n\ndef g():\n    pass';
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config)[0].logLine, -1);
    });
    (0, runner_1.test)('falls back to a dedented line inside the same function', () => {
        const src = 'def f():\n    if x:\n        a_df = pl.read_csv("a")\n    return a_df';
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config)[0].logLine, 3);
    });
    (0, runner_1.test)('prefers a same-indent line over a nested one', () => {
        const src = 'a_df = pl.read_csv("a")\nif x:\n    y = 1\nz = 2';
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config)[0].logLine, 1);
    });
    (0, runner_1.test)('skips past an except branch to the line that always runs', () => {
        const src = [
            'try:',
            '    a_df = pl.read_csv("a")',
            'except Exception:',
            '    pass',
            'z = 1',
        ].join('\n');
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config)[0].logLine, 4);
    });
    (0, runner_1.test)('never places a logpoint in a sibling else branch', () => {
        const src = [
            'if cond:',
            '    a_df = pl.read_csv("a")',
            'else:',
            '    other = 1',
            'z = 2',
        ].join('\n');
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config)[0].logLine, 4);
    });
    (0, runner_1.test)('steps over a for header so the block is not logged every iteration', () => {
        const src = [
            'a_df = pl.read_csv("a")',
            'for row in rows:',
            '    use(row)',
            'z = 1',
        ].join('\n');
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config)[0].logLine, 3);
    });
    (0, runner_1.test)('falls back to a while header when nothing else follows', () => {
        const src = [
            'def f():',
            '    a_df = pl.read_csv("a")',
            '    while go:',
            '        pass',
        ].join('\n');
        // The loop body is the only statement left, so it is used rather than
        // dropping the logpoint altogether.
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config)[0].logLine, 3);
    });
});
// ---------------------------------------------------------------------------
// Scope-aware input capture
// ---------------------------------------------------------------------------
(0, runner_1.suite)('analyzeFile — input scope', () => {
    (0, runner_1.test)('module-level frames are inputs inside a function', () => {
        const src = [
            'base_df = pl.read_csv("a")',
            'def f():',
            '    out_df = base_df.filter(x)',
            '    return out_df',
        ].join('\n');
        const out = (0, pythonAnalyzer_1.analyzeFile)(src, config).find(a => a.varName === 'out_df');
        (0, runner_1.deepEqual)(out?.inputVars, ['base_df']);
    });
    (0, runner_1.test)('another function\'s local is not captured as an input', () => {
        const src = [
            'def a():',
            '    left_df = pl.read_csv("l")',
            '    return left_df',
            'def b(x):',
            '    out_df = x.join(left_df)',
            '    return out_df',
        ].join('\n');
        const out = (0, pythonAnalyzer_1.analyzeFile)(src, config).find(a => a.varName === 'out_df');
        (0, runner_1.deepEqual)(out?.inputVars, []);
    });
    (0, runner_1.test)('a frame assigned later in the same scope is not an input', () => {
        const src = [
            'first_df = pl.read_csv("a")',
            'joined_df = first_df.join(later_df)',
            'later_df = pl.read_csv("b")',
            'x = 1',
        ].join('\n');
        const joined = (0, pythonAnalyzer_1.analyzeFile)(src, config).find(a => a.varName === 'joined_df');
        (0, runner_1.deepEqual)(joined?.inputVars, ['first_df']);
    });
    (0, runner_1.test)('a variable never lists itself as an input', () => {
        const src = 'acc_df = pl.read_csv("a")\nacc_df = pl.concat([acc_df])\nx = 1';
        const r = (0, pythonAnalyzer_1.analyzeFile)(src, config);
        (0, runner_1.deepEqual)(r[1].inputVars, []);
    });
});
// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
(0, runner_1.suite)('analyzeSource — detection report', () => {
    (0, runner_1.test)('records the reason a frame matched', () => {
        const { candidates } = (0, pythonAnalyzer_1.analyzeSource)('a_df = pl.read_csv("a")\nx = 1', config);
        const hit = candidates.find(c => c.varName === 'a_df');
        (0, runner_1.strictEqual)(hit?.detected, true);
        (0, runner_1.ok)(hit?.reason.includes('name ends with'), hit?.reason);
    });
    (0, runner_1.test)('explains constructor matches', () => {
        const { candidates } = (0, pythonAnalyzer_1.analyzeSource)('table = pl.scan_parquet("a")\nx = 1', config);
        (0, runner_1.ok)(candidates.find(c => c.varName === 'table')?.reason.includes('pl.scan_parquet()'), 'names the call');
    });
    (0, runner_1.test)('suggests a fix for assignments it skipped', () => {
        const { candidates } = (0, pythonAnalyzer_1.analyzeSource)('rows = len(items)\nx = 1', config);
        const miss = candidates.find(c => c.varName === 'rows');
        (0, runner_1.strictEqual)(miss?.detected, false);
        (0, runner_1.ok)(miss?.reason.includes('rows_df'), miss?.reason);
        (0, runner_1.ok)(miss?.reason.includes('pl.DataFrame'), miss?.reason);
    });
    (0, runner_1.test)('reports the line number of each candidate', () => {
        const { candidates } = (0, pythonAnalyzer_1.analyzeSource)('x = 1\na_df = pl.read_csv("a")\ny = 2', config);
        (0, runner_1.strictEqual)(candidates.find(c => c.varName === 'a_df')?.line, 2);
    });
});
(0, runner_1.suite)('analyzeFile — avoiding other libraries', () => {
    (0, runner_1.test)('typing.cast is not a frame', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('value = typing.cast(int, raw)\nx = 1', config).length, 0);
    });
    (0, runner_1.test)('pandas groupby on an unknown receiver is not a frame', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('agg = pdf.groupby("a").sum()\nx = 1', config).length, 0);
    });
    (0, runner_1.test)('but cast on a known frame is', () => {
        const src = 'base_df = pl.read_csv("a")\ntyped = base_df.cast(pl.Int64)\nx = 1';
        (0, runner_1.deepEqual)((0, pythonAnalyzer_1.analyzeFile)(src, config).map(a => a.varName), ['base_df', 'typed']);
    });
    (0, runner_1.test)('a sqlalchemy-style .sql() call is not a frame', () => {
        (0, runner_1.strictEqual)((0, pythonAnalyzer_1.analyzeFile)('rows = conn.sql("select 1")\nx = 1', config).length, 0);
    });
});
(0, runner_1.suite)('formatDetectionReport', () => {
    const src = [
        'raw_df = pl.read_csv("a.csv")',
        'row_count = len(raw_df)',
        'def f():',
        '    out_df = raw_df.head(3)',
    ].join('\n');
    (0, runner_1.test)('counts detected and skipped assignments', () => {
        const { assignments, candidates } = (0, pythonAnalyzer_1.analyzeSource)(src, config);
        const report = (0, pythonAnalyzer_1.formatDetectionReport)(candidates, assignments);
        (0, runner_1.includes)(report, 'Detected 2 frame assignment(s), skipped 1 other assignment(s).');
    });
    (0, runner_1.test)('lists each detected frame with its reason', () => {
        const { assignments, candidates } = (0, pythonAnalyzer_1.analyzeSource)(src, config);
        const report = (0, pythonAnalyzer_1.formatDetectionReport)(candidates, assignments);
        (0, runner_1.includes)(report, 'line 1: raw_df — name ends with "_df"');
    });
    (0, runner_1.test)('flags a detected frame that could not get a logpoint', () => {
        const { assignments, candidates } = (0, pythonAnalyzer_1.analyzeSource)(src, config);
        const report = (0, pythonAnalyzer_1.formatDetectionReport)(candidates, assignments);
        (0, runner_1.includes)(report, 'line 4: out_df');
        (0, runner_1.includes)(report, 'but no logpoint: no statement follows it inside the same function');
    });
    (0, runner_1.test)('lists skipped assignments with a suggested fix', () => {
        const { assignments, candidates } = (0, pythonAnalyzer_1.analyzeSource)(src, config);
        const report = (0, pythonAnalyzer_1.formatDetectionReport)(candidates, assignments);
        (0, runner_1.includes)(report, 'line 2: row_count — no Polars signal');
    });
});
//# sourceMappingURL=pythonAnalyzer.test.js.map