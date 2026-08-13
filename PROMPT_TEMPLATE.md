# Slide Generation — Prompt Template

Use this template when asking an agent (Claude Code or similar) to generate slides
from an Excel workbook using this repo. Filling it in up front avoids two common
failure modes we've hit:

1. **The agent bypasses this repo's generator** and writes an ad-hoc script
   instead of using `generator/generate_deck.cjs` per `AGENT.md`/`CLAUDE.md`.
2. **The agent chases false "corruption" reports.** A file that "won't open" is
   often a OneDrive sync placeholder, a permissions issue, or a stale preview
   cache — not a broken `.pptx`. See `CLAUDE.md`'s validation section before
   assuming the generator produced a bad file.

Copy the block below, fill in the brackets, and lead with it.

---

## Template

```
Repo: amd/Slide-Generator (or wherever this repo lives for you)
Before doing anything else: read AGENT.md and CLAUDE.md in this repo and follow
the documented workflow. Use generator/generate_deck.cjs — do not write a custom
script to build the deck.

Excel file: [path to .xlsx]
Sheet(s) / build tag: [e.g. "1.125.0-a-118+RRx_Latest"]

Slide(s) wanted:
- [Test name, e.g. "IB Write Uni-Direction"]
  - Category (X-axis): [e.g. Msg Size]
  - Metric/series (Y-axis): [e.g. 64 QP column, or list multiple columns]
  - Slide type: [line / grouped_bar / difference / data_matrix — see AGENT.md]
  - Filters (if any): [e.g. only rows where QP = 64]
  - Axis titles: [X: ..., Y: ...]

Test configuration metadata (only if you want it shown on the slide):
  - [e.g. system_variant: Helios-R, cpu: Turin, gpu: MI355 x8, nic: Vulcano]
  - Which slides should show it: [all / only comparison slide / none]

Output: save to outputs/<descriptive_name>.pptx per AGENT.md's output rules.

If the resulting file won't open or preview:
- First check it's a valid zip/OPC package (structural check), and whether the
  file lives under OneDrive/SharePoint sync (placeholder/sync issue is common).
- Don't assume the generator is broken without reproducing the failure with the
  actual file and exact generation command.
```

---

## Why this matters

- **Point at the generator, not a rebuild.** This repo already has a tested,
  shared rendering engine (`generator/generate_deck.cjs`) used by both the web
  app and the agent workflow. Asking an agent to "make a slide" without pointing
  it at `AGENT.md` risks it reinventing chart/theme logic from scratch, with
  inconsistent styling and no guarantee of opening correctly in PowerPoint.
- **Save agent time on false alarms.** Files inside OneDrive/SharePoint-synced
  folders can appear as cloud placeholders that Explorer/PowerPoint can't open
  until sync completes — this looks identical to a corrupted file from the
  outside. Mentioning the file's location up front (synced folder vs. local
  disk) heads off unnecessary debugging.
- **One request, one deck.** Listing every slide you want up front (with X/Y
  columns and slide type) lets the agent build one JSON payload and one
  generator run, instead of iterating slide-by-slide.
