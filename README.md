# Slide Excel Generator

A deterministic Excel-to-PowerPoint slide generation tool for benchmark and performance data.

Excel data is converted into structured slide specifications and rendered into
presentation-ready PowerPoint slides using a shared generator, driven directly by
Claude Code (or another agent) — no server or browser UI required.

The goal of the project is to make benchmark slide generation repeatable, consistent, and easy to update without manually rebuilding charts in PowerPoint.

---

## Requirements

- Windows 10 or Windows 11
- Python 3.11 or newer (for reading `.xlsx` workbooks with `openpyxl`)
- Node.js 18 or newer (for `generator/generate_deck.cjs`)
- Microsoft PowerPoint for opening and reviewing generated presentations

Workbook analysis and PowerPoint generation run locally on the computer running the agent.

---

## Supported slide types features

The generator supports four slide groups:

### Grouped Bar

Best for comparing a small number of configurations, products, builds, or benchmark results across discrete categories.

Examples:
- Product comparisons
- Performance across several configurations

Grouped bar slides can optionally include a visible data table if needed.

### Line

Best for ordered or continuous benchmark data.

Examples:
- Packet-size sweeps
- Bandwidth curves
- QP scaling

Dense datasets remain a `line` slide type. The generator adjusts visible labels and chart presentation for readability.

Line slides can optionally include a visible data table.

### Difference

Used to show performance difference between two selected results.

This is useful for:
- Regression analysis
- Baseline comparisons
- Percentage or performance differences

Positive and negative values are visually separated around a zero baseline.

### Data Matrix

Used when the underlying data is better communicated as a structured performance matrix instead of a chart.

This is useful when many configurations, metrics, or test combinations need to be compared in a compact format.

---

## Optional Test Configuration Metadata

Slides can optionally include a Test Configuration metadata panel.

Metadata is **optionally added** to slides.

The user decides whether configuration information should appear. Claude Code or the application may understand metadata from the workbook or user prompt, but finding metadata does not automatically enable the panel.

The generator controls how metadata is presented. The user or agent controls which metadata values are included.

Supported metadata includes:
- Helios server type: Helios-R, Helios-P, Helios-M
- Standalone server manufacturer/model
- CPU type
- GPU model
- Number of GPUs
- NIC type: Pollara, Vulcano, or other
- Traffic direction
- Test type
- Operation: Read, Write, WriteIBMM, etc.
- RCCL traffic type: All-to-All, All-Reduce, etc.
- Pipeline: Hydra, Pulsar, Quasar, etc.
- Transport mode
- Packet spray mode
- Firmware version

Metadata values are not restricted to these examples so the generator can support future platforms, NICs, GPUs, CPUs, pipelines, and test configurations.

If metadata is not enabled, the original slide geometry is preserved.

---

## Claude Code / Agent workflow

PowerPoint generation happens directly through Claude Code (or another agent).
See [PROMPT_TEMPLATE.md](PROMPT_TEMPLATE.md) for the request format to use, and
[AGENT.md](AGENT.md) for the full workflow the agent follows.

The flow is:

```text
Excel workbook + natural-language prompt
                |
                v
        Claude Code Desktop
                |
                | reads workbook with openpyxl
                v
      Structured workbook data
                |
                | Claude determines slide intent
                v
          Deck / Slide JSON
                |
                v
 generator/generate_deck.cjs
                |
                v
       outputs/<deck>.pptx
