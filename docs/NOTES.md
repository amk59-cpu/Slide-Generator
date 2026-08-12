# Parser and Slide Design

## Reliability model

The generator separates two concerns:

1. **Workbook interpretation** — locate data regions and identify the role of each column.
2. **Slide rendering** — transform an approved mapping into a consistent presentation layout.

This separation is important. A new benchmark can have a different schema while still using the same slide visual language.

## Detection pipeline

For each worksheet, the parser:

1. finds contiguous candidate header regions;
2. collects the numeric data rows below each candidate;
3. removes empty edge columns and deduplicates overlapping detections;
4. classifies columns as:
   - **Dimension** — size, platform, build, trial, QP, thread, context, model, configuration;
   - **Metric** — bandwidth, throughput, latency, MFU, duration, performance;
   - **Delta** — difference, percentage change, gain, regression;
   - **Annotation** — notes, comments, URLs, descriptions;
5. assigns a confidence score and warnings;
6. recommends a category, metrics, grouping dimensions, repeated-value handling, chart type, axis labels, and whether a visible table will remain readable.

The renderer only receives the mapping approved in the frontend.

## Patterns found in the provided benchmark workbooks

The regression set currently covers five distinct families:

| Workbook family | Pattern handled | Validation result |
|---|---|---:|
| RCCL comparisons | Many worksheets; several collective tests per sheet; message-size category; platform/build comparison series; adjacent delta columns | 139 worksheets, 1,137 data regions detected |
| Vulcano IB comparisons | Repeated horizontal IB Write/Write Imm blocks; message-size sweeps; 1–64 QP series | 12 worksheets, 85 data regions detected |
| rocSHMEM / DeepEP | Long-form thread/context/size experiments with repeated trials; compact and headerless result blocks | 9 worksheets, 17 data regions detected |
| Packet sweep | Trial and iteration dimensions; frame-size sweep; throughput, latency, loss, and integrity metrics | 1 worksheet, 1 full 559-row region detected |
| Training experiments | Compact platform comparisons plus large configuration matrices; MFU and time-to-solution metrics among many dimensions | 16 worksheets, 106 data regions detected |

These counts represent the supplied regression files, including low-confidence alternatives. The frontend labels the strongest matches and lets the user search or filter by worksheet. Nothing is selected automatically.

## Quality safeguards

- **Identifiers are not plotted by default.** Trial, iteration, run, rank, and timed-message fields are treated as dimensions.
- **Unlike units are not mixed automatically.** The default metric selection avoids putting percentages, days, counts, latency, and bandwidth on the same axis.
- **Repeated values are summarized deliberately.** Median is preferred when trial-like identifiers exist; mean is suggested for repeated categories without a trial identifier.
- **Dense series are bounded.** The renderer displays at most ten chart series and asks the user to filter when a mapping would become unreadable.
- **Dense bar charts are sampled.** Line charts preserve every category. Grouped and difference bar charts sample up to 36 categories and add a note so hundreds of unreadable bars are not silently produced.
- **Data tables are optional.** Grouped bar, line, and difference slides can use the full-width chart or the baseline chart-plus-table geometry. Matrix slides use a dedicated table layout. The generated table no longer has a yellow line through it or a generated footer label. Matrix slides use a dedicated table layout.
- **Large tables are visible, not hidden.** Data-matrix slides show a readable subset and state when additional rows or columns exist.
- **Source traceability is preserved.** Generated slides include source worksheet and range information in speaker notes.

- **Only compatible slide types are shown.** The frontend hides grouped bar, line, or difference options when the selected data shape would produce a poor or misleading slide. Matrix remains available as the fallback table-first view.
- **The supported chart family is intentionally small.** The app now focuses on grouped bar, line, difference, and matrix slides rather than trying to turn every data shape into a different visual.

## Recommended workflow for new benchmark formats

1. Save the workbook as `.xlsx` and recalculate formulas in Excel before upload.
2. Analyze it and inspect the recommended table ranges.
3. Confirm that the category is the independent dimension, such as message size or frame size.
4. Confirm that selected metrics share a meaningful unit.
5. Use filters for a single build/configuration, or use one grouping field to create comparison series.
6. Keep charts under roughly ten series; create separate slides when the experiment has more dimensions.
7. Turn the data table on only when the category and series counts remain readable.

## Next hardening steps

The strongest future improvements would be:

1. **Named parser profiles** for recurring schemas, such as RCCL, IB Write BW, packet sweep, rocSHMEM, and training experiments. A profile can enforce known columns while retaining the generic fallback.
2. **Manual range selection** for a sheet that has no reliable automatic detection.
3. **Saved mapping presets** keyed by workbook family rather than by one specific file.
4. **Regression fixtures** with expected table ranges, roles, and slide snapshots for every approved workbook family.
5. **Validation rules** that flag mixed units, excessive series, missing cached formula values, or unexpectedly sparse regions before generation.

The current build implements the generic profiling layer and the supplied-workbook regression pass. It is designed so these hardening layers can be added without redesigning the PowerPoint renderer.


## Slide-quality rules

The renderer intentionally supports only four slide families: grouped bar, line, difference, and data matrix. This keeps the app reliable for performance benchmark data instead of offering chart types that frequently misrepresent the source workbook.

Slide-type availability is now gated by the detected data shape:

- **Grouped bar**: available when the selected category count is small enough to read clearly.
- **Line**: available for ordered categories such as size sweeps, numeric sweeps, dates, message sizes, packet sizes, frame sizes, and input sizes. It is hidden for ordinary categorical labels because connecting unrelated categories implies a trend that may not exist.
- **Difference**: available only for comparable metrics or explicit delta columns.
- **Data matrix**: always available as a safe fallback for dense tables, mixed units, and categorical data that should not be forced into a chart.

Optional data tables are rendered as compact dark tables with subtle gridlines and no explanatory footnote unless the data has been sampled or truncated.
