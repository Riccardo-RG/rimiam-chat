"""Bounded local extraction. No network, macros, PDF actions or external relationship loading."""
import io
import json
import sys
import zipfile
import resource

MAX_INPUT = 8 * 1024 * 1024
MAX_TEXT = 200000


def main():
    # Keep untrusted compressed input inside a disposable, bounded parser process.
    resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
    # Darwin reports infinite DATA/AS limits but rejects setting a portable cap.
    # Linux deployment can enforce address-space memory; macOS retains CPU/input/output bounds.
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise ValueError("DOCUMENT_TOO_LARGE")
    kind = sys.argv[1]
    if kind == "pdf":
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(raw), strict=True)
        if reader.is_encrypted:
            raise ValueError("PDF_PASSWORD_REQUIRED")
        if len(reader.pages) > 300:
            raise ValueError("DOCUMENT_TOO_MANY_PAGES")
        sections = []
        size = 0
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            size += len(text)
            if size > MAX_TEXT:
                raise ValueError("DOCUMENT_TEXT_TOO_LARGE")
            if text.strip():
                sections.append(f"[Pagina {index + 1}]\n{text}")
        text = "\n\n".join(sections)
        provider = f"pypdf/{pypdf.__version__}"
        if not text.strip():
            raise ValueError("PDF_TEXT_UNAVAILABLE")
    elif kind == "docx":
        import docx
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > 2000 or sum(e.file_size for e in entries) > 32 * 1024 * 1024:
                raise ValueError("DOCUMENT_EXPANSION_TOO_LARGE")
            if "word/document.xml" not in archive.namelist():
                raise ValueError("DOCUMENT_FORMAT_INVALID")
        document = docx.Document(io.BytesIO(raw))
        sections = []
        # Iteration preserves paragraph/table order; never executes embedded content.
        from docx.text.paragraph import Paragraph
        from docx.table import Table
        for block in document.iter_inner_content():
            if isinstance(block, Paragraph):
                sections.append(block.text)
            elif isinstance(block, Table):
                sections.extend(" | ".join(c.text for c in row.cells) for row in block.rows)
            if sum(map(len, sections)) > MAX_TEXT:
                raise ValueError("DOCUMENT_TEXT_TOO_LARGE")
        text = "\n".join(sections)
        provider = f"python-docx/{docx.__version__}"
        if not text.strip():
            raise ValueError("DOCUMENT_TEXT_UNAVAILABLE")
    else:
        raise ValueError("DOCUMENT_FORMAT_UNSUPPORTED")
    if len(text) > MAX_TEXT:
        raise ValueError("DOCUMENT_TEXT_TOO_LARGE")
    print(json.dumps({"text": text, "provider": provider, "qualification": "Estrazione testuale locale; layout, immagini, annotazioni o contenuti incorporati possono richiedere ispezione dell'originale. Non costituisce informazione accettata o un impegno."}))


try:
    main()
except ModuleNotFoundError:
    print(json.dumps({"error": "DOCUMENT_PARSER_CONFIGURATION_REQUIRED"}))
    sys.exit(2)
except Exception as error:
    known = str(error)
    code = known if known.isupper() and known.replace("_", "").isalpha() else "DOCUMENT_EXTRACTION_FAILED"
    print(json.dumps({"error": code}))
    sys.exit(1)
