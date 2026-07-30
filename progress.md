# Progress Summary

State as of version 0.2.0. Everything below is implemented and covered by `npm test`.

## How a logpoint works now

VS Code logpoints are evaluated by pydevd as
`eval(expression, frame.f_globals, frame.f_locals)`
(`debugpy/_vendored/pydevd/pydevd.py`, `handle_breakpoint_expression`), after
`convert_dap_log_message_to_expression` turns `{expr}` into `'%s' % (expr,)`.
Two consequences shape the design:

1. **The expression string is recompiled on every hit**, so it must stay short.
   All the logic lives in a generated Python module, `datalog_runtime.py`, which
   each logpoint loads once per process and caches on `builtins` under a
   source-hash key. A logpoint is now just
   `{(lambda _out=..., _in0=...: <load runtime>['datalog_emit'](dict(...)))()}`.
2. **`locals()` and `globals()` inside the expression are the real frame's**, so
   captures use `locals().get('x', globals().get('x', NotImplemented))`. An
   unbound name reports "not in scope" instead of killing the block with a
   NameError. Exceptions in the expression are caught by pydevd and printed, so
   this is the difference between a useful block and a stray error message.

Braces still cannot appear anywhere in the message (VS Code treats them as
expression delimiters), which is why payloads use `dict(...)` and any braces in
the logged source text become `chr(123)`/`chr(125)` pieces.

## Files

| File | Role |
|------|------|
| `src/pythonAnalyzer.ts` | Statement collection, target parsing, detection heuristics, scope tracking, logpoint placement |
| `src/sasFormatter.ts` | Builds the logpoint message; inline fallback when no runtime module could be written |
| `src/pyRuntime.ts` | The generated `datalog_runtime.py` source, plus the loader expression |
| `src/pyExpr.ts` | Python string/path/name helpers shared by the above |
| `src/outputPaths.ts` | Temp folder layout, age pruning, guarded deletion |
| `src/logpointManager.ts` | Creates/removes the managed breakpoints, reports what could not be placed |
| `src/extension.ts` | Settings, commands, debug session lifecycle, plog.log colouring |

## Things that are deliberately the way they are

- **An assignment that is the last statement of a function or file gets no
  logpoint.** A logpoint fires before its line, so there is no line left where
  the value is in scope. `resolveLogLine` returns -1 and the reason is reported
  in the output channel and in the detection report. Placing it on the next
  line anyway is what used to produce `name 'x' is not defined`.
- **`for`/`while` headers are avoided as logpoint targets** because they re-fire
  on every iteration; they are only used when nothing else follows.
- **`for` targets are logged on the loop body's first statement**, so each
  iteration's frame is reported.
- **Tuple unpacking only matches on a name suffix or annotation.** Which element
  of a returned tuple is a frame cannot be guessed from the right-hand side.
- **Generic method names (`.filter()`, `.head()`, `.sort()`) only count on a
  receiver already known to be a frame**; Polars-only names (`.with_columns()`,
  `.group_by()`, `.collect()`) count on any receiver. This is what keeps
  `Model.objects.filter(...)` out of the log.
- **The inline fallback in `sasFormatter.ts` is kept** for the case where no
  temp folder is writable. It has no LazyFrame or error support by design.

## Verification

- `npm test` — 296 checks, including the analyzer, the generated expressions and
  the temp-folder logic.
- `src/test/pyRuntime.test.ts` writes the real runtime module, builds real
  logpoint messages, converts them the way pydevd does and evaluates them
  against real DataFrames and LazyFrames (row/col text, ColumnNotFoundError
  blocks, CSV contents, out-of-scope captures, the builtins cache). Skipped when
  `polars` is not installed for `python3`.
- Also verified by hand against a live `debugpy` session driven over DAP:
  all logpoints verified, one block per assignment, correct counts for
  DataFrames and LazyFrames, the ColumnNotFoundError landing on the assignment
  that introduced it, and CSVs for lazy frames.
