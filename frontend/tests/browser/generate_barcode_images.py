"""Generate tiny client-side decoder fixtures for the native scanner spec."""

from pathlib import Path

import qrcode
from PIL import Image

fixtures = Path(__file__).parent / "fixtures"
fixtures.mkdir(exist_ok=True)
base = qrcode.make("6931234567890").convert("RGB").resize((360, 360), Image.Resampling.NEAREST)
canvas = Image.new("RGB", (520, 440), "white")
canvas.paste(base, (80, 40))
canvas.save(fixtures / "barcode.png", optimize=True)
canvas.rotate(20, expand=True, fillcolor="white").save(fixtures / "barcode-rotated.png", optimize=True)
Image.new("RGB", (360, 240), "white").save(fixtures / "blank.png", optimize=True)
