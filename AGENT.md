# Slide Generator — Agent Instructions

## Purpose

Generate PowerPoint presentations (`.pptx`) from uploaded Excel workbook data.  
The user uploads an `.xlsx` file and describes what slides they want.  
You parse the data, construct a JSON payload, and run the generation script.

---

## Workflow

1. **Parse the uploaded Excel file** using `openpyxl` (Python) or equivalent.
2. **Identify the data tables** — each contiguous range of headers + data rows becomes a table entry.
3. **Map user intent to slide requests** — determine slide type, which columns are categories vs. metrics, any grouping or filters.
4. **Construct the JSON payload** conforming to `schema/input.schema.json`.
5. **Write the JSON** to a file (e.g., `input.json`).
6. **Run the generator:**
   ```bash
   node generator/generate_deck.cjs input.json output.pptx
   ```
7. **Return `output.pptx`** to the user.

---

## JSON Payload Structure

The input JSON has two top-level keys:

```json
{
  "deck_title": "My Presentation",
  "tables": { ... },
  "slides": [ ... ]
}
```

### `tables` (required)

An object where each key is a unique table ID. Each table contains the raw data extracted from Excel:

```json
{
  "table_1": {
    "display_name": "Performance Results",
    "sheet_name": "Sheet1",
    "headers": ["Platform", "Bandwidth (GB/s)", "Latency (ms)", "Test Date"],
    "rows": [
      ["Platform A", "142.5", "3.2", "2026-01-15"],
      ["Platform B", "198.7", "2.1", "2026-01-15"]
    ],
    "header_row": 1,
    "start_col": 1,
    "end_col": 4,
    "data_end_row": 10
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `display_name` | string | Human-readable name for the table |
| `sheet_name` | string | Excel worksheet name |
| `headers` | string[] | Column headers (from the header row) |
| `rows` | string[][] | Data rows (all values as strings) |
| `header_row` | int | 1-based row number of headers in Excel |
| `start_col` | int | 1-based first column index |
| `end_col` | int | 1-based last column index |
| `data_end_row` | int | 1-based last data row in Excel |

### `slides` (required)

An array of slide request objects. Each produces one slide in the output deck.

---

## Slide Request Fields

| Field | Type | Default | Constraints | Description |
|-------|------|---------|-------------|-------------|
| `table_id` | string | *(required)* | Must match a key in `tables` | Which table this slide uses |
| `slide_type` | enum | `"grouped_bar"` | `"grouped_bar"`, `"line"`, `"difference"`, `"data_matrix"` | Chart/table type |
| `title` | string | *(required)* | 1–180 chars | Slide title |
| `category_index` | int | `0` | 0-based column index | Which column is the X-axis / category |
| `series_indexes` | int[] | `[]` | Max 12, unique values | Which columns are Y-axis metrics |
| `group_by_indexes` | int[] | `[]` | Max 3, unique values | Columns to split series by |
| `filters` | object | `{}` | Keys = column index (string), values = string[] (max 50 per key) | Row-level filters |
| `aggregation` | enum | `"auto"` | `"auto"`, `"none"`, `"mean"`, `"median"`, `"max"`, `"min"`, `"sum"` | How to handle duplicate categories |
| `sort_categories` | bool | `true` | — | Sort X-axis values (numeric-aware) |
| `x_axis_title` | string | `""` | — | Label below X-axis |
| `y_axis_title` | string | `"Value"` | — | Label beside Y-axis |
| `show_data_table` | bool | `false` | — | Show a numeric data table beside the chart |
| `label_simplify` | bool | `false` | — | Strip dates and run details from labels |
| `label_replacements` | string | `""` | Max 4000 chars | Newline-separated `from => to` rules for renaming labels |
| `label_max_length` | int | `40` | 12–90 | Truncate labels beyond this length |

---

## Slide Types

### `grouped_bar`
Clustered vertical bar chart. Best for comparing discrete categories across multiple metrics.
- Requires: `category_index` + at least one `series_indexes` entry
- Sampled to max 36 categories (30 if `show_data_table` is true)

### `line`
Line chart with data-point markers. Best for trends over ordered categories (e.g., time, sizes).
- Requires: `category_index` + at least one `series_indexes` entry
- No category sampling — shows all points

### `difference`
Relative difference chart. Compares series[1..n] against series[0] as baseline.
- With 2+ series: computes `(value - baseline) / |baseline|` per category
- With 1 series: renders raw values as positive/negative bars
- Sampled to max 36 categories (30 with data table)

### `data_matrix`
Full data table rendered directly on the slide. No chart.
- Does NOT require `series_indexes` — renders all columns
- Max 12 columns displayed, max 20–24 rows
- `category_index` is ignored for rendering but must still be valid

---

## Limits & Constraints

| Limit | Value |
|-------|-------|
| Max series on chart | 10 (excess series silently dropped with note) |
| Max series in data table | 3 |
| Max rows in data table | 8 |
| Max slides per deck | 300 |
| Max filters per column | 50 values |
| Max group_by columns | 3 |
| Max series_indexes | 12 |
| Label max length | 12–90 characters |

---

## Aggregation Modes

When duplicate category values exist (same X-axis label appears in multiple rows):

| Mode | Behavior |
|------|----------|
| `auto` | Median if >1 value, otherwise raw value |
| `none` | Use last occurrence |
| `mean` | Arithmetic average |
| `median` | Middle value |
| `max` | Highest value |
| `min` | Lowest value |
| `sum` | Total of all values |

---

## Validation Rules

Before running the script, verify:

1. Every `table_id` in `slides` exists as a key in `tables`
2. `category_index` is within bounds: `0 <= category_index < len(headers)`
3. All `series_indexes` values are within bounds and != `category_index`
4. All `group_by_indexes` values are within bounds, != `category_index`, and not in `series_indexes`
5. Filter keys (as integers) are valid column indexes
6. `title` is 1–180 characters, not blank
7. At least one slide in the `slides` array
8. For chart types (`grouped_bar`, `line`, `difference`): at least one entry in `series_indexes`
9. For `data_matrix`: `series_indexes` can be empty (renders all columns)

---

## Error Messages

The script throws clear errors for:
- `"Invalid category column for {table_name}"` — `category_index` out of range
- `"Select at least one metric for {table_name}"` — empty `series_indexes` for chart type
- `"No graphable rows remained for {table_name}"` — filters removed all data
- `"The source table '{id}' is no longer available"` — `table_id` not found in `tables`
- `"Unsupported slide type: {type}"` — invalid `slide_type` value

---

## Label Processing

Labels go through this pipeline:
1. `label_replacements` rules applied (find/replace, case-insensitive)
2. If `label_simplify` is true: dates, run IDs, and test details are stripped
3. Truncated to `label_max_length` with `…` suffix

Use `label_replacements` format (one rule per line):
```
Original Text => Replacement Text
AMD Instinct MI300X => MI300X
NVIDIA H100 SXM => H100
```

---

## Example: Minimal Single Slide

```json
{
  "deck_title": "Q3 Bandwidth Comparison",
  "tables": {
    "perf_data": {
      "display_name": "Bandwidth Results",
      "sheet_name": "Results",
      "headers": ["GPU", "Read BW (GB/s)", "Write BW (GB/s)"],
      "rows": [
        ["MI300X", "5200", "4800"],
        ["H100", "3350", "3100"],
        ["A100", "2039", "1900"]
      ],
      "header_row": 1,
      "start_col": 1,
      "end_col": 3,
      "data_end_row": 4
    }
  },
  "slides": [
    {
      "table_id": "perf_data",
      "slide_type": "grouped_bar",
      "title": "Memory Bandwidth Comparison",
      "category_index": 0,
      "series_indexes": [1, 2],
      "y_axis_title": "GB/s"
    }
  ]
}
```

Run:
```bash
node generator/generate_deck.cjs input.json slides.pptx
```

---

## Important Notes

- All numeric parsing is handled by the script — store values as strings in `rows`
- The script auto-detects numeric formats including units (GB/s, ms, %, etc.)
- Categories are sorted numerically when ≥80% of values parse as numbers
- The presentation uses a dark theme (black background, gold/cyan accents)
- Output is a standard `.pptx` file openable in PowerPoint, LibreOffice, Google Slides
