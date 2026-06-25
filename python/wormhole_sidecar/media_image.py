import shutil


def _dependency(name):
    try:
        module = __import__(name)
        version = getattr(module, "__version__", "unknown")
        return {"available": True, "version": version}
    except Exception as error:
        return {"available": False, "error": str(error)}


def dependency_report():
    pillow = _dependency("PIL")
    pytesseract = _dependency("pytesseract")
    binary = shutil.which("tesseract")
    pytesseract["binaryAvailable"] = bool(binary)
    return {"pillow": pillow, "pytesseract": pytesseract}


def _safe_exif(image):
    safe_keys = {
        271: "make",
        272: "model",
        274: "orientation",
        305: "software",
        306: "datetime",
    }
    try:
        exif = image.getexif()
    except Exception:
        return {}
    result = {}
    for key, name in safe_keys.items():
        value = exif.get(key)
        if isinstance(value, (str, int, float)):
            result[name] = value
    return result


def _color_summary(image):
    try:
        sample = image.convert("RGB").resize((1, 1))
        red, green, blue = sample.getpixel((0, 0))
        return {"averageRgb": [red, green, blue]}
    except Exception:
        return {}


def inspect_image(payload):
    report = dependency_report()
    warnings = []
    if not report["pillow"]["available"]:
        return {
            "kind": "image",
            "available": False,
            "warnings": ["Pillow unavailable"],
            "dependencies": report,
        }

    from PIL import Image

    source_path = payload.get("path")
    ocr_mode = payload.get("ocrMode", "off")
    text = ""
    ocr_available = False
    with Image.open(source_path) as image:
        image.load()
        if ocr_mode in ("auto", "required"):
            ocr_available = bool(
                report["pytesseract"]["available"] and report["pytesseract"].get("binaryAvailable")
            )
            if ocr_available:
                try:
                    import pytesseract

                    text = pytesseract.image_to_string(image).replace("\x00", "").replace("\r\n", "\n")
                except Exception as error:
                    warnings.append(f"OCR failed: {error}")
                    ocr_available = False
            else:
                warnings.append("OCR unavailable")
        return {
            "kind": "image",
            "available": True,
            "width": image.width,
            "height": image.height,
            "format": image.format,
            "mode": image.mode,
            "safeExif": _safe_exif(image),
            "colorSummary": _color_summary(image),
            "text": text,
            "ocrAvailable": ocr_available,
            "warnings": warnings,
            "dependencies": report,
        }
