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
};
const withCsv = {
    exportSamples: true,
    sampleRows: 1000,
    outputFolderAbsPath: '/workspace/worklib',
    logFileAbsPath: '',
};
const withCsvAndLog = {
    exportSamples: true,
    sampleRows: 500,
    outputFolderAbsPath: '/workspace/worklib',
    logFileAbsPath: '/workspace/plog.log',
};
const logOnly = {
    exportSamples: false,
    sampleRows: 1000,
    outputFolderAbsPath: '',
    logFileAbsPath: '/workspace/plog.log',
};
// ---------------------------------------------------------------------------
// Core structure
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — structure', () => {
    (0, runner_1.test)('starts with ===DATALOG===', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.ok)(msg.startsWith('===DATALOG==='), 'header');
    });
    (0, runner_1.test)('pipe-separates parts', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.ok)(msg.includes(' | '), 'pipe separator');
    });
    (0, runner_1.test)('includes Code: section', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base), 'Code:');
    });
    (0, runner_1.test)('includes NOTE section', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base), 'NOTE: The data set result_df');
    });
    (0, runner_1.test)('includes shape expression for output var', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.includes)(msg, 'result_df.shape[0]');
        (0, runner_1.includes)(msg, 'result_df.shape[1]');
    });
});
// ---------------------------------------------------------------------------
// Input vars
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — input vars', () => {
    (0, runner_1.test)('includes shape expression for each input var', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base);
        (0, runner_1.includes)(msg, 'input_df.shape[0]');
        (0, runner_1.includes)(msg, 'input_df');
    });
    (0, runner_1.test)('no shape expression for input var when inputVars is empty', () => {
        const a = { ...base, sourceText: 'result_df = pl.DataFrame()', inputVars: [] };
        const msg = (0, sasFormatter_1.buildLogMessage)(a);
        (0, runner_1.notIncludes)(msg, 'input_df.shape[0]');
    });
});
// ---------------------------------------------------------------------------
// Brace escaping in source text
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — brace escaping', () => {
    (0, runner_1.test)('curly braces in source code are escaped', () => {
        const a = { ...base, sourceText: 'df = pl.DataFrame({"a": [1]})' };
        const msg = (0, sasFormatter_1.buildLogMessage)(a);
        (0, runner_1.includes)(msg, '{{');
        (0, runner_1.includes)(msg, '}}');
    });
    (0, runner_1.test)('braces in source code are doubled in Code: section', () => {
        const a = { ...base, sourceText: 'df = fn({"key": "val"})' };
        const msg = (0, sasFormatter_1.buildLogMessage)(a);
        const codeSection = msg.split(' | ')[1]; // "Code: ..."
        (0, runner_1.includes)(codeSection, '{{"key"');
    });
});
// ---------------------------------------------------------------------------
// No export config
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — no exportConfig', () => {
    (0, runner_1.test)('no write_csv call', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base), 'write_csv'));
    (0, runner_1.test)('no open() call', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base), 'open('));
    (0, runner_1.test)('no → CSV marker', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base), '→ CSV'));
});
// ---------------------------------------------------------------------------
// exportSamples=false, logFileAbsPath=''
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — both disabled', () => {
    (0, runner_1.test)('no write_csv', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, noExport), 'write_csv'));
    (0, runner_1.test)('no open()', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, noExport), 'open('));
});
// ---------------------------------------------------------------------------
// CSV only
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — CSV export only', () => {
    (0, runner_1.test)('contains write_csv', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), 'write_csv'));
    (0, runner_1.test)('uses correct row count', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), 'result_df.head(1000)'));
    (0, runner_1.test)('contains output folder path', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), '/workspace/worklib'));
    (0, runner_1.test)('CSV filename is varName.csv', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), "'result_df.csv'"));
    (0, runner_1.test)('has LazyFrame guard', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), "hasattr(result_df, 'write_csv')"));
    (0, runner_1.test)('has LazyFrame fallback text', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), 'LazyFrame'));
    (0, runner_1.test)('no open() for log', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), "open('/workspace/plog.log'"));
    (0, runner_1.test)('mkdir call present', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), 'mkdir'));
    (0, runner_1.test)('→ CSV marker in expression', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsv), '→ CSV'));
});
// ---------------------------------------------------------------------------
// CSV + log
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — CSV + log', () => {
    (0, runner_1.test)('contains write_csv', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), 'write_csv'));
    (0, runner_1.test)('uses custom sampleRows', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), 'result_df.head(500)'));
    (0, runner_1.test)('contains log file path', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), '/workspace/plog.log'));
    (0, runner_1.test)('open() in append mode', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), "open('/workspace/plog.log', 'a')"));
    (0, runner_1.test)('writes shape to log', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog);
        (0, runner_1.includes)(msg, 'str(_r[0])');
        (0, runner_1.includes)(msg, 'str(_r[1])');
    });
    (0, runner_1.test)('shape tuple passed as _r arg', () => {
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), 'result_df.shape)');
    });
    (0, runner_1.test)('timestamp import present', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog), '__import__(\'datetime\')'));
    (0, runner_1.test)('head() call appears exactly once (CSV+log combined, not duplicated)', () => {
        const msg = (0, sasFormatter_1.buildLogMessage)(base, withCsvAndLog);
        const headCount = (msg.match(/result_df\.head\(/g) ?? []).length;
        (0, runner_1.strictEqual)(headCount, 1);
    });
});
// ---------------------------------------------------------------------------
// Log only (no CSV)
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — log only', () => {
    (0, runner_1.test)('no write_csv', () => (0, runner_1.notIncludes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), 'write_csv'));
    (0, runner_1.test)('contains log file path', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), '/workspace/plog.log'));
    (0, runner_1.test)('open() in append mode', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), "open('/workspace/plog.log', 'a')"));
    (0, runner_1.test)('→ logged marker', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), '→ logged'));
    (0, runner_1.test)('hasattr shape guard', () => (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(base, logOnly), "hasattr(result_df, 'shape')"));
});
// ---------------------------------------------------------------------------
// Windows path normalisation
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — Windows path normalisation', () => {
    (0, runner_1.test)('backslashes converted to forward slashes in CSV path', () => {
        const cfg = { ...withCsv, outputFolderAbsPath: 'C:\\Users\\user\\worklib' };
        const msg = (0, sasFormatter_1.buildLogMessage)(base, cfg);
        (0, runner_1.notIncludes)(msg, 'C:\\\\');
        (0, runner_1.includes)(msg, 'C:/Users/user/worklib');
    });
    (0, runner_1.test)('backslashes converted in log path', () => {
        const cfg = { ...withCsvAndLog, logFileAbsPath: 'C:\\Users\\user\\plog.log' };
        const msg = (0, sasFormatter_1.buildLogMessage)(base, cfg);
        (0, runner_1.includes)(msg, 'C:/Users/user/plog.log');
    });
});
// ---------------------------------------------------------------------------
// Variable name is correctly interpolated everywhere
// ---------------------------------------------------------------------------
(0, runner_1.suite)('buildLogMessage — variable name interpolation', () => {
    (0, runner_1.test)('custom varName appears in NOTE', () => {
        const a = { ...base, varName: 'my_special_df', inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a, withCsv), 'my_special_df');
    });
    (0, runner_1.test)('custom varName used in head() call', () => {
        const a = { ...base, varName: 'other_df', inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a, withCsv), 'other_df.head(');
    });
    (0, runner_1.test)('custom varName used in csv filename', () => {
        const a = { ...base, varName: 'other_df', inputVars: [] };
        (0, runner_1.includes)((0, sasFormatter_1.buildLogMessage)(a, withCsv), "'other_df.csv'");
    });
});
//# sourceMappingURL=sasFormatter.test.js.map