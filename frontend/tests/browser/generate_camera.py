"""Generate a deterministic camera fixture (test-only dependencies: qrcode, Pillow)."""
import sys
import qrcode
from PIL import Image

image = Image.new('RGB', (640, 480), 'white')
qr = qrcode.make('6931234567890').convert('RGB').resize((360, 360), Image.Resampling.NEAREST)
image.paste(qr, (140, 60))
y, cb, cr = image.convert('YCbCr').split()
frame = y.tobytes() + cb.resize((320, 240)).tobytes() + cr.resize((320, 240)).tobytes()
with open(sys.argv[1], 'wb') as output:
    output.write(b'YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n')
    for _ in range(100):
        output.write(b'FRAME\n' + frame)
