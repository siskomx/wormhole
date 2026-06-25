import hashlib


def _dependency(name):
    try:
        module = __import__(name)
        version = getattr(module, "__version__", "unknown")
        return {"available": True, "version": version}
    except Exception as error:
        return {"available": False, "error": str(error)}


def dependency_report():
    return {"pypdf": _dependency("pypdf")}


def _clean_text(value):
    return (value or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")


def extract_pdf(payload):
    report = dependency_report()
    warnings = []
    if not report["pypdf"]["available"]:
        return {
            "kind": "pdf",
            "available": False,
            "pageCount": 0,
            "pages": [],
            "warnings": ["pypdf unavailable"],
            "dependencies": report,
        }

    from pypdf import PdfReader

    source_path = payload.get("path")
    max_pages = payload.get("maxPages")
    reader = PdfReader(source_path)
    pages = []
    page_limit = len(reader.pages)
    if isinstance(max_pages, int) and max_pages >= 0:
        page_limit = min(page_limit, max_pages)
    for index, page in enumerate(reader.pages[:page_limit], start=1):
        try:
            text = _clean_text(page.extract_text())
        except Exception as error:
            text = ""
            warnings.append(f"page {index} text extraction failed: {error}")
        pages.append(
            {
                "pageNumber": index,
                "text": text,
                "textHash": hashlib.sha256(text.encode("utf8")).hexdigest(),
            }
        )
    metadata = reader.metadata or {}
    title = getattr(metadata, "title", None)
    return {
        "kind": "pdf",
        "available": True,
        "pageCount": len(reader.pages),
        "pages": pages,
        "warnings": warnings,
        **({"title": title} if title else {}),
        "dependencies": report,
    }
