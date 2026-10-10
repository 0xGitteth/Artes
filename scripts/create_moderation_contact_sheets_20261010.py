#!/usr/bin/env python3
"""Make contact sheets for independent visual labeling in ChatGPT.

Only reads the already downloaded photographs and their manifest. It does not
label images, use detection models, edit existing reviews, or touch training data.
"""
import argparse
import csv
import io
import json
import math
import textwrap
import zipfile
from pathlib import Path

ROOT = Path.cwd() if __file__ == "<stdin>" else Path(__file__).resolve().parents[1]
DEFAULT_FOLDER = ROOT / ".tmp/moderation-research-discovery/public-photo-candidates-20261010"

def make_sheets(folder, output=None, columns=4, rows=4, collection=None):
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageOps
    except ImportError as exc:
        raise SystemExit("Pillow ontbreekt. Installeer met: python3 -m pip install --user Pillow") from exc

    folder = folder.resolve()
    manifest = folder / "unreviewed-images.jsonl"
    if not manifest.is_file():
        raise SystemExit("Bestand niet gevonden: " + str(manifest))
    output = (output or folder.parent / "Artes_contactvellen_20261010.zip").resolve()
    items = []
    for raw in manifest.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        entry = json.loads(raw)
        filename = Path(entry["filename"]).resolve()
        if filename.parent != folder or not filename.is_file():
            continue
        if collection and entry["collection"] != collection:
            continue
        items.append({
            "id": entry["id"],
            "filename": filename,
            "collection": entry["collection"],
            "source_page": entry["source_page"],
            "image_page": entry["image_page"],
            "sha256": entry.get("sha256", ""),
        })
    if not items:
        raise SystemExit("Geen gedownloade foto's beschikbaar.")

    w, h = 520, 480
    gap, margin, heading = 12, 20, 62
    sheet_width = columns*w + (columns-1)*gap + margin*2
    sheet_height = heading + rows*h + (rows-1)*gap + margin*2
    cells_per_sheet = columns*rows
    count = math.ceil(len(items)/cells_per_sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 17)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
        titlefont = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 25)
    except OSError:
        font = small = titlefont = ImageFont.load_default()

    output.parent.mkdir(parents=True, exist_ok=True)
    failed = []
    csv_buffer = io.StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow(["sheet","position","id","collection","file","source_page","image_page","sha256"])
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=2) as archive:
        for p in range(count):
            sheet = Image.new("RGB", (sheet_width, sheet_height), (22, 27, 34))
            draw = ImageDraw.Draw(sheet)
            draw.text((margin, 15), f"Artes | Contactvel {p+1:02d} / {count:02d}", fill="white", font=titlefont)
            draw.text((margin, 44), "Onbeoordeeld | Alleen visuele inspectie | Geen automatische detectorlabels",
                      fill=(176, 194, 210), font=small)
            for local_idx, entry in enumerate(items[p*cells_per_sheet:(p+1)*cells_per_sheet]):
                row, col = divmod(local_idx, columns)
                x = margin + col*(w+gap)
                y = heading+margin+row*(h+gap)
                draw.rounded_rectangle((x, y, x+w, y+h), radius=8, fill=(38, 45, 55))
                photo_box = (x+10, y+10, x+w-10, y+h-53)
                try:
                    with Image.open(entry["filename"]) as opened:
                        im = ImageOps.exif_transpose(opened)
                        im.thumbnail((w-20, h-66), Image.Resampling.LANCZOS)
                        if im.mode != "RGB": im = im.convert("RGB")
                        px = photo_box[0]+((w-20)-im.width)//2
                        py = photo_box[1]+((h-66)-im.height)//2
                        sheet.paste(im, (px, py))
                except Exception as exc:
                    failed.append({"id":entry["id"],"error":str(exc)[:140]})
                    draw.text((x+20,y+30),"AFBEELDING NIET LEESBAAR",font=small,fill=(255,160,160))
                label = f"{p*cells_per_sheet+local_idx+1:03d} | {entry['id']}"
                draw.text((x+12, y+h-44), label, font=font, fill=(248,249,251))
                draw.text((x+12, y+h-22), entry["collection"][:57], font=small, fill=(187,201,219))
                writer.writerow([f"{p+1:02d}", f"{local_idx+1:02d}", entry["id"],
                                 entry["collection"], str(entry["filename"]),
                                 entry["source_page"], entry["image_page"], entry["sha256"]])
            buf=io.BytesIO()
            sheet.save(buf, format="JPEG", quality=82, optimize=True)
            archive.writestr(f"contactvel_{p+1:02d}.jpg",buf.getvalue())
            print(f"Contactvel {p+1}/{count} klaar",flush=True)
        archive.writestr("index.csv",csv_buffer.getvalue().encode("utf-8-sig"))
        archive.writestr("lees_mij.txt", (
            "ARTES BEELDINSPECTIE | 10 oktober 2026\n"
            "Dit ZIP bestand bevat contactvellen met foto's die nog niet zijn beoordeeld.\n"
            "Labels mogen alleen gebaseerd zijn op de daadwerkelijk zichtbare inhoud.\n"
            "Namen van galerijen zijn geen inhoudelijke labels en er is geen classifier ingezet.\n"
            "Leeftijd kan niet betrouwbaar uit een miniatuur worden vastgesteld.\n"
            "De originele bestanden blijven in de Codespace; deze ZIP is voor de visuele review.\n"
        ).encode("utf-8"))
        if failed:
            archive.writestr("niet_leesbaar.json",json.dumps(failed,ensure_ascii=False,indent=2))
    print(f"\nFoto's: {len(items)} | Contactvellen: {count} | Niet leesbaar: {len(failed)}")
    print(f"ZIP: {output}")
    print("Bestaande labels en datasets zijn niet gewijzigd.")

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--folder", type=Path, default=DEFAULT_FOLDER)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=4)
    parser.add_argument("--collection", type=str, default=None)
    args=parser.parse_args()
    if not 2<=args.columns<=6 or not 2<=args.rows<=6:
        parser.error("Rows and columns must be between 2 and 6")
    make_sheets(args.folder,args.output,args.columns,args.rows,args.collection)
