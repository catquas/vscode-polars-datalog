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
//# sourceMappingURL=pythonAnalyzer.test.js.map