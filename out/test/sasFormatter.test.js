"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("./runner");
const sasFormatter_1 = require("../sasFormatter");
const base = {
    varName: 'result_df',
    sourceText: 'result_df = input_df.filter(pl.col("age") > 25)',
    range: { startLine: 1, endLine: 1 },
    inputVars: ['input_df'],
};
const noExport = {
    exportSamples: false,
    sampleRows: 1000,
    outputFolderAbsPath: '',
    logFileAbsPath: '',
    logTimestampLines: false,
};
const withCsv = {
    exportSamples: true,
    sampleRows: 1000,
    outputFolderAbsPath: '/workspace/worklib',
    logFileAbsPath: '',
    logTimestampLines: false,
};
const withCsvAndLog = {
    exportSamples: true,
    sampleRows: 500,
    outputFolderAbsPath: '/workspace/worklib',
    logFileAbsPath: '/workspace/plog.log',
    logTimestampLines: true,
};
const withLogNoTimestamp = {
    exportSamples: false,
    sampleRows: 1000,
    outputFolderAbsPath: '',
    logFileAbsPath: '/workspace/plog.log',
    logTimestampLines: false,
};
const logOnly = {
    exportSamples: false,
    sampleRows: 1000,
    outputFolderAbsPath: '',
    logFileAbsPath: '/workspace/plog.log',
    logTimestampLines: true,
};
function count(text, pattern) {
    return (text.match(pattern) ?? []).length;
}
(0, runner_1.suite)('buildLogMessage - structure', () => {
    (0, runner_1.test)('is one VS Code logpoint expression', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.ok)(msg.startsWith('{(lambda '), 'outer lambda');
        (0, runner_1.ok)(msg.endsWith('}'), 'outer close');
    });
    (0, runner_1.test)('has only one top-level logpoint brace pair', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.strictEqual)(count(msg, /{/g), 1);
        (0, runner_1.strictEqual)(count(msg, /}/g), 1);
    });
    (0, runner_1.test)('header followed by escaped newline into source text', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base), "'\\n===DATALOG===\\nresult_df = input_df.filter");
    });
    (0, runner_1.test)('source text appears directly (no Code: prefix)', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base), 'result_df = input_df.filter');
    });
    (0, runner_1.test)('includes New dataframe and New lazyframe in conditional', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.includes)(msg, 'New dataframe');
        (0, runner_1.includes)(msg, 'New lazyframe');
    });
    (0, runner_1.test)('outer lambda captures output var as _out', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base), '_out=result_df');
    });
    (0, runner_1.test)('includes getattr shape expression for output var', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base), "getattr(_out, 'shape'");
    });
});
(0, runner_1.suite)('buildLogMessage - input vars', () => {
    (0, runner_1.test)('outer lambda captures input var as _in0', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base), '_in0=input_df');
    });
    (0, runner_1.test)('includes getattr shape expression for each input var', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.includes)(msg, "getattr(_in0, 'shape'");
        (0, runner_1.includes)(msg, 'input_df');
    });
    (0, runner_1.test)('input var label uses dataframe/lazyframe conditional', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.includes)(msg, 'Input dataframe');
        (0, runner_1.includes)(msg, 'Input lazyframe');
    });
    (0, runner_1.test)('no _in0 capture when inputVars is empty', () => {
        const a = { ...base, sourceText: 'result_df = pl.DataFrame()', inputVars: [] };
        (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(a), '_in0=');
    });
});
(0, runner_1.suite)('buildLogMessage - brace encoding', () => {
    (0, runner_1.test)('curly braces in source code are encoded as chr() expressions', () => {
        const a = { ...base, sourceText: 'df = pl.DataFrame({"a": [1]})' };
        const msg = (0, sasFormatter_1.buildLogMessage)(a);
        (0, runner_1.includes)(msg, 'chr(123)');
        (0, runner_1.includes)(msg, 'chr(125)');
    });
    (0, runner_1.test)('source braces do not add logpoint expression delimiters', () => {
        const a = { ...base, sourceText: 'df = fn({"key": "val"})' };
        const msg = (0, sasFormatter_1.buildLogMessage)(a);
        (0, runner_1.strictEqual)(count(msg, /{/g), 1);
        (0, runner_1.strictEqual)(count(msg, /}/g), 1);
        (0, runner_1.includes)(msg, '"key"');
    });
});
(0, runner_1.suite)('buildLogMessage - no exportConfig', () => {
    (0, runner_1.test)('no write_csv call', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base), 'write_csv'));
    (0, runner_1.test)('no open() call', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base), 'open('));
});
(0, runner_1.suite)('buildLogMessage - both disabled', () => {
    (0, runner_1.test)('no write_csv', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, noExport), 'write_csv'));
    (0, runner_1.test)('no open()', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, noExport), 'open('));
});
(0, runner_1.suite)('buildLogMessage - CSV export only', () => {
    (0, runner_1.test)('contains write_csv', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), 'write_csv'));
    (0, runner_1.test)('uses correct row count via _out', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), '_out.head(1000)'));
    (0, runner_1.test)('contains output folder path', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), '/workspace/worklib'));
    (0, runner_1.test)('CSV filename is varName.csv', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), "'result_df.csv'"));
    (0, runner_1.test)('has LazyFrame guard on _out', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), "hasattr(_out, 'write_csv')"));
    (0, runner_1.test)('LazyFrame guard skips CSV write side effect', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), 'else 0'));
    (0, runner_1.test)('no open() for log', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), "open('/workspace/plog.log'"));
    (0, runner_1.test)('mkdir call present', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), 'mkdir'));
    (0, runner_1.test)('returns the DATALOG block after CSV side effect', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), ', _block)[-1]'));
});
(0, runner_1.suite)('buildLogMessage - CSV + log', () => {
    (0, runner_1.test)('contains write_csv', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), 'write_csv'));
    (0, runner_1.test)('uses custom sampleRows via _out', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), '_out.head(500)'));
    (0, runner_1.test)('contains log file path', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), '/workspace/plog.log'));
    (0, runner_1.test)('open() in append mode', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), "open('/workspace/plog.log', 'a')"));
    (0, runner_1.test)('writes shape to log via getattr on _out', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog);
        (0, runner_1.includes)(msg, "getattr(_out, 'shape', ('?','?'))[0]");
        (0, runner_1.includes)(msg, "getattr(_out, 'shape', ('?','?'))[1]");
    });
    (0, runner_1.test)('timestamp import present', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), "__import__('datetime')"));
    (0, runner_1.test)('_out.head() call appears exactly once', () => {
        (0, runner_1.strictEqual)(count((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), /_out\.head\(/g), 1);
    });
});
(0, runner_1.suite)('buildLogMessage - sampleRows hardening', () => {
    (0, runner_1.test)('rejects non-numeric sampleRows before generating Python', () => {
        const cfg = { ...withCsv, sampleRows: '0).__class__' };
        const msg = (0, sasFormatter_1.buildLogMessage)(base, cfg);
        (0, runner_1.includes)(msg, '_out.head(1000)');
        (0, runner_1.notIncludes)(msg, '0).__class__');
    });
    (0, runner_1.test)('clamps negative sampleRows', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base, { ...withCsv, sampleRows: -5 });
        (0, runner_1.includes)(msg, '_out.head(0)');
    });
    (0, runner_1.test)('clamps excessive sampleRows', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base, { ...withCsv, sampleRows: 1000000000 });
        (0, runner_1.includes)(msg, '_out.head(100000)');
    });
});
(0, runner_1.suite)('buildLogMessage - log only', () => {
    (0, runner_1.test)('no write_csv', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), 'write_csv'));
    (0, runner_1.test)('contains log file path', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), '/workspace/plog.log'));
    (0, runner_1.test)('open() in append mode', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), "open('/workspace/plog.log', 'a')"));
    (0, runner_1.test)('hasattr shape guard on _out', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), "hasattr(_out, 'shape')"));
});
(0, runner_1.suite)('buildLogMessage - log without timestamp', () => {
    (0, runner_1.test)('writes plog.log when log path exists', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withLogNoTimestamp), "open('/workspace/plog.log', 'a').write(_block");
    });
    (0, runner_1.test)('writes one trailing newline after each DATALOG block', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withLogNoTimestamp), "write(_block + '\\n')");
        (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, withLogNoTimestamp), "write(_block + '\\n\\n')");
    });
    (0, runner_1.test)('does not include timestamp import when disabled', () => {
        (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, withLogNoTimestamp), "__import__('datetime')");
    });
});
(0, runner_1.suite)('buildPrintVarLogMessage', () => {
    (0, runner_1.test)('starts print blocks with a blank line', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildPrintVarLogMessage)('customer_id'), "'\\n===DATALOG=== customer_id='");
    });
    (0, runner_1.test)('captures regular Python variable as _value', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildPrintVarLogMessage)('row_count'), '_value=row_count');
    });
    (0, runner_1.test)('writes print blocks to plog.log when log path exists', () => {
        const msg = (0, sasFormatter_1.buildPrintVarLogMessage)('threshold', withLogNoTimestamp);
        (0, runner_1.includes)(msg, "open('/workspace/plog.log', 'a').write(_block + '\\n')");
    });
    (0, runner_1.test)('has only one top-level logpoint brace pair', () => {
        const msg = (0, sasFormatter_1.buildPrintVarLogMessage)('threshold', withLogNoTimestamp);
        (0, runner_1.strictEqual)(count(msg, /{/g), 1);
        (0, runner_1.strictEqual)(count(msg, /}/g), 1);
    });
});
(0, runner_1.suite)('buildLogMessage - Windows path normalisation', () => {
    (0, runner_1.test)('backslashes converted to forward slashes in CSV path', () => {
        const cfg = { ...withCsv, outputFolderAbsPath: 'C:\\Users\\user\\worklib' };
        const msg = (0, sasFormatter_1.buildLogMessage)(base, cfg);
        (0, runner_1.notIncludes)(msg, 'C:\\\\');
        (0, runner_1.includes)(msg, 'C:/Users/user/worklib');
    });
    (0, runner_1.test)('backslashes converted in log path', () => {
        const cfg = { ...withCsvAndLog, logFileAbsPath: 'C:\\Users\\user\\plog.log' };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, cfg), 'C:/Users/user/plog.log');
    });
});
(0, runner_1.suite)('buildLogMessage - variable name interpolation', () => {
    (0, runner_1.test)('custom varName appears in block', () => {
        const a = { ...base, varName: 'my_special_df', inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a, withCsv), 'my_special_df');
    });
    (0, runner_1.test)('custom varName used in head() call via _out', () => {
        const a = { ...base, varName: 'other_df', inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a, withCsv), '_out.head(');
    });
    (0, runner_1.test)('custom varName used in csv filename', () => {
        const a = { ...base, varName: 'other_df', inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a, withCsv), "'other_df.csv'");
    });
});
(0, runner_1.suite)('buildLogMessage - source line wrapping', () => {
    const longSource = `df = pl.DataFrame({'name': ['Alice', 'Bob', 'Charlie', 'David'], 'age': [25, 30, 35, 40], 'salary': [50000, 60000, 70000, 80000], 'department': ['HR', 'IT', 'IT', 'HR']})`;
    (0, runner_1.test)('long source line is broken into escaped multiple lines', () => {
        const a = { ...base, sourceText: longSource, inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a), '\\n    ');
    });
    (0, runner_1.test)('wrapped source keeps later chunks indented', () => {
        const a = { ...base, sourceText: longSource, inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a), "\\n    \\'salary\\'");
    });
    (0, runner_1.test)('short source line is not wrapped', () => {
        const a = { ...base, sourceText: 'x = pl.read_csv("f.csv")', inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a), 'x = pl.read_csv("f.csv")');
    });
    (0, runner_1.test)('all key names still present after wrapping', () => {
        const a = { ...base, sourceText: longSource, inputVars: [] };
        const msg = (0, sasFormatter_1.buildLogMessage)(a);
        (0, runner_1.includes)(msg, "\\'name\\'");
        (0, runner_1.includes)(msg, "\\'age\\'");
        (0, runner_1.includes)(msg, "\\'salary\\'");
        (0, runner_1.includes)(msg, "\\'department\\'");
    });
});
//# sourceMappingURL=sasFormatter.test.js.map