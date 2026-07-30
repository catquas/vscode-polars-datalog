import { suite, test, strictEqual, includes, notIncludes, ok } from './runner';
import {
  normalizePathForPython,
  pyStringExpr,
  safeCaptureExpr,
  safeFileStem,
  shortHash,
} from '../pyExpr';

suite('pyStringExpr', () => {
  test('wraps plain text in single quotes', () => {
    strictEqual(pyStringExpr('hello'), "'hello'");
  });

  test('empty text becomes an empty Python string', () => {
    strictEqual(pyStringExpr(''), "''");
  });

  test('escapes single quotes', () => {
    strictEqual(pyStringExpr("it's"), "'it\\'s'");
  });

  test('escapes backslashes', () => {
    strictEqual(pyStringExpr('a\\b'), "'a\\\\b'");
  });

  test('encodes newlines and tabs', () => {
    strictEqual(pyStringExpr('a\nb\tc'), "'a\\nb\\tc'");
  });

  test('splits braces into chr() calls so logpoints do not eat them', () => {
    const expr = pyStringExpr('a{b}c');
    includes(expr, 'chr(123)');
    includes(expr, 'chr(125)');
    notIncludes(expr, '{b}');
  });

  test('handles text that is only braces', () => {
    strictEqual(pyStringExpr('{}'), 'chr(123) + chr(125)');
  });
});

suite('normalizePathForPython', () => {
  test('converts Windows separators', () => {
    strictEqual(normalizePathForPython('C:\\Users\\a\\plog.log'), 'C:/Users/a/plog.log');
  });

  test('leaves posix paths alone', () => {
    strictEqual(normalizePathForPython('/tmp/plog.log'), '/tmp/plog.log');
  });
});

suite('safeFileStem', () => {
  test('keeps plain names', () => strictEqual(safeFileStem('result_df'), 'result_df'));
  test('flattens attribute targets', () => strictEqual(safeFileStem('self.raw_df'), 'self_raw_df'));
  test('flattens subscript targets', () => strictEqual(safeFileStem('frames["train"]'), 'frames_train'));
  test('strips path separators', () => strictEqual(safeFileStem('../../etc/passwd'), 'etc_passwd'));
  test('never returns an empty stem', () => strictEqual(safeFileStem('///'), 'datalog_output'));
  test('caps the length', () => ok(safeFileStem('a'.repeat(500)).length <= 120, 'truncated'));
});

suite('safeCaptureExpr', () => {
  test('looks a simple name up in locals then globals', () => {
    strictEqual(
      safeCaptureExpr('result_df'),
      "locals().get('result_df', globals().get('result_df', NotImplemented))"
    );
  });

  test('reads attribute targets directly', () => {
    strictEqual(safeCaptureExpr('self.raw_df'), 'self.raw_df');
  });

  test('reads subscript targets directly', () => {
    strictEqual(safeCaptureExpr('frames["train"]'), 'frames["train"]');
  });
});

suite('shortHash', () => {
  test('is stable for the same input', () => {
    strictEqual(shortHash('abc'), shortHash('abc'));
  });

  test('differs for different input', () => {
    ok(shortHash('abc') !== shortHash('abd'), 'different');
  });

  test('is always 8 hex characters', () => {
    for (const text of ['', 'a', 'a longer string with spaces']) {
      ok(/^[0-9a-f]{8}$/.test(shortHash(text)), `hex for ${JSON.stringify(text)}`);
    }
  });
});
