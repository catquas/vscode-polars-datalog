# Datalog for Polars

Datalog for Polars is a VS Code extension that automatically adds debug logpoints after Polars DataFrame and LazyFrame assignments. When you run a Python/debugpy session, it writes SAS-style notes on each DataFrame to the Debug Console and to `plog.log`, and if enabled, exports the top X rows of each DataFrame files to a workspace folder such as `worklib/`.

It is built for quick inspection while debugging Polars pipelines: column counts, input/output DataFrame relationships, and small CSV snapshots without adding temporary `print()` or `write_csv()` calls to your code.

## What It Does

When a Python debug session starts, the extension scans visible Python editors and adds managed logpoints after detected DataFrame assignments. For example:

```python
result_df = input_df.filter(pl.col("age") > 25)
```

produces output like:

```text
===DATALOG===
result_df = input_df.filter(pl.col("age") > 25)
Input dataframe "input_df" has 100 rows and 4 columns.
New dataframe "result_df" has 42 rows and 4 columns.
```

By default, the same DATALOG blocks are written to `plog.log`, and the first 1000 rows of each DataFrame are exported to `worklib/<dataframe-variable-name>.csv`.

## Quick Start

1. Open a workspace folder in VS Code. *It will not work if you just have a python file open!*
2. Open the Python file you want to debug.
3. Start a Python/debugpy debug session.
4. Open `plog.log` with `Ctrl+Alt+P`, or use the command palette: `Datalog: Open plog.log`.
5. Open the sample CSV folder with `Ctrl+Alt+W`, or use `Datalog: Focus worklib Folder in Explorer`.

The extension only scans visible Python editors, so keep the files you care about open when starting or refreshing a debug session.

## Commands

| Command | What it does |
| --- | --- |
| `Datalog: Refresh Logpoints` | Re-scan visible Python editors and recreate managed logpoints. |
| `Datalog: Clear All Logpoints` | Remove all managed Datalog logpoints. |
| `Datalog: Focus worklib Folder in Explorer` | Reveal the configured sample output folder in VS Code Explorer. |
| `Datalog: Open plog.log` | Open the configured log file. |
| `Datalog: Open CSV for Variable` | Open `worklib/<dataframe-varName>.csv` for the variable under the cursor. Also appears in the editor context/right-click menu. |

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
  "vscode-datalog.exportSamples": true,
  "vscode-datalog.sampleRows": 1000,
  "vscode-datalog.sampleOutputFolder": "worklib",
  "vscode-datalog.logFile": "plog.log",
  "vscode-datalog.logExtensionOutput": false,
  "vscode-datalog.logTimestampLines": false
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `vscode-datalog.enabled` | `true` | Enables automatic logpoint injection. |
| `vscode-datalog.polarsAlias` | `"pl"` | Polars import alias, as in `import polars as pl`. |
| `vscode-datalog.dfNameSuffixes` | `["_df", "df", "_data"]` | Variable suffixes treated as likely DataFrames. |
| `vscode-datalog.exportSamples` | `true` | Writes sample CSV files during debugging. |
| `vscode-datalog.sampleRows` | `1000` | Number of rows written to each sample CSV. |
| `vscode-datalog.sampleOutputFolder` | `"worklib"` | Workspace-relative folder for CSV output. |
| `vscode-datalog.logFile` | `"plog.log"` | Workspace-relative log file for DATALOG output. |
| `vscode-datalog.logExtensionOutput` | `false` | Also write extension diagnostics to `plog.log`, such as scanned files and detected assignments. Useful when debugging the extension itself. |
| `vscode-datalog.logTimestampLines` | `false` | Adds `[HH:MM:SS] var: N obs x M vars` summary lines before DATALOG blocks in `plog.log`. |

## DataFrame Detection

Datalog detects assignments using a few practical heuristics:

- Variable names ending in configured suffixes such as `_df`, `df`, or `_data`.
- Polars constructors and readers such as `pl.DataFrame()`, `pl.read_csv()`, `pl.read_parquet()`, and `pl.scan_csv()`.
- Transformations chained from known DataFrame variables, such as `.filter()`, `.select()`, `.join()`, `.group_by()`, `.with_columns()`, and `.collect()`.
- Subscript chains such as `libs["df"].filter(...)`.
- Calls to functions annotated as returning `pl.DataFrame` or `pl.LazyFrame`.

## Regular Python Variables

Datalog also detects simple `print(var_name)` statements for ordinary Python values and turns them into logpoints that print `repr(var_name)`.

```python
customer_id = "A-1029"
row_count = 42
threshold = 0.75

print(customer_id)
print(row_count)
print(threshold)
```

This feature is for regular Python values such as strings, numbers, booleans, lists, dictionaries, and small objects. It is not meant for Polars DataFrames or LazyFrames. For Polars variables, use normal assignments so Datalog can show row/column counts and write CSV samples.

The output looks like:

```text
===DATALOG=== customer_id='A-1029'
===DATALOG=== row_count=42
===DATALOG=== threshold=0.75
```

## Output Files

`plog.log` is cleared at the start of each Python/debugpy debug session. Runtime DATALOG blocks are written directly from the generated logpoint expression, so DataFrames created inside functions are captured while local variables are still in scope.

CSV samples are written only for objects with `write_csv`, so LazyFrames are logged but skipped for CSV export. The output file name is based on the variable name:

```text
worklib/result_df.csv
worklib/customer_df.csv
```

## Notes and Tips

- Use `Datalog: Refresh Logpoints` after opening another Python file during an active debug session.
- Use `Datalog: Clear All Logpoints` if you want to temporarily get Datalog out of the way.
- If your Polars alias is not `pl`, set `vscode-datalog.polarsAlias`.
- If a DataFrame is not detected, add a suffix such as `_df`, or add a return annotation like `-> pl.DataFrame`.
- To debug Datalog's own scanning behavior, enable:

```json
{
  "vscode-datalog.logExtensionOutput": true
}
```

This adds extension diagnostics to `plog.log` alongside runtime DATALOG output.
