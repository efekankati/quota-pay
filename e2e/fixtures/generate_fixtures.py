"""Generate realistic high-contrast Italian restaurant receipt JPEGs for E2E AI OCR tests."""

from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

from PIL import Image, ImageDraw, ImageFont


FIXTURES_DIR = Path(__file__).resolve().parent


def _load_mono_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/cour.ttf",
        "C:/Windows/Fonts/lucon.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    ]
    for fp in candidates:
        p = Path(fp)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                pass
    return ImageFont.load_default()


def _load_bold_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/consolab.ttf",
        "C:/Windows/Fonts/courbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    ]
    for fp in candidates:
        p = Path(fp)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                pass
    return _load_mono_font(size)


def render_receipt_jpeg(
    output_path: Path,
    *,
    restaurant_name: str,
    subtitle_lines: List[str],
    items: List[Tuple[int, str, float, float]],
    total_eur: float,
    footer_note: str,
) -> Path:
    """Render a crisp thermal paper receipt JPEG with clear quantities, names, and EUR prices."""
    width = 920
    height = 1480
    bg_table = (224, 220, 212)
    paper_color = (252, 250, 245)
    ink = (22, 24, 28)
    muted = (78, 84, 92)

    img = Image.new("RGB", (width, height), bg_table)
    draw = ImageDraw.Draw(img)

    margin_x = 56
    margin_y = 48
    paper_box = [margin_x, margin_y, width - margin_x, height - margin_y]
    draw.rectangle(paper_box, fill=paper_color, outline=(195, 190, 180), width=2)

    font_title = _load_bold_font(38)
    font_header = _load_bold_font(26)
    font_body = _load_mono_font(24)
    font_bold = _load_bold_font(28)
    font_total = _load_bold_font(34)
    font_small = _load_mono_font(20)

    y = margin_y + 48
    x_left = margin_x + 44
    x_right = width - margin_x - 44

    # Header centered
    draw.text((width // 2, y), restaurant_name, fill=ink, font=font_title, anchor="mm")
    y += 44
    for sub in subtitle_lines:
        draw.text((width // 2, y), sub, fill=muted, font=font_small, anchor="mm")
        y += 30

    y += 16
    draw.line([(x_left, y), (x_right, y)], fill=muted, width=2)
    y += 28

    draw.text((x_left, y), "QTA  DESCRIZIONE", fill=ink, font=font_header)
    draw.text((x_right, y), "IMPORTO EUR", fill=ink, font=font_header, anchor="ra")
    y += 38
    draw.line([(x_left, y), (x_right, y)], fill=muted, width=1)
    y += 28

    computed_sum = 0.0
    for qty, name, unit_price, total_price in items:
        computed_sum += total_price
        left_label = f"{qty} x {name}"
        right_label = f"{total_price:.2f}"
        draw.text((x_left, y), left_label, fill=ink, font=font_body)
        draw.text((x_right, y), right_label, fill=ink, font=font_bold, anchor="ra")
        y += 34
        if qty > 1:
            draw.text((x_left + 44, y), f"({qty} x EUR {unit_price:.2f} cad.)", fill=muted, font=font_small)
            y += 28
        y += 16

    assert abs(computed_sum - total_eur) < 0.01, (
        f"Fixture sum mismatch for {output_path.name}: {computed_sum:.2f} != {total_eur:.2f}"
    )

    y += 16
    draw.line([(x_left, y), (x_right, y)], fill=ink, width=3)
    y += 36

    subtotal_net = round(total_eur / 1.1, 2)
    vat_10 = round(total_eur - subtotal_net, 2)
    draw.text((x_left, y), "IMPONIBILE (IVA 10%)", fill=muted, font=font_small)
    draw.text((x_right, y), f"EUR {subtotal_net:.2f}", fill=muted, font=font_small, anchor="ra")
    y += 30
    draw.text((x_left, y), "IMPOSTA IVA 10%", fill=muted, font=font_small)
    draw.text((x_right, y), f"EUR {vat_10:.2f}", fill=muted, font=font_small, anchor="ra")
    y += 42

    draw.text((x_left, y), "TOTALE COMPLESSIVO", fill=ink, font=font_total)
    draw.text((x_right, y), f"EUR {total_eur:.2f}", fill=ink, font=font_total, anchor="ra")
    y += 52

    draw.line([(x_left, y), (x_right, y)], fill=muted, width=1)
    y += 34
    draw.text((width // 2, y), footer_note, fill=muted, font=font_small, anchor="mm")
    y += 30
    draw.text((width // 2, y), "GRAZIE E ARRIVEDERCI", fill=ink, font=font_header, anchor="mm")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, format="JPEG", quality=92)
    return output_path


def generate_all_fixtures() -> List[Path]:
    p4 = render_receipt_jpeg(
        FIXTURES_DIR / "receipt_4p.jpg",
        restaurant_name="TRATTORIA QUOTA MILANO",
        subtitle_lines=[
            "Via Brera 29 - 20121 Milano (MI)",
            "P.IVA 09481230159  |  Tavolo 4 - 4 Coperti",
            "DOCUMENTO COMMERCIALE di vendita",
        ],
        items=[
            (1, "Carbonara Classica", 14.00, 14.00),
            (1, "Tagliere Salumi Formaggi", 24.00, 24.00),
            (2, "Pizza Margherita", 12.00, 24.00),
            (1, "Saltimbocca alla Romana", 18.00, 18.00),
            (2, "Acqua Minerale 1L", 3.00, 6.00),
            (2, "Tiramisu della Casa", 7.00, 14.00),
            (4, "Coperto", 2.50, 10.00),
        ],
        total_eur=110.00,
        footer_note="PAGAMENTO ELETTRONICO - CONTROLLO NON FISCALE",
    )

    p10 = render_receipt_jpeg(
        FIXTURES_DIR / "receipt_10p.jpg",
        restaurant_name="OSTERIA QUOTA ROMA",
        subtitle_lines=[
            "Via dei Coronari 42 - 00186 Roma (RM)",
            "P.IVA 11234560582  |  Tavolo 10 - 10 Coperti",
            "DOCUMENTO COMMERCIALE di vendita",
        ],
        items=[
            (1, "Cacio e Pepe", 14.00, 14.00),
            (1, "Antipasto della Casa", 30.00, 30.00),
            (2, "Bottiglia Chianti", 22.00, 44.00),
            (4, "Carbonara Classica", 14.00, 56.00),
            (3, "Pizza Diavola", 13.00, 39.00),
            (4, "Tiramisu Tradizionale", 7.00, 28.00),
            (5, "Acqua Naturale 1L", 3.00, 15.00),
            (10, "Coperto", 2.50, 25.00),
        ],
        total_eur=251.00,
        footer_note="PAGAMENTO ELETTRONICO - CONTROLLO NON FISCALE",
    )
    return [p4, p10]


if __name__ == "__main__":
    paths = generate_all_fixtures()
    for p in paths:
        print(f"Generated fixture: {p} ({p.stat().st_size} bytes)")
