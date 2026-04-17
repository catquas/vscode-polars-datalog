"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suite = suite;
exports.test = test;
exports.strictEqual = strictEqual;
exports.deepEqual = deepEqual;
exports.ok = ok;
exports.notOk = notOk;
exports.includes = includes;
exports.notIncludes = notIncludes;
exports.report = report;
let passed = 0;
let failed = 0;
let currentSuite = '';
function suite(name, fn) {
    currentSuite = name;
    console.log(`\n  ${name}`);
    fn();
}
function test(name, fn) {
    try {
        fn();
        console.log(`    ✓ ${name}`);
        passed++;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    ✗ ${name}`);
        console.error(`        ${msg}`);
        failed++;
    }
}
function strictEqual(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}
function deepEqual(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`${label ? label + ': ' : ''}expected ${e}, got ${a}`);
    }
}
function ok(value, label) {
    if (!value) {
        throw new Error(`${label ?? 'expected truthy'}: got ${JSON.stringify(value)}`);
    }
}
function notOk(value, label) {
    if (value) {
        throw new Error(`${label ?? 'expected falsy'}: got ${JSON.stringify(value)}`);
    }
}
function includes(haystack, needle) {
    if (!haystack.includes(needle)) {
        throw new Error(`expected string to include ${JSON.stringify(needle)}\n        string: ${JSON.stringify(haystack.slice(0, 200))}`);
    }
}
function notIncludes(haystack, needle) {
    if (haystack.includes(needle)) {
        throw new Error(`expected string NOT to include ${JSON.stringify(needle)}`);
    }
}
function report() {
    console.log(`\n  ${passed} passing, ${failed} failing\n`);
    if (failed > 0) {
        process.exit(1);
    }
}
//# sourceMappingURL=runner.js.map