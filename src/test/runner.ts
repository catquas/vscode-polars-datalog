/* eslint-disable @typescript-eslint/no-explicit-any */
declare const console: { log(...args: any[]): void; error(...args: any[]): void };
declare const process: { exit(code: number): never };

let passed = 0;
let failed = 0;
let currentSuite = '';

export function suite(name: string, fn: () => void): void {
  currentSuite = name;
  console.log(`\n  ${name}`);
  fn();
}

export function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`    ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`    ✗ ${name}`);
    console.error(`        ${msg}`);
    failed++;
  }
}

export function strictEqual<T>(actual: T, expected: T, label?: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

export function deepEqual(actual: unknown, expected: unknown, label?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label ? label + ': ' : ''}expected ${e}, got ${a}`);
  }
}

export function ok(value: unknown, label?: string): void {
  if (!value) {
    throw new Error(`${label ?? 'expected truthy'}: got ${JSON.stringify(value)}`);
  }
}

export function notOk(value: unknown, label?: string): void {
  if (value) {
    throw new Error(`${label ?? 'expected falsy'}: got ${JSON.stringify(value)}`);
  }
}

export function includes(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`expected string to include ${JSON.stringify(needle)}\n        string: ${JSON.stringify(haystack.slice(0, 200))}`);
  }
}

export function notIncludes(haystack: string, needle: string): void {
  if (haystack.includes(needle)) {
    throw new Error(`expected string NOT to include ${JSON.stringify(needle)}`);
  }
}

export function report(): void {
  console.log(`\n  ${passed} passing, ${failed} failing\n`);
  if (failed > 0) { process.exit(1); }
}
