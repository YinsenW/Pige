#!/usr/bin/env python3
"""Fixed offline PaddleOCR protocol wrapper shipped inside reviewed Pige bundles."""

from __future__ import annotations

import contextlib
import io
import json
import os
from pathlib import Path
import socket
import sys
from typing import Any

PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 64 * 1024
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_BLOCKS = 10_000
MAX_OUTPUT_CHARACTERS = 1_000_000


def _deny_network(*_args: Any, **_kwargs: Any) -> None:
    raise OSError("network disabled")


def _disable_network() -> None:
    os.environ.update({
        "PIGE_NETWORK_DISABLED": "1",
        "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK": "True",
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "HTTP_PROXY": "http://127.0.0.1:9",
        "HTTPS_PROXY": "http://127.0.0.1:9",
        "ALL_PROXY": "http://127.0.0.1:9",
        "NO_PROXY": "",
    })
    socket.create_connection = _deny_network  # type: ignore[assignment]
    socket.socket.connect = _deny_network  # type: ignore[assignment]
    socket.socket.connect_ex = _deny_network  # type: ignore[assignment]
    socket.socket.send = _deny_network  # type: ignore[assignment]
    socket.socket.sendall = _deny_network  # type: ignore[assignment]
    socket.socket.sendto = _deny_network  # type: ignore[assignment]


def _read_request() -> dict[str, Any]:
    payload = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if not payload or len(payload) > MAX_REQUEST_BYTES:
        raise ValueError("invalid request")
    request = json.loads(payload.decode("utf-8"))
    if not isinstance(request, dict) or set(request) != {
        "schemaVersion", "requestId", "operation", "inputPath",
        "preferredLanguages", "networkAllowed", "limits",
    }:
        raise ValueError("invalid request")
    request_id = request.get("requestId")
    languages = request.get("preferredLanguages")
    if (
        request.get("schemaVersion") != PROTOCOL_VERSION
        or request.get("operation") != "recognize"
        or request.get("networkAllowed") is not False
        or not isinstance(request_id, str)
        or not request_id.startswith("ocr_")
        or not isinstance(languages, list)
        or len(languages) > 8
        or not isinstance(request.get("limits"), dict)
    ):
        raise ValueError("invalid request")
    return request


def _verified_input(value: Any, maximum: int) -> Path:
    if not isinstance(value, str):
        raise ValueError("invalid input")
    candidate = Path(value)
    if not candidate.is_absolute() or candidate.is_symlink():
        raise ValueError("invalid input")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(candidate, flags)
    try:
        stat = os.fstat(descriptor)
        if not 0 < stat.st_size <= min(maximum, MAX_FILE_BYTES):
            raise ValueError("invalid input")
        resolved = Path(os.path.realpath(candidate))
        current = os.stat(resolved, follow_symlinks=False)
        if (stat.st_dev, stat.st_ino) != (current.st_dev, current.st_ino):
            raise ValueError("invalid input")
        return resolved
    finally:
        os.close(descriptor)


def _model_identity(languages: list[str]) -> tuple[str, str]:
    primary = languages[0].lower() if languages else "en"
    if primary == "ko" or primary.startswith("ko-"):
        return "korean_PP-OCRv5_mobile_rec", "korean_PP-OCRv5_mobile_rec_infer"
    if primary.split("-", 1)[0] not in {"zh", "en", "ja"}:
        return "latin_PP-OCRv5_mobile_rec", "latin_PP-OCRv5_mobile_rec_infer"
    return "PP-OCRv5_mobile_rec", "PP-OCRv5_mobile_rec_infer"


def _recognize(request: dict[str, Any]) -> dict[str, Any]:
    limits = request["limits"]
    maximum = limits.get("maxFileBytes")
    if not isinstance(maximum, int) or maximum <= 0:
        raise ValueError("invalid limits")
    input_path = _verified_input(request["inputPath"], maximum)
    runtime_root = Path(__file__).resolve().parent.parent
    models_root = runtime_root / "models"
    recognition_name, recognition_dir = _model_identity(request["preferredLanguages"])
    detection_dir = models_root / "PP-OCRv5_mobile_det_infer"
    recognition_path = models_root / recognition_dir
    for directory in (detection_dir, recognition_path):
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError("model unavailable")

    _disable_network()
    with contextlib.redirect_stdout(io.StringIO()):
        from PIL import Image
        from paddleocr import PaddleOCR

        with Image.open(input_path) as image:
            source_width, source_height = image.size
            frame_count = int(getattr(image, "n_frames", 1))
            image_format = (image.format or "unknown").lower()
        if (
            frame_count != 1
            or source_width <= 0
            or source_height <= 0
            or source_width > limits.get("maxSourceDimension", 0)
            or source_height > limits.get("maxSourceDimension", 0)
            or source_width * source_height > limits.get("maxSourcePixels", 0)
        ):
            raise ValueError("image outside limits")
        engine = PaddleOCR(
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_detection_model_dir=str(detection_dir),
            text_recognition_model_name=recognition_name,
            text_recognition_model_dir=str(recognition_path),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device="cpu",
        )
        predictions = list(engine.predict(str(input_path)))

    if len(predictions) != 1:
        raise ValueError("invalid result")
    result = predictions[0].json
    payload = result.get("res") if isinstance(result, dict) else None
    if not isinstance(payload, dict):
        raise ValueError("invalid result")
    texts = payload.get("rec_texts")
    scores = payload.get("rec_scores")
    polygons = payload.get("rec_polys")
    if not isinstance(texts, list) or not isinstance(scores, list) or not isinstance(polygons, list):
        raise ValueError("invalid result")
    if not (len(texts) == len(scores) == len(polygons) <= min(limits.get("maxBlocks", 0), MAX_BLOCKS)):
        raise ValueError("invalid result")

    blocks: list[dict[str, Any]] = []
    for text, score, polygon in zip(texts, scores, polygons, strict=True):
        if not isinstance(text, str) or not text or not isinstance(score, (int, float)):
            raise ValueError("invalid result")
        if not isinstance(polygon, list) or len(polygon) < 4:
            raise ValueError("invalid result")
        points = [point for point in polygon if isinstance(point, list) and len(point) == 2]
        if len(points) != len(polygon):
            raise ValueError("invalid result")
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        left, right = max(0.0, min(xs)), min(float(source_width), max(xs))
        top, bottom = max(0.0, min(ys)), min(float(source_height), max(ys))
        blocks.append({
            "text": text,
            "kind": "line",
            "confidence": max(0.0, min(1.0, float(score))),
            "boundingBox": {
                "x": left / source_width,
                "y": top / source_height,
                "width": max(0.0, right - left) / source_width,
                "height": max(0.0, bottom - top) / source_height,
            },
            "languageHints": request["preferredLanguages"],
            "isTitle": False,
        })
    text = "\n".join(block["text"] for block in blocks)
    if len(text) > min(limits.get("maxOutputCharacters", 0), MAX_OUTPUT_CHARACTERS):
        raise ValueError("invalid result")
    confidence = sum(block["confidence"] for block in blocks) / len(blocks) if blocks else None
    decoded_limit = limits.get("maxDecodedDimension", 0)
    if not isinstance(decoded_limit, int) or decoded_limit <= 0:
        raise ValueError("invalid limits")
    decoded_scale = min(1.0, decoded_limit / max(source_width, source_height))
    decoded_width = max(1, round(source_width * decoded_scale))
    decoded_height = max(1, round(source_height * decoded_scale))
    return {
        "adapterId": "paddleocr_local",
        "adapterVersion": "1.0.0",
        "engine": "Paddle",
        "engineVersion": "3.7.0",
        "text": text,
        "blocks": blocks,
        "languageHints": request["preferredLanguages"],
        **({"confidence": confidence} if confidence is not None else {}),
        "warnings": [],
        "image": {
            "typeIdentifier": f"public.{image_format}",
            "frameCount": frame_count,
            "sourceWidth": source_width,
            "sourceHeight": source_height,
            "decodedWidth": decoded_width,
            "decodedHeight": decoded_height,
            "downsampled": decoded_scale < 1.0,
        },
    }


def main() -> int:
    try:
        request = _read_request()
        result = _recognize(request)
        response = {"schemaVersion": PROTOCOL_VERSION, "requestId": request["requestId"], "ok": True, "result": result}
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
