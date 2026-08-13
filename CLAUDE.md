# Slide Generator — Claude Code Instructions

This repo turns Excel workbooks into PowerPoint decks via Claude Code (or another
agent) driving `generator/generate_deck.cjs` directly. There is no web server or
browser UI — see [PROMPT_TEMPLATE.md](PROMPT_TEMPLATE.md) for the request format
teammates should use when asking for slides.

## When a user wants slides generated from an Excel file

Follow the agent workflow documented in [AGENT.md](AGENT.md). Summary:

1. Read the user's `.xlsx` file with `openpyxl` (Python) — identify sheets, headers, and
   data rows relevant to what the user wants graphed.
2. Clarify with the user if their request is ambiguous: which sheet/table, which column
   is the category (X-axis) vs. metric (Y-axis) column(s), any filters (e.g. a specific
   config instead of averaging across all rows), chart type, and labels.
3. Construct a JSON payload matching [schemas/input.schema.json](schemas/input.schema.json)
   — a `tables` object with raw headers/rows extracted from Excel, and a `slides` array
   describing each requested slide. See [schemas/examples/](schemas/examples/) for worked
   examples.
4. Write the JSON to an OS-managed temporary file and run the generator directly,
   saving the result into `outputs/`:
   ```bash
   node generator/generate_deck.cjs /tmp/input.json outputs/<descriptive_name>.pptx
   ```
5. Validate the output is a real `.pptx` (non-empty, valid zip) and return it to the user.

## What NOT to do

- Do not commit generated `.pptx` output files into the repo unless the user asks.
- Do not push commits or open a PR unless the user explicitly asks.

## PowerPoint Output Validation

- The currently tested presentation-generation workflow has been manually verified in desktop Microsoft PowerPoint.
- The generated PPTX opened without a repair, retry, recovery, or unreadable-content prompt.
- Do not assume that the PPTX package is corrupted based only on source-code inspection.
- Before changing Open XML, slide relationships, package parts, or private PowerPoint-library internals, reproduce the problem with an actual failing PPTX and the exact generation input and execution path.
- Image-rendered charts and tables are a separate editability and feature concern. Their presence is not evidence that the PPTX is corrupted.
- Changes to presentation generation must preserve the verified behavior that generated PPTX files open normally in desktop PowerPoint.
- Do not implement speculative PPTX-repair changes when no failing presentation can be reproduced.
