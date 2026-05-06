import { suite, test, ok, includes, notIncludes, strictEqual } from './runner';
import { buildLogMessage, buildPrintVarLogMessage, ExportConfig } from '../sasFormatter';
import { DataFrameAssignment } from '../pythonAnalyzer';

const base: DataFrameAssignment = {
  varName: 'result_df',
  sourceText: 'result_df = input_df.filter(pl.col("age") > 25)',
  range: { startLine: 1, endLine: 1 },
  inputVars: ['input_df'],
};

const noExport: ExportConfig = {
  exportSamples: false,
  sampleRows: 1000,
  outputFolderAbsPath: '',
  logFileAbsPath: '',
  logTimestampLines: false,
};

const withCsv: ExportConfig = {
  exportSamples: true,
  sampleRows: 1000,
  outputFolderAbsPath: '/workspace/worklib',
  logFileAbsPath: '',
  logTimestampLines: false,
};

const withCsvAndLog: ExportConfig = {
  exportSamples: true,
  sampleRows: 500,
  outputFolderAbsPath: '/workspace/worklib',
  logFileAbsPath: '/workspace/plog.log',
  logTimestampLines: true,
};

const withLogNoTimestamp: ExportConfig = {
  exportSamples: false,
  sampleRows: 1000,
  outputFolderAbsPath: '',
  logFileAbsPath: '/workspace/plog.log',
  logTimestampLines: false,
};

const logOnly: ExportConfig = {
  exportSamples: false,
  sampleRows: 1000,
  outputFolderAbsPath: '',
  logFileAbsPath: '/workspace/plog.log',
  logTimestampLines: true,
};

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

suite('buildLogMessage - structure', () => {
  test('is one VS Code logpoint expression', () => {
    const msg = buildLogMessage(base);
    ok(msg.startsWith('{(lambda '), 'outer lambda');
    ok(msg.endsWith('}'), 'outer close');
  });

  test('has only one top-level logpoint brace pair', () => {
    const msg = buildLogMessage(base);
    strictEqual(count(msg, /{/g), 1);
    strictEqual(count(msg, /}/g), 1);
  });

  test('header followed by escaped newline into source text', () => {
    includes(buildLogMessage(base), "'\\n===DATALOG===\\nresult_df = input_df.filter");
  });

  test('source text appears directly (no Code: prefix)', () => {
    includes(buildLogMessage(base), 'result_df = input_df.filter');
  });

  test('includes New dataframe and New lazyframe in conditional', () => {
    const msg = buildLogMessage(base);
    includes(msg, 'New dataframe');
    includes(msg, 'New lazyframe');
  });

  test('outer lambda captures output var as _out', () => {
    includes(buildLogMessage(base), '_out=result_df');
  });

  test('includes getattr shape expression for output var', () => {
    includes(buildLogMessage(base), "getattr(_out, 'shape'");
  });
});

suite('buildLogMessage - input vars', () => {
  test('outer lambda captures input var as _in0', () => {
    includes(buildLogMessage(base), '_in0=input_df');
  });

  test('includes getattr shape expression for each input var', () => {
    const msg = buildLogMessage(base);
    includes(msg, "getattr(_in0, 'shape'");
    includes(msg, 'input_df');
  });

  test('input var label uses dataframe/lazyframe conditional', () => {
    const msg = buildLogMessage(base);
    includes(msg, 'Input dataframe');
    includes(msg, 'Input lazyframe');
  });

  test('no _in0 capture when inputVars is empty', () => {
    const a = { ...base, sourceText: 'result_df = pl.DataFrame()', inputVars: [] };
    notIncludes(buildLogMessage(a), '_in0=');
  });
});

suite('buildLogMessage - brace encoding', () => {
  test('curly braces in source code are encoded as chr() expressions', () => {
    const a = { ...base, sourceText: 'df = pl.DataFrame({"a": [1]})' };
    const msg = buildLogMessage(a);
    includes(msg, 'chr(123)');
    includes(msg, 'chr(125)');
  });

  test('source braces do not add logpoint expression delimiters', () => {
    const a = { ...base, sourceText: 'df = fn({"key": "val"})' };
    const msg = buildLogMessage(a);
    strictEqual(count(msg, /{/g), 1);
    strictEqual(count(msg, /}/g), 1);
    includes(msg, '"key"');
  });
});

suite('buildLogMessage - no exportConfig', () => {
  test('no write_csv call', () => notIncludes(buildLogMessage(base), 'write_csv'));
  test('no open() call', () => notIncludes(buildLogMessage(base), 'open('));
});

suite('buildLogMessage - both disabled', () => {
  test('no write_csv', () => notIncludes(buildLogMessage(base, noExport), 'write_csv'));
  test('no open()', () => notIncludes(buildLogMessage(base, noExport), 'open('));
});

suite('buildLogMessage - CSV export only', () => {
  test('contains write_csv', () => includes(buildLogMessage(base, withCsv), 'write_csv'));
  test('uses correct row count via _out', () => includes(buildLogMessage(base, withCsv), '_out.head(1000)'));
  test('contains output folder path', () => includes(buildLogMessage(base, withCsv), '/workspace/worklib'));
  test('CSV filename is varName.csv', () => includes(buildLogMessage(base, withCsv), "'result_df.csv'"));
  test('has LazyFrame guard on _out', () => includes(buildLogMessage(base, withCsv), "hasattr(_out, 'write_csv')"));
  test('LazyFrame guard skips CSV write side effect', () => includes(buildLogMessage(base, withCsv), 'else 0'));
  test('no open() for log', () => notIncludes(buildLogMessage(base, withCsv), "open('/workspace/plog.log'"));
  test('mkdir call present', () => includes(buildLogMessage(base, withCsv), 'mkdir'));
  test('returns the DATALOG block after CSV side effect', () => includes(buildLogMessage(base, withCsv), ', _block)[-1]'));
});

suite('buildLogMessage - CSV + log', () => {
  test('contains write_csv', () => includes(buildLogMessage(base, withCsvAndLog), 'write_csv'));
  test('uses custom sampleRows via _out', () => includes(buildLogMessage(base, withCsvAndLog), '_out.head(500)'));
  test('contains log file path', () => includes(buildLogMessage(base, withCsvAndLog), '/workspace/plog.log'));
  test('open() in append mode', () => includes(buildLogMessage(base, withCsvAndLog), "open('/workspace/plog.log', 'a')"));
  test('writes shape to log via getattr on _out', () => {
    const msg = buildLogMessage(base, withCsvAndLog);
    includes(msg, "getattr(_out, 'shape', ('?','?'))[0]");
    includes(msg, "getattr(_out, 'shape', ('?','?'))[1]");
  });
  test('timestamp import present', () => includes(buildLogMessage(base, withCsvAndLog), "__import__('datetime')"));
  test('_out.head() call appears exactly once', () => {
    strictEqual(count(buildLogMessage(base, withCsvAndLog), /_out\.head\(/g), 1);
  });
});

suite('buildLogMessage - sampleRows hardening', () => {
  test('rejects non-numeric sampleRows before generating Python', () => {
    const cfg = { ...withCsv, sampleRows: '0).__class__' as unknown as number };
    const msg = buildLogMessage(base, cfg);
    includes(msg, '_out.head(1000)');
    notIncludes(msg, '0).__class__');
  });

  test('clamps negative sampleRows', () => {
    const msg = buildLogMessage(base, { ...withCsv, sampleRows: -5 });
    includes(msg, '_out.head(0)');
  });

  test('clamps excessive sampleRows', () => {
    const msg = buildLogMessage(base, { ...withCsv, sampleRows: 1000000000 });
    includes(msg, '_out.head(100000)');
  });
});

suite('buildLogMessage - log only', () => {
  test('no write_csv', () => notIncludes(buildLogMessage(base, logOnly), 'write_csv'));
  test('contains log file path', () => includes(buildLogMessage(base, logOnly), '/workspace/plog.log'));
  test('open() in append mode', () => includes(buildLogMessage(base, logOnly), "open('/workspace/plog.log', 'a')"));
  test('hasattr shape guard on _out', () => includes(buildLogMessage(base, logOnly), "hasattr(_out, 'shape')"));
});

suite('buildLogMessage - log without timestamp', () => {
  test('writes plog.log when log path exists', () => {
    includes(buildLogMessage(base, withLogNoTimestamp), "open('/workspace/plog.log', 'a').write(_block");
  });

  test('writes one trailing newline after each DATALOG block', () => {
    includes(buildLogMessage(base, withLogNoTimestamp), "write(_block + '\\n')");
    notIncludes(buildLogMessage(base, withLogNoTimestamp), "write(_block + '\\n\\n')");
  });

  test('does not include timestamp import when disabled', () => {
    notIncludes(buildLogMessage(base, withLogNoTimestamp), "__import__('datetime')");
  });
});

suite('buildPrintVarLogMessage', () => {
  test('starts print blocks with a blank line', () => {
    includes(buildPrintVarLogMessage('customer_id'), "'\\n===DATALOG=== customer_id='");
  });

  test('captures regular Python variable as _value', () => {
    includes(buildPrintVarLogMessage('row_count'), '_value=row_count');
  });

  test('writes print blocks to plog.log when log path exists', () => {
    const msg = buildPrintVarLogMessage('threshold', withLogNoTimestamp);
    includes(msg, "open('/workspace/plog.log', 'a').write(_block + '\\n')");
  });

  test('has only one top-level logpoint brace pair', () => {
    const msg = buildPrintVarLogMessage('threshold', withLogNoTimestamp);
    strictEqual(count(msg, /{/g), 1);
    strictEqual(count(msg, /}/g), 1);
  });
});

suite('buildLogMessage - Windows path normalisation', () => {
  test('backslashes converted to forward slashes in CSV path', () => {
    const cfg: ExportConfig = { ...withCsv, outputFolderAbsPath: 'C:\\Users\\user\\worklib' };
    const msg = buildLogMessage(base, cfg);
    notIncludes(msg, 'C:\\\\');
    includes(msg, 'C:/Users/user/worklib');
  });

  test('backslashes converted in log path', () => {
    const cfg: ExportConfig = { ...withCsvAndLog, logFileAbsPath: 'C:\\Users\\user\\plog.log' };
    includes(buildLogMessage(base, cfg), 'C:/Users/user/plog.log');
  });
});

suite('buildLogMessage - variable name interpolation', () => {
  test('custom varName appears in block', () => {
    const a = { ...base, varName: 'my_special_df', inputVars: [] };
    includes(buildLogMessage(a, withCsv), 'my_special_df');
  });

  test('custom varName used in head() call via _out', () => {
    const a = { ...base, varName: 'other_df', inputVars: [] };
    includes(buildLogMessage(a, withCsv), '_out.head(');
  });

  test('custom varName used in csv filename', () => {
    const a = { ...base, varName: 'other_df', inputVars: [] };
    includes(buildLogMessage(a, withCsv), "'other_df.csv'");
  });
});

suite('buildLogMessage - source line wrapping', () => {
  const longSource = `df = pl.DataFrame({'name': ['Alice', 'Bob', 'Charlie', 'David'], 'age': [25, 30, 35, 40], 'salary': [50000, 60000, 70000, 80000], 'department': ['HR', 'IT', 'IT', 'HR']})`;

  test('long source line is broken into escaped multiple lines', () => {
    const a = { ...base, sourceText: longSource, inputVars: [] };
    includes(buildLogMessage(a), '\\n    ');
  });

  test('wrapped source keeps later chunks indented', () => {
    const a = { ...base, sourceText: longSource, inputVars: [] };
    includes(buildLogMessage(a), "\\n    \\'salary\\'");
  });

  test('short source line is not wrapped', () => {
    const a = { ...base, sourceText: 'x = pl.read_csv("f.csv")', inputVars: [] };
    includes(buildLogMessage(a), 'x = pl.read_csv("f.csv")');
  });

  test('all key names still present after wrapping', () => {
    const a = { ...base, sourceText: longSource, inputVars: [] };
    const msg = buildLogMessage(a);
    includes(msg, "\\'name\\'");
    includes(msg, "\\'age\\'");
    includes(msg, "\\'salary\\'");
    includes(msg, "\\'department\\'");
  });
});
