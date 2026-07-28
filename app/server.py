from __future__ import annotations

from pathlib import Path
from datetime import datetime, timezone
from io import BytesIO
from urllib.parse import quote
import json
import logging
import os
import subprocess
import sys
import time
import zipfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .renderer import generate_deck
from .schemas import DeckRequest
from .workbook import inspect_workbook

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
OUTPUTS = ROOT / "outputs"
OUTPUTS.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 75 * 1024 * 1024
LOGGER = logging.getLogger("slide_generator")

app = FastAPI(title="Slide Generator", version="1.2.0")
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(
        WEB / "index.html",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "slide-generator", "version": "1.2.0"}


async def _read_xlsx(file: UploadFile) -> bytes:
    filename = file.filename or "workbook.xlsx"
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx workbooks are supported.")
    try:
        raw = await file.read()
    finally:
        await file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded workbook is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The workbook exceeds the 75 MB local limit.")
    return raw


def _safe_output_name(value: str) -> str:
    cleaned = "".join(character if character.isalnum() or character in "._-" else "_" for character in value).strip("._")
    if not cleaned:
        cleaned = "slide_generator_output"
    if not cleaned.lower().endswith(".pptx"):
        cleaned += ".pptx"
    return cleaned




def _validate_pptx_bytes(content: bytes) -> None:
    """Fail before the browser can download a broken or non-PowerPoint response."""
    if not content or not content.startswith(b"PK"):
        raise HTTPException(status_code=422, detail="The generated output is not a valid PowerPoint package.")
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            names = set(archive.namelist())
            required = {"[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"}
            missing = sorted(required - names)
            if missing:
                raise HTTPException(status_code=422, detail=f"The PowerPoint package is missing required parts: {', '.join(missing)}")
            if not any(name.startswith("ppt/slides/slide") and name.endswith(".xml") for name in names):
                raise HTTPException(status_code=422, detail="The PowerPoint package does not contain any slides.")
            # zipfile.testzip returns the first corrupt member name, or None.
            corrupt = archive.testzip()
            if corrupt:
                raise HTTPException(status_code=422, detail=f"The PowerPoint package contains a corrupt part: {corrupt}")
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=422, detail="The generated output is not a readable PowerPoint ZIP package.") from exc


def _validate_pptx_file(path: Path) -> None:
    _validate_pptx_bytes(path.read_bytes())

def _resolve_output(filename: str) -> Path:
    safe_name = _safe_output_name(filename)
    path = (OUTPUTS / safe_name).resolve()
    if path.parent != OUTPUTS.resolve():
        raise HTTPException(status_code=400, detail="Invalid output filename.")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="The generated PowerPoint file was not found.")
    return path


def _write_output(content: bytes, requested_filename: str) -> Path:
    safe_name = _safe_output_name(requested_filename)
    preferred = OUTPUTS / safe_name
    try:
        preferred.write_bytes(content)
        return preferred
    except PermissionError:
        # If an existing deck is locked by another application, preserve the
        # generated result with a timestamp rather than failing the request.
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        fallback = OUTPUTS / f"{preferred.stem}_{timestamp}{preferred.suffix}"
        fallback.write_bytes(content)
        return fallback


def _validated_deck_request(plan: str) -> DeckRequest:
    try:
        return DeckRequest.model_validate(json.loads(plan))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail=f"The presentation plan is invalid: {exc}") from exc


def _generate_from_upload(raw: bytes, request: DeckRequest) -> tuple[bytes, str]:
    try:
        _metadata, detected = inspect_workbook(raw)
        table_lookup = {table.table_id: table for table in detected}
        output, filename = generate_deck(request, table_lookup)
        _validate_pptx_bytes(output)
        return output, filename
    except Exception as exc:
        LOGGER.exception("PowerPoint generation failed")
        raise HTTPException(status_code=422, detail=f"PowerPoint generation failed: {exc}") from exc


@app.post("/api/inspect")
async def inspect(file: UploadFile = File(...)) -> dict:
    raw = await _read_xlsx(file)
    try:
        metadata, tables = inspect_workbook(raw)
    except Exception as exc:
        LOGGER.exception("Workbook inspection failed")
        raise HTTPException(status_code=422, detail=f"The workbook could not be inspected: {exc}") from exc
    return {
        "workbook": {
            "filename": file.filename or "workbook.xlsx",
            "size_bytes": len(raw),
            **metadata,
        },
        "tables": [table.public_dict() for table in tables],
    }


@app.post("/api/generate")
async def generate(file: UploadFile = File(...), plan: str = Form(...)) -> Response:
    """Compatibility endpoint for an explicit browser download request."""
    raw = await _read_xlsx(file)
    request = _validated_deck_request(plan)
    output, filename = _generate_from_upload(raw, request)
    return Response(
        content=output,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/generate-local")
async def generate_local(file: UploadFile = File(...), plan: str = Form(...)) -> dict[str, object]:
    """Generate and save the deck without opening or downloading it automatically."""
    raw = await _read_xlsx(file)
    request = _validated_deck_request(plan)
    started = time.perf_counter()
    output, requested_filename = _generate_from_upload(raw, request)
    saved_path = _write_output(output, requested_filename)
    _validate_pptx_file(saved_path)
    elapsed = time.perf_counter() - started
    return {
        "status": "generated",
        "filename": saved_path.name,
        "saved_path": str(saved_path),
        "size_bytes": saved_path.stat().st_size,
        "slide_count": len(request.slides),
        "generation_seconds": round(elapsed, 3),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "download_url": f"/api/download/{quote(saved_path.name)}",
        "valid_pptx": True,
    }


def _pptx_download_response(path: Path) -> FileResponse:
    """Return the exact saved PPTX file using Starlette's file streaming.

    This avoids re-reading the presentation into JavaScript or rebuilding a Blob
    in the browser. The user's browser downloads the same file that was already
    validated on disk.
    """
    _validate_pptx_file(path)
    return FileResponse(
        path=path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=path.name,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/api/download/{filename}")
def download_output_file(filename: str) -> FileResponse:
    return _pptx_download_response(_resolve_output(filename))


def _open_with_desktop(path: Path) -> None:
    # Explicit user-triggered desktop action. Nothing calls this after generation.
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
        return
    if custom_command := os.environ.get("GSG_DESKTOP_OPEN_COMMAND"):
        subprocess.Popen([custom_command, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    command = "open" if sys.platform == "darwin" else "xdg-open"
    subprocess.Popen([command, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@app.post("/api/open-output")
def open_output(filename: str = Form(...)) -> dict[str, str]:
    path = _resolve_output(filename)
    _validate_pptx_file(path)
    try:
        _open_with_desktop(path)
    except Exception as exc:
        LOGGER.exception("Could not open generated PowerPoint")
        raise HTTPException(status_code=500, detail=f"Could not open the generated PowerPoint from the local outputs folder: {exc}") from exc
    return {"status": "opened", "filename": path.name}


@app.post("/api/show-output-folder")
def show_output_folder(filename: str = Form(...)) -> dict[str, str]:
    path = _resolve_output(filename)
    folder = path.parent
    try:
        if os.name == "nt":
            subprocess.Popen(["explorer", "/select,", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            _open_with_desktop(folder)
    except Exception as exc:
        LOGGER.exception("Could not open output folder")
        raise HTTPException(status_code=500, detail=f"Could not open the output folder: {exc}") from exc
    return {"status": "opened", "folder": str(folder)}


@app.get("/api/outputs")
def download_output_query(filename: str) -> FileResponse:
    return _pptx_download_response(_resolve_output(filename))


@app.get("/api/outputs/{filename}")
def download_output(filename: str) -> FileResponse:
    return _pptx_download_response(_resolve_output(filename))
