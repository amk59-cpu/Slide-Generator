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
5. **Write the JSON** to an OS-managed temporary file (do not write it into the repo).
6. **Run the generator**, saving the result into `outputs/`:
   ```bash
   node generator/generate_deck.cjs /tmp/input.json outputs/<descriptive_name>.pptx
   ```
7. **Return the `outputs/<descriptive_name>.pptx`** to the user.

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
| `include_metadata_panel` | bool | `false` | — | Show a Test Configuration panel on this slide (see below) |
| `metadata_display_fields` | string[] | `[]` | — | Which metadata fields to display, in order |
| `resolved_metadata` | object | `{}` | field name → string value | The actual values to show for the selected fields |
| `metadata_display_mode` | enum | `"auto"` | `"auto"`, `"compact"`, `"full"` | Force compact strip or full grouped panel, or let field count decide |

---

## Test Configuration Metadata (optional)

Slides can optionally carry a small panel of test-configuration details — hardware,
test type, network settings — rendered as native, editable PowerPoint text/shapes
(never an image). This is entirely optional: a slide with no metadata fields set
renders exactly as it does today, with no reserved space and no panel.

### When to include it

Include metadata on a slide only when the user's request makes it appropriate:

- **Explicit user instruction** — the user tells you the hardware/test details and
  asks for them on the slide(s) ("Helios-R, Turin, 8 MI355 GPUs... put the config
  on the comparison slide").
- **Clearly identified workbook content** — a sheet name, header, or cell
  unambiguously states a value (e.g. a cell literally reading `NIC: Vulcano`).
- **Reliable sheet/workbook context** — e.g. a sheet named `RCCL_AllReduce_MI355`
  clearly implies `test: RCCL BW`, `collective: All-Reduce`, `gpu: MI355`.

**Never invent a value that isn't clearly supported by the prompt or the workbook.**
If a value is ambiguous or missing, either ask the user to clarify or leave that
field out of `metadata_display_fields`/`resolved_metadata` — do not guess. Explicit
user-provided values always take precedence over anything inferred from the
workbook.

Whether to include the panel at all — and on which slides — is entirely your
(the agent's) judgment call based on the user's request. A user might want the
config strip on every slide, only on a "summary"/"comparison" slide, or not at all.

### Field vocabulary

There is no fixed enum — `metadata_display_fields` accepts any short snake_case
key, and `resolved_metadata` maps that key to a free-text string value. Common
fields used in practice:

| Field | Example values |
|-------|----------------|
| `system_type` | `Helios`, `Standalone` |
| `system_variant` | `Helios-R`, `Helios-P`, `Helios-M`, or a standalone vendor/model string (e.g. `Dell PowerEdge R760`) |
| `cpu` | `Turin`, `Venice` |
| `gpu` | `MI355`, `MI455X` |
| `gpu_count` | `8`, `MI355 x8` |
| `nic` | `Pollara`, `Vulcano` |
| `direction` | `Bidirectional`, `Uni-Direction` |
| `test` | `RCCL BW`, `IB BW` |
| `operation` | `Read`, `Write`, `WriteIBMM` |
| `collective` | `All-to-All`, `All-Reduce` |
| `pipeline` | `Hydra`, `Pulsar`, `Quasar` |
| `transport` | `RoCEv2`, `MRC`, `Meta RoCEv2` |
| `packet_spray` | `EV spray`, `DLB`, `SRv6` |
| `vulcano_card` | `Saraceno`, `Mortaro`, `Vulsei` |
| `fw` | a firmware version string |

Use whatever field names and values fit the workbook/prompt — these are examples,
not a closed list.

### Structure

```json
{
  "include_metadata_panel": true,
  "metadata_display_mode": "compact",
  "metadata_display_fields": ["system_variant", "cpu", "gpu", "nic", "test", "direction"],
  "resolved_metadata": {
    "system_variant": "Helios-R",
    "cpu": "Turin",
    "gpu": "MI355 x8",
    "nic": "Vulcano",
    "test": "RCCL BW / All-Reduce",
    "direction": "Bidirectional"
  }
}
```

Only fields listed in `metadata_display_fields` are rendered; extra keys in
`resolved_metadata` are ignored, so it's fine to keep a superset of known values
there and select a subset per slide.

### Display modes

- `"auto"` (default) — compact ribbon for 4 or fewer selected fields, a fuller
  grouped panel (roughly Hardware / Test / Network-FW) for more.
- `"compact"` / `"full"` — force one layout regardless of field count.

The panel geometry is computed dynamically so it never overlaps the chart, legend,
axes, data table, difference plot, or matrix — the chart/table area shrinks to
make room when a panel is present, and is completely unaffected when it isn't.

### Presentation is the generator's job, not yours

Compact Test Configuration metadata uses the generator's standard AMD metadata
ribbon — a small uppercase label over a larger bold value per field, individual
native text objects, a thin gold accent line above the region, subtle vertical
separators between fields, and balanced dynamic-width columns (no fixed field
count, no per-field boxes, no outer rectangle, no pipe-separated text). This is
implemented in `renderMetadataStrip` in `generator/generate_deck.cjs` and applies
automatically to every slide family (`grouped_bar`, `line`, `difference`,
`data_matrix`) whenever compact mode resolves.

**Do not recreate or restyle this per slide or per request.** Claude Code supplies
metadata *content* only:

- `include_metadata_panel`
- `metadata_display_fields`
- `resolved_metadata`
- `metadata_display_mode`

The generator owns metadata *presentation*. Never author styling instructions
into a payload (colors, label/value layout, separators, spacing) — the ribbon
design is fixed and automatic. If a user asks for a visual tweak to the metadata
component itself (not just which fields/values appear), that's a generator code
change, not a per-payload JSON customization.

### Example: config strip only on the comparison slide

> **User:** "Make Vulcano RCCL bandwidth slides. This was Helios-R, Turin, 8 MI355
> GPUs, Saraceno, Meta RoCEv2, DLB. Put the config strip only on the comparison
> slides."

```json
{
  "deck_title": "Vulcano RCCL All-Reduce Bandwidth",
  "tables": { "rccl_allreduce": { "...": "..." } },
  "slides": [
    {
      "table_id": "rccl_allreduce",
      "slide_type": "line",
      "title": "RCCL All-Reduce Bandwidth — Vulcano",
      "category_index": 0,
      "series_indexes": [1, 2]
    },
    {
      "table_id": "rccl_allreduce",
      "slide_type": "difference",
      "title": "Vulcano vs Baseline — RCCL All-Reduce",
      "category_index": 0,
      "series_indexes": [1, 2],
      "include_metadata_panel": true,
      "metadata_display_mode": "compact",
      "metadata_display_fields": ["system_variant", "cpu", "gpu", "nic", "test", "direction"],
      "resolved_metadata": {
        "system_variant": "Helios-R",
        "cpu": "Turin",
        "gpu": "MI355 x8",
        "nic": "Vulcano",
        "test": "RCCL BW / All-Reduce",
        "direction": "Bidirectional",
        "vulcano_card": "Saraceno",
        "transport": "Meta RoCEv2",
        "packet_spray": "DLB"
      }
    }
  ]
}
```

The first slide has no metadata fields and renders exactly as it would without
this feature. The second slide (the "comparison slide") gets the compact strip
with only the 6 fields the user cares most about on that view — `vulcano_card`,
`transport`, and `packet_spray` are still available in `resolved_metadata` in case
a later slide's `metadata_display_fields` wants them, but aren't shown here.

See [schemas/examples/metadata-panel.json](schemas/examples/metadata-panel.json)
for the full runnable version of this example.

### Backward compatibility

This generator is shared with the production web application. All metadata
fields are optional and default to "off" — existing JSON payloads without them
(including all payloads the web app currently sends) continue to render
identically. Do not require metadata to be present, and never change existing
field names or behavior to accommodate it.

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

## Output Rules
- The only persistent output directory is `<repo-root>/outputs/` — save final
  `.pptx` files there (e.g. `outputs/<descriptive_name>.pptx`).
- Use an OS-managed temporary file/directory (e.g. Python's `tempfile`) for the
  intermediate JSON plan passed to the generator. Do not write it into the repo.
- Do NOT create `scratch/`, `output/`, `ouput/`, `preview/`, or any other
  ad hoc directory for generated or intermediate files.
- NEVER write `.pptx` files to the repo root or anywhere other than `outputs/`.
- `outputs/` is gitignored — treat its contents as disposable.

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
