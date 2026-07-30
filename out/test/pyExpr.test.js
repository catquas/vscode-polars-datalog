"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("./runner");
const pyExpr_1 = require("../pyExpr");
(0, runner_1.suite)('pyStringExpr', () => {
    (0, runner_1.test)('wraps plain text in single quotes', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.pyStringExpr)('hello'), "'hello'");
    });
    (0, runner_1.test)('empty text becomes an empty Python string', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.pyStringExpr)(''), "''");
    });
    (0, runner_1.test)('escapes single quotes', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.pyStringExpr)("it's"), "'it\\'s'");
    });
    (0, runner_1.test)('escapes backslashes', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.pyStringExpr)('a\\b'), "'a\\\\b'");
    });
    (0, runner_1.test)('encodes newlines and tabs', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.pyStringExpr)('a\nb\tc'), "'a\\nb\\tc'");
    });
    (0, runner_1.test)('splits braces into chr() calls so logpoints do not eat them', () => {
        const expr = (0, pyExpr_1.pyStringExpr)('a{b}c');
        (0, runner_1.includes)(expr, 'chr(123)');
        (0, runner_1.includes)(expr, 'chr(125)');
        (0, runner_1.notIncludes)(expr, '{b}');
    });
    (0, runner_1.test)('handles text that is only braces', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.pyStringExpr)('{}'), 'chr(123) + chr(125)');
    });
});
(0, runner_1.suite)('normalizePathForPython', () => {
    (0, runner_1.test)('converts Windows separators', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.normalizePathForPython)('C:\\Users\\a\\plog.log'), 'C:/Users/a/plog.log');
    });
    (0, runner_1.test)('leaves posix paths alone', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.normalizePathForPython)('/tmp/plog.log'), '/tmp/plog.log');
    });
});
(0, runner_1.suite)('safeFileStem', () => {
    (0, runner_1.test)('keeps plain names', () => (0, runner_1.strictEqual)((0, pyExpr_1.safeFileStem)('result_df'), 'result_df'));
    (0, runner_1.test)('flattens attribute targets', () => (0, runner_1.strictEqual)((0, pyExpr_1.safeFileStem)('self.raw_df'), 'self_raw_df'));
    (0, runner_1.test)('flattens subscript targets', () => (0, runner_1.strictEqual)((0, pyExpr_1.safeFileStem)('frames["train"]'), 'frames_train'));
    (0, runner_1.test)('strips path separators', () => (0, runner_1.strictEqual)((0, pyExpr_1.safeFileStem)('../../etc/passwd'), 'etc_passwd'));
    (0, runner_1.test)('never returns an empty stem', () => (0, runner_1.strictEqual)((0, pyExpr_1.safeFileStem)('///'), 'datalog_output'));
    (0, runner_1.test)('caps the length', () => (0, runner_1.ok)((0, pyExpr_1.safeFileStem)('a'.repeat(500)).length <= 120, 'truncated'));
});
(0, runner_1.suite)('safeCaptureExpr', () => {
    (0, runner_1.test)('looks a simple name up in locals then globals', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.safeCaptureExpr)('result_df'), "locals().get('result_df', globals().get('result_df', NotImplemented))");
    });
    (0, runner_1.test)('reads attribute targets directly', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.safeCaptureExpr)('self.raw_df'), 'self.raw_df');
    });
    (0, runner_1.test)('reads subscript targets directly', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.safeCaptureExpr)('frames["train"]'), 'frames["train"]');
    });
});
(0, runner_1.suite)('shortHash', () => {
    (0, runner_1.test)('is stable for the same input', () => {
        (0, runner_1.strictEqual)((0, pyExpr_1.shortHash)('abc'), (0, pyExpr_1.shortHash)('abc'));
    });
    (0, runner_1.test)('differs for different input', () => {
        (0, runner_1.ok)((0, pyExpr_1.shortHash)('abc') !== (0, pyExpr_1.shortHash)('abd'), 'different');
    });
    (0, runner_1.test)('is always 8 hex characters', () => {
        for (const text of ['', 'a', 'a longer string with spaces']) {
            (0, runner_1.ok)(/^[0-9a-f]{8}$/.test((0, pyExpr_1.shortHash)(text)), `hex for ${JSON.stringify(text)}`);
        }
    });
});
//# sourceMappingURL=pyExpr.test.js.map