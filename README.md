# Datalog for Polars

Datalog for Polars is a VS Code extension that automatically adds debug logpoints after Polars DataFrame and LazyFrame assignments. When you run a Python/debugpy session, it writes SAS-style notes on each frame to the Debug Console and to `plog.log`, and exports the top X rows of each frame to a sample folder such as `worklib/`.

It is built for quick inspection while debugging Polars pipelines: row and column counts, input/output frame relationships, the first error in a lazy pipeline, and small CSV snapshots — without adding temporary `print()` or `write_csv()` calls to your code.

## What It Does

When a Python debug session starts, the extension scans open Python files in the current workspace and adds managed logpoints after detected frame assignments. For example:

```python
result_df = input_df.filter(pl.col("age") > 25)
```

produces output like:

```text
===DATALOG=== etl.py:12
result_df = input_df.filter(pl.col("age") > 25)
Input dataframe "input_df" has 100 rows and 4 columns.
New dataframe "result_df" has 42 rows and 4 columns.
```

The same blocks are written to `plog.log`, and the first 1000 rows of each frame are exported to `<sample folder>/<variable-name>.csv`.

## Quick Start

1. Open a workspace folder in VS Code. *It will not work if you just have a python file open!*
2. Open the Python file you want to debug.
3. Start a Python/debugpy debug session.
4. Open `plog.log` with `Ctrl+Alt+P`, or use the command palette: `Datalog: Open plog.log`.
5. Open the sample CSV folder with `Ctrl+Alt+W`, or use `Datalog: Focus worklib Folder in Explorer`.

The extension scans open Python files in the workspace, so keep the files you care about open when starting or refreshing a debug session.

## LazyFrames

LazyFrames are handled like DataFrames, and by default Datalog collects a sample of each one so you get real row counts and CSV files:

```text
===DATALOG=== etl.py:20
london = enriched.filter(pl.col("city") == "London")
Input lazyframe "enriched" has 5 rows and 4 columns.
New lazyframe "london" has 2 rows and 4 columns.
```

How much work Datalog may do is controlled by `vscode-datalog.lazyFrames`:

| Mode | Columns | Rows | CSV sample | Executes your query |
| --- | --- | --- | --- | --- |
| `off` | – | – | – | no |
| `schema` | yes | – | – | no |
| `count` | yes | yes | – | yes, aggregate only |
| `sample` (default) | yes | yes | yes | yes |

`sample` runs the query plan at every logged assignment. On a heavy pipeline that gets slow, so drop to `schema` (or `off`) if you notice your debug session dragging — `schema` resolves the plan's schema without executing anything.

### Finding where a lazy pipeline broke

This is what makes the lazy support worth having. A lazy pipeline only fails when you finally collect it, far from the line that actually introduced the mistake. Datalog inspects every intermediate frame, so the first block with an `ERROR` line is the assignment that broke:

```text
===DATALOG=== etl.py:22
broken = enriched.select(pl.col("citty"))
Input lazyframe "enriched" has 5 rows and 4 columns.
New lazyframe "broken" has unknown size.
ERROR: lazyframe "broken" failed to evaluate: ColumnNotFoundError: unable to find column "citty"; valid columns: ["name", "age", "city", "double_age"]
    Did you mean "city"?
    Resolved plan until failure:
    ---> FAILED HERE RESOLVING 'select' <---
```

`ERROR` lines are shown in red in `plog.log`. Schema errors like this one are caught even in `schema` mode, because resolving a schema is enough to surface them — no query execution required.

The errors come from Polars itself, the same way `polars.testing.assert_frame_equal` reports them: it has no special evaluation machinery, it just collects the frame. Datalog does the same collection deliberately, one assignment at a time, and catches the exception so a broken stage reports itself instead of ending your debug session.

## Output Files

By default everything is written to a per-workspace folder inside your OS temp directory, and cleaned up for you:

```text
<temp>/vscode-datalog/<workspace-name>-<hash>/
    datalog_runtime.py    the Python helper the logpoints load
    plog.log
    worklib/result_df.csv
```

- Files older than `vscode-datalog.tempRetentionHours` (12 by default) are deleted when VS Code starts, so yesterday's run is gone in the morning.
- The whole folder is deleted when VS Code closes, unless you turn off `vscode-datalog.deleteTempOnClose`.
- Datalog only ever deletes inside its own `vscode-datalog` temp folder.

To keep the files in your project instead — visible in the Explorer and surviving restarts — set:

```json
{ "vscode-datalog.outputLocation": "workspace" }
```

`plog.log` is cleared at the start of each debug session either way. `Ctrl+Alt+P` and `Ctrl+Alt+W` follow the setting, so you do not need to know where the files live.

`datalog_runtime.py` is a generated file that the logpoints import once per debug session. Keeping the logic in a module rather than inline in every logpoint keeps the logpoint expressions short, which matters because the debugger recompiles them on every hit. It is safe to read and safe to delete — `Datalog: Refresh Logpoints` rewrites it.

## Commands

| Command | What it does |
| --- | --- |
| `Datalog: Refresh Logpoints` | Re-scan open workspace Python files and recreate managed logpoints. |
| `Datalog: Clear All Logpoints` | Remove all managed Datalog logpoints. |
| `Datalog: Focus worklib Folder in Explorer` | Reveal the configured sample output folder. |
| `Datalog: Open plog.log` | Open the configured log file. |
| `Datalog: Open CSV for Variable` | Open the CSV for the variable under the cursor. Also in the editor right-click menu. |
| `Datalog: Explain DataFrame Detection in This File` | Report, in the Datalog output channel, every assignment in the active file and why it was or was not logged. |
| `Datalog: Clear Temporary Output` | Delete this workspace's temporary Datalog folder now. |

## Keyboard Shortcuts

| Shortcut | Command |
| --- | --- |
| `Ctrl+Alt+W` | `Datalog: Focus worklib Folder in Explorer` |
| `Ctrl+Alt+P` | `Datalog: Open plog.log` |

## Settings

All settings live under `vscode-datalog` in your VS Code settings.json file.

```json
{
  "vscode-datalog.enabled": true,
  "vscode-datalog.polarsAlias": "pl",
  "vscode-datalog.dfNameSuffixes": ["_df", "df", "_data"],
  "vscode-datalog.lazyFrames": "sample",
  "vscode-datalog.exportSamples": true,
  "vscode-datalog.sampleRows": 1000,
  "vscode-datalog.sampleOutputFolder": "worklib",
  "vscode-datalog.logFile": "plog.log",
  "vscode-datalog.outputLocation": "temp",
  "vscode-datalog.tempRetentionHours": 12,
  "vscode-datalog.deleteTempOnClose": true,
  "vscode-datalog.logExtensionOutput": false,
  "vscode-datalog.logTimestampLines": false
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `vscode-datalog.enabled` | `true` | Enables automatic logpoint injection. |
| `vscode-datalog.polarsAlias` | `"pl"` | Polars import alias, as in `import polars as pl`. |
| `vscode-datalog.dfNameSuffixes` | `["_df", "df", "_data"]` | Variable suffixes treated as likely frames. |
| `vscode-datalog.lazyFrames` | `"sample"` | How much work Datalog may do to describe a LazyFrame: `off`, `schema`, `count` or `sample`. |
| `vscode-datalog.exportSamples` | `true` | Writes sample CSV files during debugging. |
| `vscode-datalog.sampleRows` | `1000` | Number of rows written to each sample CSV, and the number collected from a LazyFrame in `sample` mode. |
| `vscode-datalog.sampleOutputFolder` | `"worklib"` | Folder name for CSV output. |
| `vscode-datalog.logFile` | `"plog.log"` | File name for DATALOG output. |
| `vscode-datalog.outputLocation` | `"temp"` | `temp` writes to a pruned OS temp folder; `workspace` writes into the workspace root. |
| `vscode-datalog.tempRetentionHours` | `12` | Delete temporary output older than this at startup. `0` keeps it until you clear it. |
| `vscode-datalog.deleteTempOnClose` | `true` | Delete this workspace's temporary output when VS Code closes. |
| `vscode-datalog.logExtensionOutput` | `false` | Also write extension diagnostics to the log file, such as scanned files and detected assignments. |
| `vscode-datalog.logTimestampLines` | `false` | Adds `[HH:MM:SS] var: N obs x M vars` summary lines before DATALOG blocks. |

## Frame Detection

Datalog detects assignments using practical heuristics, in this order:

- A type annotation on the target: `frame: pl.LazyFrame = ...`.
- Variable names ending in a configured suffix such as `_df`, `df` or `_data` — including tuple unpacking (`train_df, test_df = split(raw)`), attributes (`self.raw_df = ...`) and `for` targets (`for key, part_df in ...`).
- Polars constructors and readers: `pl.DataFrame()`, `pl.read_csv()`, `pl.scan_parquet()`, `pl.from_dicts()` and the rest of the `read_*`/`scan_*`/`from_*` family, whether called through the alias or imported with `from polars import read_csv`.
- Any frame method chained on a variable Datalog already knows about, including generic names like `.filter()`, `.head()` or `.sort()`.
- Methods only Polars frames have — `.with_columns()`, `.group_by()`, `.collect()`, `.unpivot()`, `.drop_nulls()` and similar — on *any* receiver, so `out = load_data().with_columns(...)` and `out = self.data.group_by(...)` are picked up too.
- Calls to functions annotated as returning a frame, including `-> "pl.DataFrame"`, `-> pl.LazyFrame | None` and functions in another open Python file in the same workspace. `-> pd.DataFrame` and `-> tuple[pl.DataFrame, ...]` are correctly ignored.
- Parameters annotated as frames, so `out = raw.filter(...)` is detected inside `def build(raw: pl.LazyFrame)`.

### When a frame is not picked up

Run `Datalog: Explain DataFrame Detection in This File`. It lists every assignment in the file with the reason it matched, or the reason it did not:

```text
Datalog detection report for /home/me/proj/etl.py
  Detected 4 frame assignment(s), skipped 2 other assignment(s).
  ✓ line 12: result_df — name ends with "_df"
  ✓ line 20: enriched — calls enrich(), annotated as returning a frame
  ✓ line 31: totals — calls .group_by(), which only Polars frames have
      but no logpoint: no statement follows it inside the same function, so
      there is no line where the value is in scope
  · line 27: row_count — no Polars signal — rename to row_count_df, annotate it
      as pl.DataFrame, or annotate the function it calls
```

Two things worth knowing:

- **Where the logpoint goes.** A logpoint runs *before* its line, so Datalog attaches it to the next statement that runs after the assignment while the value is still in scope. If an assignment is the very last statement of a function, or the last line of the file, there is no such line and it cannot be logged — add a statement after it (even `pass`) if you need that value. The report says so explicitly rather than logging nothing.
- **Names that are not in scope.** If Datalog reads a value that turns out not to be bound on that line, the block says `"x" is not in scope on this line` instead of losing the whole block to a `NameError`.

## Regular Python Variables

Datalog also detects simple `print(var_name)` statements for ordinary Python values and turns them into logpoints:

```python
customer_id = "A-1029"
row_count = 42
settings = {"path": "in.csv", "rows": 12}

print(customer_id)
print(row_count)
print(settings)
```

```text
===DATALOG=== customer_id='A-1029'
===DATALOG=== row_count=42
===DATALOG=== settings={
  'path': 'in.csv',
  'rows': 12
}
```

Dictionaries are printed compactly (first 8 entries, first 5 items of each nested sequence or Series). Printing a DataFrame shows its shape and the usual Polars table; printing a LazyFrame shows its shape rather than dumping a query plan.

## Notes and Tips

- Use `Datalog: Refresh Logpoints` after opening another Python file during an active debug session.
- Use `Datalog: Clear All Logpoints` if you want to temporarily get Datalog out of the way.
- If your Polars alias is not `pl`, set `vscode-datalog.polarsAlias`.
- If a frame is not detected, run the detection report — it names the fix.
- If a debug session feels slow, set `vscode-datalog.lazyFrames` to `schema`.
- Output paths are resolved on the machine running the extension, so debugging inside a container or over a remote interpreter with a different filesystem will not find them.
- To debug Datalog's own scanning behaviour, enable:

```json
{ "vscode-datalog.logExtensionOutput": true }
```

## Development

```bash
npm test     # compiles with tsc, then runs the test suite
```

The suite covers the analyzer, the generated Python expressions and the temp-folder handling. When `python3` with `polars` installed is available, it also writes the real runtime module, builds real logpoint messages, converts them the way the debugger does and evaluates them against real DataFrames and LazyFrames. Those tests are skipped when Polars is not installed.
