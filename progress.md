# Progress Summary

## Completed

### Heuristics in `src/pythonAnalyzer.ts` ✅
- **Heuristic 4** – subscript access + DataFrame method: `microdifs = (libs["df"].filter(...))`
- **Heuristic 5** – annotated function return: `mdiff = buildit(libs)` (function returns `-> pl.DataFrame`)
- Helper `findDfReturningFunctions()`, `isDataFrameAssignment` updated, `analyzeFile` updated
- 99 tests all pass

### Removed `hitCount='1'` from `src/logpointManager.ts` ✅
- Changed both `SourceBreakpoint` calls from `hitCount='1'` to `hitCount=undefined`
- This did NOT fix the `microdifs` scope error (hitCount was not the root cause)
- Keeping it removed is still correct — hitCount='1' prevented re-fires in loops which we want

---

## Active Bug: `microdifs` shows `name 'microdifs' is not defined`

### Test file: `C:\Users\brent\pythontest\functiony.py`
```python
def buildit(
    libs: dict[str, pl.DataFrame],
) -> pl.DataFrame:
    microdifs = (          # lines 21–33 (1-based)
        libs["df"]
        .filter(...)
        .unique()
        .sort([...])
    )                      # closes at line 33
    x=1                    # line 34 ← logpoint placed HERE by extension
    return microdifs       # line 35

libs = build_libs()
mdiff = buildit(libs)      # line 37
mp = mdiff.filter(...)     # line 38
x=1                        # line 39 (module level)
```

### Log capture mechanism (from `src/extension.ts`)
The extension uses a DAP adapter tracker to intercept debugpy output events:
```typescript
if (cat === 'stdout') {
  appendFileSync(logPath, output);  // all stdout goes to log
} else if (cat === 'console' && output.startsWith('===DATALOG===')) {
  appendFileSync(logPath, '\n\n' + output);  // DATALOG console events
}
```

The logpoint message (from `sasFormatter.ts`) starts with `'\n===DATALOG==='`.
This means the DAP output event's `output` field starts with `\n`, NOT `===DATALOG===`.
So the console check `output.startsWith('===DATALOG===')` **FAILS** for the microdifs logpoint.

### What actually appears in plog.log and why
```
===DATALOG===
df = pl.DataFrame({...})                     ← df logpoint (console, captured)
New dataframe "df" has 4 rows and 4 cols.
name 'microdifs' is not defined              ← error from microdifs logpoint (stdout, always captured)

===DATALOG===
mdiff = buildit(libs)                        ← mdiff logpoint (console, captured)
...
```

The microdifs logpoint IS firing at line 34 inside `buildit`. Its main output
(`===DATALOG===` + source code + "Input dataframe df..." lines) is silently LOST because
the leading `\n` in the message causes the console capture to miss it. Only the expression
**error** leaks through as stdout.

### Why `microdifs` is not accessible — the real root cause

User confirmed: a MANUALLY-placed VS Code logpoint on line 34 (`x=1` inside `buildit`)
with expression `open('debug_log.txt', 'a').write(str(microdifs))` WORKS.

The extension's logpoint is at the SAME LINE but fails. Key differences:
- User's logpoint: **one single `{expr}` block**
- Extension's logpoint: **many separate `{expr}` blocks** across one big string

VS Code evaluates each `{expr}` block by sending a separate `evaluate` request to debugpy.
These requests may be processed **after Python has resumed execution** past the logpoint line.
For a logpoint (non-stopping), Python may have returned from `buildit` by the time later
`{expr}` blocks are evaluated.

Evidence: `df` (a module-level global) IS accessible in earlier expressions even when later
ones fail. Globals survive function return; locals do not.

**Root cause: multi-`{expr}` logpoint messages cause later expressions to be evaluated after
the function frame has been destroyed.**

The `df` expressions (expressions 1–3) happen to evaluate while the frame is still active
(or `df` is accessible as a global even after). The `microdifs` expressions (4–7) are
evaluated after `buildit` has returned.

---

## Two Issues to Fix

### Issue 1: Leading `\n` causes main output to be silently dropped
**File**: `src/sasFormatter.ts` line 137  
**Current**: `parts.push('\n===DATALOG===');`  
**Fix**: `parts.push('===DATALOG===');` (remove leading `\n`)  
Also adjust surrounding formatting so the block doesn't run together with previous output.

### Issue 2: Multiple `{expr}` blocks — later ones evaluate after function returns
**Root fix**: Rewrite `buildLogMessage()` in `src/sasFormatter.ts` to use a **single `{expr}` block**
that captures ALL local variables immediately via lambda default arguments, then formats
the full log message as a string.

**Pattern** (lambda-default-arg trick forces locals capture at first eval moment):
```python
{(lambda _out=microdifs, _in_df=df: (
    'New dataframe "microdifs" has ' + str(_out.shape[0] if hasattr(_out,'shape') else '?') + ' rows'
))()}
```

**Alternative simpler approach**: Write all output directly to the log file inside one expression,
the same way the CSV export already works. A single lambda captures everything at once:
```python
{(lambda _out=microdifs, _in_df=df:
  open('C:/path/to/plog.log', 'a').write(
    'New dataframe "microdifs"...\n'
  ) and '→ logged'
)()}
```

---

## Proposed Redesign of `buildLogMessage()` in `src/sasFormatter.ts`

### Strategy
Replace the current multi-`{expr}` approach with a **single large lambda expression** that:
1. Captures all variables via default args: `_out=microdifs, _in_df0=df, ...`
2. Formats the entire log block as a Python string
3. Writes it to the log file as a side effect (replacing the tracker-based capture)
4. Returns a brief summary for the VS Code debug console

### What to write to the log file
The same content as today, but written via `open(logPath, 'a').write(...)` inside
the single lambda — bypassing the DAP tracker entirely.

### Advantages
- One `{expr}` block → evaluated immediately in the correct frame
- Local variables captured before Python resumes
- No leading `\n` capture issue (we can remove the DAP tracker capture entirely,
  or keep it as fallback for the brief summary string returned by the expression)

### Disadvantages / risks
- `sasFormatter.ts` needs significant rewrite
- `sasFormatter.test.ts` needs substantial test updates  
- The expression becomes longer and harder to read

---

## Files to Change

| File | Change needed |
|------|---------------|
| `src/sasFormatter.ts` | Rewrite `buildLogMessage()` to use single-lambda pattern; remove leading `\n` |
| `src/test/sasFormatter.test.ts` | Update all expression-format tests to match new output |
| `src/extension.ts` | Optionally: remove or simplify the DAP tracker if log is written directly by expression |
| `src/logpointManager.ts` | No changes needed (hitCount already fixed) |
| `src/pythonAnalyzer.ts` | No changes needed |

---

## Alternative: Try `locals()` wrapper first (simpler, might not work)

Before the big rewrite, try wrapping variable references in `locals().get()`:
```python
{(lambda _v=locals().get('microdifs'): _v.shape[0] if hasattr(_v,'shape') else '?')()}
```
`locals()` in a lambda default arg runs at lambda-definition time (same as the single-expr approach).
If the issue is truly that later `{expr}` blocks evaluate after frame exit, this won't help
(because the block itself still runs late). But if the issue is just fast-locals sync,
this would fix it with minimal code changes.

**Try this first** before the full redesign. If it works, only `sasFormatter.ts`
helper functions change slightly. If it doesn't work, do the full single-lambda redesign.

---

## Key Files

| File | Path |
|------|------|
| Main extension | `src/extension.ts` |
| Logpoint expression builder | `src/sasFormatter.ts` |
| Logpoint placement | `src/logpointManager.ts` |
| Python analysis | `src/pythonAnalyzer.ts` |
| Test file | `C:\Users\brent\pythontest\functiony.py` |
| Log file | `C:\Users\brent\pythontest\plog.log` |
