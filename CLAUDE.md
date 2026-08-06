# Slide Generator — Claude Code Instructions

This repo is a working web application (`app/`, `web/`) that turns Excel workbooks into
PowerPoint decks. It already runs in production for users via the browser UI. Do not
modify `app/server.py`, `app/workbook.py`, `app/schemas.py`, `app/renderer.py`, or `web/`
unless the user explicitly asks for a code change to the web app itself.

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
4. Write the JSON to a scratch file and run the generator directly:
   ```bash
   node generator/generate_deck.cjs input.json output.pptx
   ```
5. Validate the output is a real `.pptx` (non-empty, valid zip) and return it to the user.

This path calls `generator/generate_deck.cjs` — the same rendering engine the web app
uses — directly, bypassing `app/server.py` and the browser's auto-detection parser
entirely. It cannot break or interfere with the running web application, and requires no
repo code changes to use.

## What NOT to do

- Do not run or modify the FastAPI server (`app/server.py`) to service an agent request.
- Do not edit `app/workbook.py`'s auto-detection logic to fit one Excel file's shape.
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
