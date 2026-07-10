# Parser And OCR Manifests

Status: Active release resource index
Last reviewed: 2026-07-10
Review trigger: Any parser/OCR adapter, dependency, supported source kind, or release-input change, plus the quarterly documentation inventory.

These manifests describe Pige-owned parser and OCR adapters, their pinned engines, runtime boundaries, limits, and supported source kinds. They are release inputs and must stay aligned with the dependency manifest and owning service behavior.

Current manifests:

- `pdfjs.parser.manifest.json`: bundled PDF.js text-extraction adapter.
- `pdf-page-materializer.manifest.json`: bounded PDF.js + native Canvas page-to-PNG materializer for OCR handoff.
- `office-openxml.parser.manifest.json`: bundled DOCX/PPTX semantic and OpenXML extraction adapter.
- `web-readability.parser.manifest.json`: bundled inert HTML/Readability article extraction adapter.
- `macos-vision-ocr.helper.manifest.json`: app-owned macOS 26 Apple Vision OCR helper and stdin/stdout protocol.

Review this index whenever a parser/OCR adapter, dependency manifest, or supported source kind changes.
