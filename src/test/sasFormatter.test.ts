import { suite, test, ok, notOk, includes, notIncludes, strictEqual } from './runner';
import { buildLogMessage, ExportConfig } from '../sasFormatter';
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
};

const withCsv: ExportConfig = {
  exportSamples: true,
  sampleRows: 1000,
  outputFolderAbsPath: '/workspace/worklib',
  logFileAbsPath: '',
};

const withCsvAndLog: ExportConfig = {
  exportSamples: true,
  sampleRows: 500,
  outputFolderAbsPath: '/workspace/worklib',
  logFileAbsPath: '/workspace/plog.log',
};

const logOnly: ExportConfig = {
  exportSamples: false,
  sampleRows: 1000,
  outputFolderAbsPath: '',
  logFileAbsPath: '/workspace/plog.log',
};

// ---------------------------------------------------------------------------
// Core structure
// ---------------------------------------------------------------------------
suite('buildLogMessage — structure', () => {
  test('starts with ===DATALOG===', () => {
    const msg = buildLogMessage(base);
    ok(msg.startsWith('===DATALOG==='), 'header');
  });

  test('pipe-separates parts', () => {
    const msg = buildLogMessage(base);
    ok(msg.includes(' | '), 'pipe separator');
  });

  test('includes Code: section', () => {
    includes(buildLogMessage(base), 'Code:');
  });

  test('includes NOTE section', () => {
    includes(buildLogMessage(base), 'NOTE: The data set result_df');
  });

  test('includes shape expression for output var', () => {
    const msg = buildLogMessage(base);
    includes(msg, 'result_df.shape[0]');
    includes(msg, 'result_df.shape[1]');
  });
});

// ---------------------------------------------------------------------------
// Input vars
// ---------------------------------------------------------------------------
suite('buildLogMessage — input vars', () => {
  test('includes shape expression for each input var', () => {
    const msg = buildLogMessage(base);
    includes(msg, 'input_df.shape[0]');
    includes(msg, 'input_df');
  });

  test('no shape expression for input var when inputVars is empty', () => {
    const a = { ...base, sourceText: 'result_df = pl.DataFrame()', inputVars: [] };
    const msg = buildLogMessage(a);
    notIncludes(msg, 'input_df.shape[0]');
  });
});

// ---------------------------------------------------------------------------
// Brace escaping in source text
// ---------------------------------------------------------------------------
suite('buildLogMessage — code label truncation', () => {
  test('single-line source shown in full', () => {
    const msg = buildLogMessage(base);
    includes(msg, 'result_df = input_df.filter(pl.col');
  });

  test('multi-line source collapses to "varName = ..."', () => {
    const a = { ...base, sourceText: 'result_df = pl.DataFrame({\n    "a": [1]\n})' };
    const msg = buildLogMessage(a);
    // Multi-line: use safe "varName = ..." label — never the raw first line
    // which may contain an unmatched { causing debugpy "Unbalanced braces".
    includes(msg, 'Code: result_df = ...');
    notIncludes(msg, '"a": [1]');
  });
});

suite('buildLogMessage — brace escaping', () => {
  test('curly braces in source code are escaped', () => {
    const a = { ...base, sourceText: 'df = pl.DataFrame({"a": [1]})' };
    const msg = buildLogMessage(a);
    includes(msg, '{{');
    includes(msg, '}}');
  });

  test('braces in source code are doubled in Code: section', () => {
    const a = { ...base, sourceText: 'df = fn({"key": "val"})' };
    const msg = buildLogMessage(a);
    const codeSection = msg.split(' | ')[1]; // "Code: ..."
    includes(codeSection, '{{"key"');
  });
});

// ---------------------------------------------------------------------------
// No export config
// ---------------------------------------------------------------------------
suite('buildLogMessage — no exportConfig', () => {
  test('no write_csv call', () => notIncludes(buildLogMessage(base), 'write_csv'));
  test('no open() call', () => notIncludes(buildLogMessage(base), 'open('));
  test('no → CSV marker', () => notIncludes(buildLogMessage(base), '→ CSV'));
});

// ---------------------------------------------------------------------------
// exportSamples=false, logFileAbsPath=''
// ---------------------------------------------------------------------------
suite('buildLogMessage — both disabled', () => {
  test('no write_csv', () => notIncludes(buildLogMessage(base, noExport), 'write_csv'));
  test('no open()', () => notIncludes(buildLogMessage(base, noExport), 'open('));
});

// ---------------------------------------------------------------------------
// CSV only
// ---------------------------------------------------------------------------
suite('buildLogMessage — CSV export only', () => {
  test('contains write_csv', () => includes(buildLogMessage(base, withCsv), 'write_csv'));
  test('uses correct row count', () => includes(buildLogMessage(base, withCsv), 'result_df.head(1000)'));
  test('contains output folder path', () => includes(buildLogMessage(base, withCsv), '/workspace/worklib'));
  test('CSV filename is varName.csv', () => includes(buildLogMessage(base, withCsv), "'result_df.csv'"));
  test('has LazyFrame guard', () => includes(buildLogMessage(base, withCsv), "hasattr(result_df, 'write_csv')"));
  test('has LazyFrame fallback text', () => includes(buildLogMessage(base, withCsv), 'LazyFrame'));
  test('no open() for log', () => notIncludes(buildLogMessage(base, withCsv), "open('/workspace/plog.log'"));
  test('mkdir call present', () => includes(buildLogMessage(base, withCsv), 'mkdir'));
  test('→ CSV marker in expression', () => includes(buildLogMessage(base, withCsv), '→ CSV'));
});

// ---------------------------------------------------------------------------
// CSV + log
// ---------------------------------------------------------------------------
suite('buildLogMessage — CSV + log', () => {
  test('contains write_csv', () => includes(buildLogMessage(base, withCsvAndLog), 'write_csv'));
  test('uses custom sampleRows', () => includes(buildLogMessage(base, withCsvAndLog), 'result_df.head(500)'));
  test('contains log file path', () => includes(buildLogMessage(base, withCsvAndLog), '/workspace/plog.log'));
  test('open() in append mode', () => includes(buildLogMessage(base, withCsvAndLog), "open('/workspace/plog.log', 'a')"));
  test('writes shape to log', () => {
    const msg = buildLogMessage(base, withCsvAndLog);
    includes(msg, 'str(_r[0])');
    includes(msg, 'str(_r[1])');
  });
  test('shape tuple passed as _r arg', () => {
    includes(buildLogMessage(base, withCsvAndLog), 'result_df.shape)');
  });
  test('timestamp import present', () => includes(buildLogMessage(base, withCsvAndLog), '__import__(\'datetime\')'));
  test('head() call appears exactly once (CSV+log combined, not duplicated)', () => {
    const msg = buildLogMessage(base, withCsvAndLog);
    const headCount = (msg.match(/result_df\.head\(/g) ?? []).length;
    strictEqual(headCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Log only (no CSV)
// ---------------------------------------------------------------------------
suite('buildLogMessage — log only', () => {
  test('no write_csv', () => notIncludes(buildLogMessage(base, logOnly), 'write_csv'));
  test('contains log file path', () => includes(buildLogMessage(base, logOnly), '/workspace/plog.log'));
  test('open() in append mode', () => includes(buildLogMessage(base, logOnly), "open('/workspace/plog.log', 'a')"));
  test('→ logged marker', () => includes(buildLogMessage(base, logOnly), '→ logged'));
  test('hasattr shape guard', () => includes(buildLogMessage(base, logOnly), "hasattr(result_df, 'shape')"));
});

// ---------------------------------------------------------------------------
// Windows path normalisation
// ---------------------------------------------------------------------------
suite('buildLogMessage — Windows path normalisation', () => {
  test('backslashes converted to forward slashes in CSV path', () => {
    const cfg: ExportConfig = { ...withCsv, outputFolderAbsPath: 'C:\\Users\\user\\worklib' };
    const msg = buildLogMessage(base, cfg);
    notIncludes(msg, 'C:\\\\');
    includes(msg, 'C:/Users/user/worklib');
  });

  test('backslashes converted in log path', () => {
    const cfg: ExportConfig = { ...withCsvAndLog, logFileAbsPath: 'C:\\Users\\user\\plog.log' };
    const msg = buildLogMessage(base, cfg);
    includes(msg, 'C:/Users/user/plog.log');
  });
});

// ---------------------------------------------------------------------------
// Variable name is correctly interpolated everywhere
// ---------------------------------------------------------------------------
suite('buildLogMessage — variable name interpolation', () => {
  test('custom varName appears in NOTE', () => {
    const a = { ...base, varName: 'my_special_df', inputVars: [] };
    includes(buildLogMessage(a, withCsv), 'my_special_df');
  });

  test('custom varName used in head() call', () => {
    const a = { ...base, varName: 'other_df', inputVars: [] };
    includes(buildLogMessage(a, withCsv), 'other_df.head(');
  });

  test('custom varName used in csv filename', () => {
    const a = { ...base, varName: 'other_df', inputVars: [] };
    includes(buildLogMessage(a, withCsv), "'other_df.csv'");
  });
});
