from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DATASET_SUBDIR = "web-research-v1"
IMAGE_DIR = REPO_ROOT / ".tmp" / "moderation-test-images" / DATASET_SUBDIR
SOURCES_PATH = IMAGE_DIR / "sources.json"
OUTPUT_DIR = REPO_ROOT / ".tmp" / "moderation-review-contact-sheets" / DATASET_SUBDIR

COLS = 3
ROWS = 3
ITEMS_PER_SHEET = COLS * ROWS
CELL_W = 640
IMAGE_H = 560
CAPTION_H = 92
CELL_H = IMAGE_H + CAPTION_H
MARGIN = 24
SHEET_W = MARGIN * 2 + COLS * CELL_W
SHEET_H = MARGIN * 2 + ROWS * CELL_H
BACKGROUND = "white"
FOREGROUND = "black"
IMAGE_BACKGROUND = (28, 28, 28)


def load_font(size: int):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def fit_text(draw: ImageDraw.ImageDraw, text: str, max_width: int, font):
    if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
        return text
    suffix = "…"
    candidate = text
    while candidate and draw.textbbox((0, 0), candidate + suffix, font=font)[2] > max_width:
        candidate = candidate[:-1]
    return candidate + suffix


def main():
    payload = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    records = payload.get("records") or []
    if not records:
        raise RuntimeError("web_research_sources_empty")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    font_number = load_font(26)
    font_name = load_font(20)

    outputs = []
    for sheet_index, start in enumerate(range(0, len(records), ITEMS_PER_SHEET), start=1):
        chunk = records[start : start + ITEMS_PER_SHEET]
        canvas = Image.new("RGB", (SHEET_W, SHEET_H), BACKGROUND)
        draw = ImageDraw.Draw(canvas)

        for local_index, record in enumerate(chunk):
            absolute_index = start + local_index + 1
            row = local_index // COLS
            col = local_index % COLS
            x = MARGIN + col * CELL_W
            y = MARGIN + row * CELL_H
            file_name = str(record.get("fileName") or "").strip()
            if not file_name or Path(file_name).name != file_name:
                raise RuntimeError(f"invalid_web_research_filename:{file_name}")

            image_path = IMAGE_DIR / file_name
            with Image.open(image_path) as source:
                source = ImageOps.exif_transpose(source).convert("RGB")
                fitted = ImageOps.contain(source, (CELL_W - 24, IMAGE_H - 24))

            image_box = Image.new("RGB", (CELL_W, IMAGE_H), IMAGE_BACKGROUND)
            paste_x = (CELL_W - fitted.width) // 2
            paste_y = (IMAGE_H - fitted.height) // 2
            image_box.paste(fitted, (paste_x, paste_y))
            canvas.paste(image_box, (x, y))

            draw.text((x + 12, y + IMAGE_H + 8), f"{absolute_index:02d}", fill=FOREGROUND, font=font_number)
            caption = fit_text(draw, file_name, CELL_W - 72, font_name)
            draw.text((x + 60, y + IMAGE_H + 12), caption, fill=FOREGROUND, font=font_name)

        output_path = OUTPUT_DIR / f"web-research-v1-contact-sheet-{sheet_index:02d}.png"
        canvas.save(output_path, format="PNG", optimize=True)
        outputs.append(output_path)

    index_path = OUTPUT_DIR / "index.json"
    index_path.write_text(
        json.dumps(
            {
                "datasetSubdir": DATASET_SUBDIR,
                "itemCount": len(records),
                "itemsPerSheet": ITEMS_PER_SHEET,
                "sheetCount": len(outputs),
                "sheets": [str(path.relative_to(REPO_ROOT)) for path in outputs],
                "localOnly": True,
                "researchOnly": True,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(json.dumps({
        "ok": True,
        "itemCount": len(records),
        "sheetCount": len(outputs),
        "outputDirectory": str(OUTPUT_DIR.relative_to(REPO_ROOT)),
        "sheets": [path.name for path in outputs],
        "imageBytesCommitted": False,
        "localOnly": True,
    }, indent=2))


if __name__ == "__main__":
    main()
