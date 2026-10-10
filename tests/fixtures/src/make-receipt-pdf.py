#!/usr/bin/env python3
"""Writes tests/fixtures/receipt-visual.pdf: a one-page Hebrew receipt drawn the way many
invoicing programs draw one. Every table cell is its own piece of text, the cells are drawn
from right to left, and each cell's Hebrew is stored in screen (visual) order with brackets
stored as the shapes seen on screen. pdf.js then (1) glues the cells together, because it
only adds a space when the pen moves forward, and (2) returns "(₪)" as ")₪(", because it
reverses the Hebrew back to reading order without mirroring the brackets. This is the
fixture for the app's line rebuilding. The expected reading-order lines go next to it.

Needs fontTools (pip install fonttools) and DejaVu Sans. Dev tooling only. All data is made up.
"""
import io
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'receipt-visual.pdf'
EXPECTED = HERE.parent / 'receipt-visual.expected.txt'
FONT = next(p for p in [Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), Path('/Library/Fonts/DejaVuSans.ttf')] if p.exists())
TITLE = 'קבלה 1001'
ROWS = [  # each row: cells in reading order (right to left on the page)
    ['קבלה 1001', 'מסמך ממוחשב', 'מקור'],
    ['תאריך:', '01/09/2026', 'לכבוד:', 'חברת דוגמה בע"מ'],
    ['אופן תשלום', 'תאריך פירעון', 'חברת אשראי', "מס' כרטיס", 'תוקף כרטיס', "מס' תשלומים", 'סה"כ (₪)'],
    ['כרטיס אשראי', '01/09/2026', 'לאומי קארד', '0690', '01/32', '1', '75.76'],
    ['סה"כ קבלה בש"ח', '75.76'],
    ['הערות: תשלום חודש אוגוסט 2026 (כולל מע"מ)'],
]
MIRROR = dict(zip('()[]{}', ')(][}{'))

def kind(c):
    if 'א' <= c <= 'ת': return 'R'
    if c.isalpha(): return 'L'
    if c.isdigit(): return 'EN'
    return None

def visual(text):
    """Screen order of a right-to-left line (Unicode bidi W4, W7, N1, N2, I2, L2, L4)."""
    t = [kind(c) for c in text]
    for i in range(1, len(t) - 1):  # W4: "01/09/2026" and "75.76" are one number
        if text[i] in './,:' and t[i - 1] == 'EN' and t[i + 1] == 'EN': t[i] = 'EN'
    last = 'R'
    for i, k in enumerate(t):
        if k == 'EN': t[i] = 'L' if last == 'L' else 'EN'
        elif k: last = k
    def side(i, step):
        j = i + step
        while 0 <= j < len(t):
            if t[j]: return 'L' if t[j] == 'L' else 'R'
            j += step
        return 'R'
    lv = [1 if k == 'R' else 2 if k else (2 if side(i, -1) == 'L' and side(i, 1) == 'L' else 1) for i, k in enumerate(t)]
    seq = [(MIRROR.get(c, c) if l == 1 else c, l) for c, l in zip(text, lv)]
    out, i = [], 0
    while i < len(seq):  # L2: reverse each left-to-right run, then the whole line
        j = i
        while j < len(seq) and (seq[j][1] == 2) == (seq[i][1] == 2): j += 1
        out += seq[i:j][::-1] if seq[i][1] == 2 else seq[i:j]
        i = j
    return ''.join(c for c, _ in reversed(out))

chars = sorted({c for row in ROWS for cell in row for c in cell} | set(TITLE))
opts = subset.Options(); opts.retain_gids = False; opts.notdef_outline = True
font = TTFont(FONT)
sub = subset.Subsetter(opts); sub.populate(text=''.join(chars)); sub.subset(font)
cmap = font.getBestCmap(); upem = font['head'].unitsPerEm; hmtx = font['hmtx']
def gid(c): return font.getGlyphID(cmap[ord(c)])
def width(c): return round(hmtx[cmap[ord(c)]][0] * 1000 / upem)
buf = io.BytesIO(); font.save(buf); fontbytes = buf.getvalue()

SIZE = 10; RIGHT = 545; y = 780; content = []
for row in ROWS:
    x = RIGHT
    for cell in row:  # drawn in reading order: each cell lies to the LEFT of the one before
        shown = visual(cell)
        w = sum(width(c) for c in shown) * SIZE / 1000
        x -= w
        content.append(f'BT /F1 {SIZE} Tf 1 0 0 1 {x:.2f} {y} Tm <{"".join(f"{gid(c):04X}" for c in shown)}> Tj ET')
        x -= 18  # the gap between two cells
    y -= 24
stream = '\n'.join(content).encode('latin-1')

W = ' '.join(f'{gid(c)} [{width(c)}]' for c in chars)
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
    f'<< /Title <{title_hex}> /Producer (make-receipt-pdf.py) >>'.encode('latin-1'),
]
out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'); offsets = []
for i, body in enumerate(objs, 1):
    offsets.append(len(out)); out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
xref = len(out)
out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode() + ''.join(f'{o:010d} 00000 n \n' for o in offsets).encode()
out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info {len(objs)} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
OUT.write_bytes(out); EXPECTED.write_text('\n'.join(' '.join(row) for row in ROWS) + '\n', encoding='utf-8')
print(f'wrote {OUT.name} ({len(out)} bytes) and {EXPECTED.name}')
