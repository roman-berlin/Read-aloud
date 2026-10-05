#!/usr/bin/env python3
"""Writes tests/fixtures/hebrew-mirrored.pdf: a one-page PDF whose Hebrew lines are stored as ONE
string each in LOGICAL order with ordinary left-to-right advances — what OCR text layers and some
Hebrew producers emit. pdf.js assumes such a run is in visual order and mirrors it, so every line
comes out backwards (final letters at the start of words). This is the fixture for the app's
un-mirroring. The expected logical text is written next to it. (The page itself looks mirrored
in a viewer; a real OCR layer is invisible, which does not matter for text extraction.)

Needs fontTools (pip install fonttools) and DejaVu Sans. Dev tooling only.
"""
import io
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'hebrew-mirrored.pdf'
EXPECTED = HERE.parent / 'hebrew-mirrored.expected.txt'
FONT = next(p for p in [Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), Path('/Library/Fonts/DejaVuSans.ttf')] if p.exists())
TITLE = 'בית הרוח'
LINES = [
    'בית הרוח',
    'משפחה יקרה, ברוכים הבאים אל HOUSE OF SPIRIT, הבית שלכם לחופשה.',
    'אנחנו שמחים להזמין אתכם להצטרף אלינו לסוף שבוע של מנוחה ושקט.',
    'החדרים מוכנים, הבריכה חוממה ל-28 מעלות, וארוחת הערב מוגשת ב-20:00.',
    'נתראה בקרוב!',
]

chars = sorted({c for line in LINES + [TITLE] for c in line})
opts = subset.Options(); opts.retain_gids = False; opts.notdef_outline = True
font = TTFont(FONT)
sub = subset.Subsetter(opts); sub.populate(text=''.join(chars)); sub.subset(font)
cmap = font.getBestCmap(); upem = font['head'].unitsPerEm; hmtx = font['hmtx']
def gid(c): return font.getGlyphID(cmap[ord(c)])
def width(c): return round(hmtx[cmap[ord(c)]][0] * 1000 / upem)
buf = io.BytesIO(); font.save(buf); fontbytes = buf.getvalue()

LEFT = 50; TOP = 780
content = []; y = TOP
for n, line in enumerate(LINES):
    size = 22 if n == 0 else 14            # a heading, like a real brochure
    hexstr = ''.join(f'{gid(c):04X}' for c in line)
    content.append(f'BT /F1 {size} Tf 1 0 0 1 {LEFT} {y} Tm <{hexstr}> Tj ET')
    y -= 40 if n == 0 else 26              # a bigger gap after the heading
stream = '\n'.join(content).encode('latin-1')

glyphs = sorted({gid(c) for c in chars})
W = ' '.join(f'{g} [{width(c)}]' for c in chars for g in [gid(c)])
to_unicode = ('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def '
              '/CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
              f'{len(chars)} beginbfchar\n' + '\n'.join(f'<{gid(c):04X}> <{ord(c):04X}>' for c in chars) +
              '\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end').encode('latin-1')
title_hex = 'FEFF' + ''.join(f'{ord(c):04X}' for c in TITLE)
bbox = font['head']; fd = f'/FontBBox [{bbox.xMin} {bbox.yMin} {bbox.xMax} {bbox.yMax}]'

objs = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 8 0 R >>',
    b'<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>',
    (f'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> '
     f'/FontDescriptor 6 0 R /DW 600 /W [{W}] /CIDToGIDMap /Identity >>').encode('latin-1'),
    (f'<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 {fd} /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 700 /StemV 80 /FontFile2 9 0 R >>').encode('latin-1'),
    b'<< /Length %d >>\nstream\n' % len(to_unicode) + to_unicode + b'\nendstream',
    b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream',
    b'<< /Length %d /Length1 %d >>\nstream\n' % (len(fontbytes), len(fontbytes)) + fontbytes + b'\nendstream',
    f'<< /Title <{title_hex}> /Producer (make-mirrored-pdf.py) >>'.encode('latin-1'),
]
out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'); offsets = []
for i, body in enumerate(objs, 1):
    offsets.append(len(out)); out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
xref = len(out)
out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode() + ''.join(f'{o:010d} 00000 n \n' for o in offsets).encode()
out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info {len(objs)} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
OUT.write_bytes(out); EXPECTED.write_text('\n'.join(LINES) + '\n', encoding='utf-8')
print(f'wrote {OUT.relative_to(HERE.parent.parent.parent)} ({len(out)} bytes) and {EXPECTED.name}')
