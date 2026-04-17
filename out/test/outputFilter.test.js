"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("./runner");
const outputFilter_1 = require("../outputFilter");
const WS = '/workspace/project';
function feed(filter, text) {
    return filter.feed(text);
}
function feedAll(text, wsRoot = WS) {
    const f = new outputFilter_1.TracebackFilter(wsRoot);
    return f.feed(text) + f.flush();
}
// ---------------------------------------------------------------------------
// Plain (non-traceback) output
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — plain output', () => {
    (0, runner_1.test)('single line passes through', () => {
        (0, runner_1.strictEqual)(feedAll('hello world\n'), 'hello world\n');
    });
    (0, runner_1.test)('multiple lines pass through', () => {
        (0, runner_1.strictEqual)(feedAll('line1\nline2\nline3\n'), 'line1\nline2\nline3\n');
    });
    (0, runner_1.test)('empty input returns empty string', () => {
        (0, runner_1.strictEqual)(feedAll(''), '');
    });
    (0, runner_1.test)('incomplete final line flushed correctly', () => {
        const f = new outputFilter_1.TracebackFilter(WS);
        const a = f.feed('line1\npartial');
        const b = f.flush();
        (0, runner_1.strictEqual)(a + b, 'line1\npartial\n');
    });
    (0, runner_1.test)('CRLF line endings normalised', () => {
        (0, runner_1.strictEqual)(feedAll('line1\r\nline2\r\n'), 'line1\nline2\n');
    });
});
// ---------------------------------------------------------------------------
// Traceback — workspace-only frames (all kept)
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — workspace-only traceback', () => {
    const tb = [
        'Traceback (most recent call last):',
        '  File "/workspace/project/script.py", line 10, in main',
        '    result = 1 / 0',
        'ZeroDivisionError: division by zero',
        '',
    ].join('\n');
    (0, runner_1.test)('header preserved', () => (0, runner_1.includes)(feedAll(tb), 'Traceback (most recent call last):'));
    (0, runner_1.test)('workspace File line preserved', () => (0, runner_1.includes)(feedAll(tb), '  File "/workspace/project/script.py"'));
    (0, runner_1.test)('code line preserved', () => (0, runner_1.includes)(feedAll(tb), '    result = 1 / 0'));
    (0, runner_1.test)('exception line preserved', () => (0, runner_1.includes)(feedAll(tb), 'ZeroDivisionError: division by zero'));
    (0, runner_1.test)('no "no project frames" note', () => (0, runner_1.notIncludes)(feedAll(tb), 'no project frames'));
});
// ---------------------------------------------------------------------------
// Traceback — external-only frames (all stripped)
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — external-only traceback', () => {
    const tb = [
        'Traceback (most recent call last):',
        '  File "/usr/lib/python3/site-packages/polars/frame.py", line 500, in filter',
        '    return self._df.filter(expr)',
        'polars.exceptions.InvalidOperationError: bad filter',
        '',
    ].join('\n');
    (0, runner_1.test)('header preserved', () => (0, runner_1.includes)(feedAll(tb), 'Traceback (most recent call last):'));
    (0, runner_1.test)('external File line stripped', () => (0, runner_1.notIncludes)(feedAll(tb), 'site-packages/polars'));
    (0, runner_1.test)('external code line stripped', () => (0, runner_1.notIncludes)(feedAll(tb), 'self._df.filter'));
    (0, runner_1.test)('exception line preserved', () => (0, runner_1.includes)(feedAll(tb), 'polars.exceptions.InvalidOperationError'));
    (0, runner_1.test)('note inserted when no project frames', () => (0, runner_1.includes)(feedAll(tb), 'external package'));
});
// ---------------------------------------------------------------------------
// Traceback — mixed frames (only workspace frames kept)
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — mixed traceback', () => {
    const tb = [
        'Traceback (most recent call last):',
        '  File "/workspace/project/analysis.py", line 15, in run',
        '    df.filter(bad_expr)',
        '  File "/usr/lib/python3/site-packages/polars/frame.py", line 500, in filter',
        '    return self._df.filter(expr)',
        '  File "/usr/lib/python3/site-packages/polars/_utils.py", line 20, in _check',
        '    raise InvalidOperationError(msg)',
        'polars.exceptions.InvalidOperationError: bad filter',
        '',
    ].join('\n');
    const out = feedAll(tb);
    (0, runner_1.test)('header kept', () => (0, runner_1.includes)(out, 'Traceback (most recent call last):'));
    (0, runner_1.test)('workspace frame kept', () => (0, runner_1.includes)(out, '  File "/workspace/project/analysis.py"'));
    (0, runner_1.test)('workspace code line kept', () => (0, runner_1.includes)(out, '    df.filter(bad_expr)'));
    (0, runner_1.test)('polars frame stripped', () => (0, runner_1.notIncludes)(out, 'site-packages/polars'));
    (0, runner_1.test)('polars code line stripped', () => (0, runner_1.notIncludes)(out, 'self._df.filter'));
    (0, runner_1.test)('exception line kept', () => (0, runner_1.includes)(out, 'polars.exceptions.InvalidOperationError'));
    (0, runner_1.test)('no "no project frames" note when at least one frame kept', () => (0, runner_1.notIncludes)(out, 'external package'));
});
// ---------------------------------------------------------------------------
// Traceback — multiple workspace frames
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — multiple workspace frames', () => {
    const tb = [
        'Traceback (most recent call last):',
        '  File "/workspace/project/main.py", line 5, in <module>',
        '    run()',
        '  File "/workspace/project/runner.py", line 12, in run',
        '    process()',
        '  File "/workspace/project/processor.py", line 8, in process',
        '    raise ValueError("oops")',
        'ValueError: oops',
        '',
    ].join('\n');
    const out = feedAll(tb);
    (0, runner_1.test)('all three workspace frames kept', () => {
        (0, runner_1.includes)(out, 'main.py');
        (0, runner_1.includes)(out, 'runner.py');
        (0, runner_1.includes)(out, 'processor.py');
    });
    (0, runner_1.test)('exception line kept', () => (0, runner_1.includes)(out, 'ValueError: oops'));
});
// ---------------------------------------------------------------------------
// Traceback — path-prefix false-positive guard
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — path matching is exact', () => {
    (0, runner_1.test)('sibling folder not mistaken for workspace', () => {
        // wsRoot = /workspace/project — should NOT match /workspace/project_two
        const tb = [
            'Traceback (most recent call last):',
            '  File "/workspace/project_two/other.py", line 1, in f',
            '    pass',
            'RuntimeError: nope',
        ].join('\n');
        (0, runner_1.notIncludes)(feedAll(tb), 'project_two');
    });
    (0, runner_1.test)('exact wsRoot match kept', () => {
        const tb = [
            'Traceback (most recent call last):',
            '  File "/workspace/project/script.py", line 1, in f',
            '    pass',
            'RuntimeError: yes',
        ].join('\n');
        (0, runner_1.includes)(feedAll(tb), 'project/script.py');
    });
});
// ---------------------------------------------------------------------------
// Chained exceptions
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — chained exceptions', () => {
    const chained = [
        'Traceback (most recent call last):',
        '  File "/workspace/project/a.py", line 3, in f',
        '    raise ValueError("original")',
        'ValueError: original',
        '',
        'During handling of the above exception, another exception occurred:',
        '',
        'Traceback (most recent call last):',
        '  File "/workspace/project/b.py", line 7, in g',
        '    raise RuntimeError("wrapped")',
        'RuntimeError: wrapped',
        '',
    ].join('\n');
    const out = feedAll(chained);
    (0, runner_1.test)('first exception line kept', () => (0, runner_1.includes)(out, 'ValueError: original'));
    (0, runner_1.test)('second exception line kept', () => (0, runner_1.includes)(out, 'RuntimeError: wrapped'));
    (0, runner_1.test)('"During handling" line kept', () => (0, runner_1.includes)(out, 'During handling of the above exception'));
    (0, runner_1.test)('both workspace frames kept', () => {
        (0, runner_1.includes)(out, 'a.py');
        (0, runner_1.includes)(out, 'b.py');
    });
});
// ---------------------------------------------------------------------------
// Chunked input (same output regardless of chunk boundaries)
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — chunked input', () => {
    const full = [
        'Traceback (most recent call last):',
        '  File "/workspace/project/script.py", line 5, in main',
        '    result = bad()',
        '  File "/usr/lib/python3.11/builtins.py", line 1, in bad',
        '    pass',
        'NameError: bad not defined',
        '',
    ].join('\n');
    const fullResult = feedAll(full);
    (0, runner_1.test)('single chunk equals multi-chunk output', () => {
        // Feed character by character
        const f = new outputFilter_1.TracebackFilter(WS);
        let out = '';
        for (const ch of full) {
            out += f.feed(ch);
        }
        out += f.flush();
        (0, runner_1.strictEqual)(out, fullResult);
    });
    (0, runner_1.test)('split at newline boundary', () => {
        // split('\n') on a trailing-newline string includes a trailing '' element;
        // skip it to avoid feeding a spurious bare '\n' at the end.
        const parts = full.split('\n');
        if (parts[parts.length - 1] === '') {
            parts.pop();
        }
        const f = new outputFilter_1.TracebackFilter(WS);
        let out = '';
        for (const part of parts) {
            out += f.feed(part + '\n');
        }
        out += f.flush();
        (0, runner_1.strictEqual)(out, fullResult);
    });
});
// ---------------------------------------------------------------------------
// Flush with incomplete traceback at session end
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — flush with open traceback', () => {
    (0, runner_1.test)('partial traceback flushed on session end', () => {
        const f = new outputFilter_1.TracebackFilter(WS);
        f.feed('Traceback (most recent call last):\n');
        f.feed('  File "/workspace/project/x.py", line 1, in f\n');
        f.feed('    boom()\n');
        // Session ends without the exception line
        const out = f.flush();
        (0, runner_1.includes)(out, 'Traceback (most recent call last):');
        (0, runner_1.includes)(out, 'x.py');
    });
});
// ---------------------------------------------------------------------------
// Windows-style paths in traceback
// ---------------------------------------------------------------------------
(0, runner_1.suite)('TracebackFilter — Windows paths', () => {
    (0, runner_1.test)('backslash paths in frames matched correctly', () => {
        const f = new outputFilter_1.TracebackFilter('C:\\Users\\user\\project');
        const tb = [
            'Traceback (most recent call last):',
            '  File "C:\\Users\\user\\project\\script.py", line 1, in main',
            '    pass',
            'RuntimeError: win',
            '',
        ].join('\n');
        const out = f.feed(tb) + f.flush();
        (0, runner_1.includes)(out, 'script.py');
        (0, runner_1.notIncludes)(out, 'external package');
    });
    (0, runner_1.test)('external Windows path stripped', () => {
        const f = new outputFilter_1.TracebackFilter('C:\\Users\\user\\project');
        const tb = [
            'Traceback (most recent call last):',
            '  File "C:\\Python311\\Lib\\site-packages\\polars\\frame.py", line 1, in f',
            '    pass',
            'RuntimeError: pkg',
            '',
        ].join('\n');
        const out = f.feed(tb) + f.flush();
        (0, runner_1.notIncludes)(out, 'site-packages');
        (0, runner_1.includes)(out, 'external package');
    });
});
//# sourceMappingURL=outputFilter.test.js.map