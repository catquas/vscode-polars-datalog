import { suite, test, strictEqual, includes, notIncludes } from './runner';
import { TracebackFilter } from '../outputFilter';

const WS = '/workspace/project';

function feed(filter: TracebackFilter, text: string): string {
  return filter.feed(text);
}

function feedAll(text: string, wsRoot = WS): string {
  const f = new TracebackFilter(wsRoot);
  return f.feed(text) + f.flush();
}

// ---------------------------------------------------------------------------
// Plain (non-traceback) output
// ---------------------------------------------------------------------------
suite('TracebackFilter — plain output', () => {
  test('single line passes through', () => {
    strictEqual(feedAll('hello world\n'), 'hello world\n');
  });

  test('multiple lines pass through', () => {
    strictEqual(feedAll('line1\nline2\nline3\n'), 'line1\nline2\nline3\n');
  });

  test('empty input returns empty string', () => {
    strictEqual(feedAll(''), '');
  });

  test('incomplete final line flushed correctly', () => {
    const f = new TracebackFilter(WS);
    const a = f.feed('line1\npartial');
    const b = f.flush();
    strictEqual(a + b, 'line1\npartial\n');
  });

  test('CRLF line endings normalised', () => {
    strictEqual(feedAll('line1\r\nline2\r\n'), 'line1\nline2\n');
  });
});

// ---------------------------------------------------------------------------
// Traceback — workspace-only frames (all kept)
// ---------------------------------------------------------------------------
suite('TracebackFilter — workspace-only traceback', () => {
  const tb = [
    'Traceback (most recent call last):',
    '  File "/workspace/project/script.py", line 10, in main',
    '    result = 1 / 0',
    'ZeroDivisionError: division by zero',
    '',
  ].join('\n');

  test('header preserved', () => includes(feedAll(tb), 'Traceback (most recent call last):'));
  test('workspace File line preserved', () => includes(feedAll(tb), '  File "/workspace/project/script.py"'));
  test('code line preserved', () => includes(feedAll(tb), '    result = 1 / 0'));
  test('exception line preserved', () => includes(feedAll(tb), 'ZeroDivisionError: division by zero'));
  test('no "no project frames" note', () => notIncludes(feedAll(tb), 'no project frames'));
});

// ---------------------------------------------------------------------------
// Traceback — external-only frames (all stripped)
// ---------------------------------------------------------------------------
suite('TracebackFilter — external-only traceback', () => {
  const tb = [
    'Traceback (most recent call last):',
    '  File "/usr/lib/python3/site-packages/polars/frame.py", line 500, in filter',
    '    return self._df.filter(expr)',
    'polars.exceptions.InvalidOperationError: bad filter',
    '',
  ].join('\n');

  test('header preserved', () => includes(feedAll(tb), 'Traceback (most recent call last):'));
  test('external File line stripped', () => notIncludes(feedAll(tb), 'site-packages/polars'));
  test('external code line stripped', () => notIncludes(feedAll(tb), 'self._df.filter'));
  test('exception line preserved', () => includes(feedAll(tb), 'polars.exceptions.InvalidOperationError'));
  test('note inserted when no project frames', () => includes(feedAll(tb), 'external package'));
});

// ---------------------------------------------------------------------------
// Traceback — mixed frames (only workspace frames kept)
// ---------------------------------------------------------------------------
suite('TracebackFilter — mixed traceback', () => {
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

  test('header kept', () => includes(out, 'Traceback (most recent call last):'));
  test('workspace frame kept', () => includes(out, '  File "/workspace/project/analysis.py"'));
  test('workspace code line kept', () => includes(out, '    df.filter(bad_expr)'));
  test('polars frame stripped', () => notIncludes(out, 'site-packages/polars'));
  test('polars code line stripped', () => notIncludes(out, 'self._df.filter'));
  test('exception line kept', () => includes(out, 'polars.exceptions.InvalidOperationError'));
  test('no "no project frames" note when at least one frame kept', () => notIncludes(out, 'external package'));
});

// ---------------------------------------------------------------------------
// Traceback — multiple workspace frames
// ---------------------------------------------------------------------------
suite('TracebackFilter — multiple workspace frames', () => {
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

  test('all three workspace frames kept', () => {
    includes(out, 'main.py');
    includes(out, 'runner.py');
    includes(out, 'processor.py');
  });
  test('exception line kept', () => includes(out, 'ValueError: oops'));
});

// ---------------------------------------------------------------------------
// Traceback — path-prefix false-positive guard
// ---------------------------------------------------------------------------
suite('TracebackFilter — path matching is exact', () => {
  test('sibling folder not mistaken for workspace', () => {
    // wsRoot = /workspace/project — should NOT match /workspace/project_two
    const tb = [
      'Traceback (most recent call last):',
      '  File "/workspace/project_two/other.py", line 1, in f',
      '    pass',
      'RuntimeError: nope',
    ].join('\n');
    notIncludes(feedAll(tb), 'project_two');
  });

  test('exact wsRoot match kept', () => {
    const tb = [
      'Traceback (most recent call last):',
      '  File "/workspace/project/script.py", line 1, in f',
      '    pass',
      'RuntimeError: yes',
    ].join('\n');
    includes(feedAll(tb), 'project/script.py');
  });
});

// ---------------------------------------------------------------------------
// Chained exceptions
// ---------------------------------------------------------------------------
suite('TracebackFilter — chained exceptions', () => {
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

  test('first exception line kept', () => includes(out, 'ValueError: original'));
  test('second exception line kept', () => includes(out, 'RuntimeError: wrapped'));
  test('"During handling" line kept', () => includes(out, 'During handling of the above exception'));
  test('both workspace frames kept', () => {
    includes(out, 'a.py');
    includes(out, 'b.py');
  });
});

// ---------------------------------------------------------------------------
// Chunked input (same output regardless of chunk boundaries)
// ---------------------------------------------------------------------------
suite('TracebackFilter — chunked input', () => {
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

  test('single chunk equals multi-chunk output', () => {
    // Feed character by character
    const f = new TracebackFilter(WS);
    let out = '';
    for (const ch of full) { out += f.feed(ch); }
    out += f.flush();
    strictEqual(out, fullResult);
  });

  test('split at newline boundary', () => {
    // split('\n') on a trailing-newline string includes a trailing '' element;
    // skip it to avoid feeding a spurious bare '\n' at the end.
    const parts = full.split('\n');
    if (parts[parts.length - 1] === '') { parts.pop(); }
    const f = new TracebackFilter(WS);
    let out = '';
    for (const part of parts) { out += f.feed(part + '\n'); }
    out += f.flush();
    strictEqual(out, fullResult);
  });
});

// ---------------------------------------------------------------------------
// Flush with incomplete traceback at session end
// ---------------------------------------------------------------------------
suite('TracebackFilter — flush with open traceback', () => {
  test('partial traceback flushed on session end', () => {
    const f = new TracebackFilter(WS);
    f.feed('Traceback (most recent call last):\n');
    f.feed('  File "/workspace/project/x.py", line 1, in f\n');
    f.feed('    boom()\n');
    // Session ends without the exception line
    const out = f.flush();
    includes(out, 'Traceback (most recent call last):');
    includes(out, 'x.py');
  });
});

// ---------------------------------------------------------------------------
// Windows-style paths in traceback
// ---------------------------------------------------------------------------
suite('TracebackFilter — Windows paths', () => {
  test('backslash paths in frames matched correctly', () => {
    const f = new TracebackFilter('C:\\Users\\user\\project');
    const tb = [
      'Traceback (most recent call last):',
      '  File "C:\\Users\\user\\project\\script.py", line 1, in main',
      '    pass',
      'RuntimeError: win',
      '',
    ].join('\n');
    const out = f.feed(tb) + f.flush();
    includes(out, 'script.py');
    notIncludes(out, 'external package');
  });

  test('external Windows path stripped', () => {
    const f = new TracebackFilter('C:\\Users\\user\\project');
    const tb = [
      'Traceback (most recent call last):',
      '  File "C:\\Python311\\Lib\\site-packages\\polars\\frame.py", line 1, in f',
      '    pass',
      'RuntimeError: pkg',
      '',
    ].join('\n');
    const out = f.feed(tb) + f.flush();
    notIncludes(out, 'site-packages');
    includes(out, 'external package');
  });
});
