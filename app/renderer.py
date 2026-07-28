from __future__ import annotations

from datetime import date, datetime
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Any

from .schemas import DeckRequest
from .workbook import DetectedTable

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "generator" / "generate_deck.cjs"


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    if not cleaned:
        cleaned = "presentation"
    if not cleaned.lower().endswith(".pptx"):
        cleaned += ".pptx"
    return cleaned


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _table_payload(table: DetectedTable) -> dict[str, Any]:
    return {
        "table_id": table.table_id,
        "sheet_name": table.sheet_name,
        "kind": table.kind,
        "title": table.title,
        "display_name": table.display_name,
        "header_row": table.header_row,
        "data_start_row": table.data_start_row,
        "data_end_row": table.data_end_row,
        "start_col": table.start_col,
        "end_col": table.end_col,
        "headers": list(table.headers),
        "rows": [[_json_value(value) for value in row] for row in table.rows],
        "column_profiles": [profile.public_dict() for profile in table.column_profiles],
    }


def _find_node() -> str:
    executable = shutil.which("node") or shutil.which("node.exe")
    if not executable:
        raise RuntimeError(
            "Node.js was not found. Install Node.js 18 or newer, then restart the application. "
            "No npm install is required because the PowerPoint renderer is bundled."
        )
    return executable


def generate_deck(deck_request: DeckRequest, tables: dict[str, DetectedTable]) -> tuple[bytes, str]:
    if not GENERATOR.exists():
        raise RuntimeError(f"The bundled PowerPoint generator is missing: {GENERATOR}")

    selected_tables: dict[str, dict[str, Any]] = {}
    for slide in deck_request.slides:
        table = tables.get(slide.table_id)
        if table is None:
            raise ValueError(f"The source table '{slide.table_id}' is no longer available.")
        selected_tables[slide.table_id] = _table_payload(table)

    payload = {
        "deck_title": deck_request.deck_title,
        "slides": [slide.model_dump(mode="json") for slide in deck_request.slides],
        "tables": selected_tables,
    }
    output_filename = _safe_filename(deck_request.output_filename)

    with tempfile.TemporaryDirectory(prefix="slide_generator_") as temporary_directory:
        work = Path(temporary_directory)
        input_path = work / "presentation_plan.json"
        output_path = work / output_filename
        input_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        process = subprocess.run(
            [_find_node(), str(GENERATOR), str(input_path), str(output_path)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=240,
            check=False,
        )
        if process.returncode != 0:
            details = (process.stderr or process.stdout or "Unknown renderer error").strip()
            raise RuntimeError(details[-6000:])
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("The PowerPoint renderer completed without producing an output file.")
        return output_path.read_bytes(), output_filename
