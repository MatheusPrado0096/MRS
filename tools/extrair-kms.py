#!/usr/bin/env python3
"""Lê (por OCR) os marcadores de KM (formato 000+000) das plantas gerais e grava data/kms.json.

As plantas são desenhos vetoriais sem camada de texto: os rótulos de KM (texto ciano na vertical)
são localizados na imagem, recortados e reconhecidos por OCR com votação entre várias variações.
Correções manuais ficam em tools/kms-correcoes.json  ("PÁTIO:página:x" -> km em metros) e sempre vencem o OCR.

Uso:  python3 tools/extrair-kms.py            (requer poppler-utils, tesseract-ocr, opencv-python, numpy, Pillow)
      python3 tools/extrair-kms.py FCA FSJ    (só alguns pátios)
Saída: data/kms.json  e  data/kms-debug/*.png (folha de conferência: recorte de cada rótulo + valor lido)"""
import collections, csv, io, json, re, subprocess, sys, tempfile
from pathlib import Path
import cv2, numpy as np
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
txt = (root / 'data.js').read_text(encoding='utf-8')
yards = json.loads(re.search(r'window\.PATIOS\s*=\s*(\[.*\])\s*;?\s*$', txt, re.S).group(1))
only = set(a.upper() for a in sys.argv[1:])
DPI = 300
KM = re.compile(r'^(\d{2,3})\+(\d{3})$')
fixes_f = root / 'tools' / 'kms-correcoes.json'
fixes = json.loads(fixes_f.read_text()) if fixes_f.exists() else {}
dbg = root / 'data' / 'kms-debug'; dbg.mkdir(parents=True, exist_ok=True)

def tess(img, psm):
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / 'i.png'; cv2.imwrite(str(f), img)
        out = subprocess.run(['tesseract', str(f), '-', '--psm', psm, '-c', 'tessedit_char_whitelist=0123456789+'],
                             capture_output=True, text=True).stdout
    return out.strip().replace(' ', '').replace('\n', '')

def read_label(crop):
    """crop: tinta (0-255) já horizontal. Vota entre escalas — o OCR erra 3/5 quando o texto fica grande demais."""
    bw = crop > 100
    wid = bw.any(axis=0).sum(); rows = bw.sum(axis=1)
    crop = crop.copy(); crop[rows > 0.8 * wid, :] = 0          # remove o sublinhado do rótulo
    votes = collections.Counter()
    for scale in (0.75, 1.0, 1.25):
        c = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
        c = cv2.copyMakeBorder(255 - c, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255)
        t = tess(c, '7')
        if re.match(r'^\d{3}4\d{3}$', t): t = t[:3] + '+' + t[4:]      # o '+' às vezes é lido como '4'
        if t[:1] == '5': t = '3' + t[1:]                                # a linha só tem km 3xx e 4xx: um '5' inicial é um '3' mal lido
        if KM.match(t): votes[t] += 1
    return votes

def find_labels(rgb):
    H, W = rgb.shape[:2]
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    cy = ((r < 130) & (g > 120) & (b > 120)).astype('uint8') * 255
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (int(DPI * 0.035), int(DPI * 0.30)))  # funde os dígitos de um rótulo vertical
    n, _, st, _ = cv2.connectedComponentsWithStats(cv2.morphologyEx(cy, cv2.MORPH_CLOSE, k))
    out = []
    for i in range(1, n):
        x, y, w, h, _a = st[i]
        if DPI * 0.3 < h < DPI * 0.8 and w < DPI * 0.2 and h / w > 3:
            ink = np.where((g > 150) & (b > 150), 255 - r, 0).astype('uint8')
            crop = cv2.rotate(ink[max(0, y - 3):y + h + 3, max(0, x - 3):x + w + 3], cv2.ROTATE_90_CLOCKWISE)   # texto lido de baixo p/ cima
            out.append({'x': (x + w / 2) / W, 'y': (y + h / 2) / H, 'box': (x, y, w, h), 'crop': crop})
    return out

result = {}
for yd in yards:
    if only and yd['id'] not in only: continue
    f = root / yd['planta']
    if not f.exists(): print('sem planta:', yd['id']); continue
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', str(f)], capture_output=True, text=True).stdout).group(1))
    pages = []
    for p in range(1, n + 1):
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(['pdftoppm', '-f', str(p), '-l', str(p), '-r', str(DPI), '-png', str(f), td + '/p'], check=True)
            rgb = np.array(Image.open(next(Path(td).glob('p*.png'))).convert('RGB'))
        labs = find_labels(rgb)
        marks, sheet = [], []
        for L in labs:
            votes = read_label(L['crop'])
            key = f"{yd['id']}:{p}:{L['x']:.2f}"
            if key in fixes and votes: km, why = int(fixes[key]), 'corrigido'   # só vale se o OCR leu um KM válido nesse ponto
            elif votes: km, why = int(votes.most_common(1)[0][0].replace('+', '')), f'{votes.most_common(1)[0][1]}/{sum(votes.values())}'
            else: continue
            marks.append({'km': km, 'x': round(L['x'], 5), 'y': round(L['y'], 5)})
            sheet.append((L['x'], km, why, L['crop'], key))
        marks.sort(key=lambda m: m['x'])
        print(f"{yd['id']} p{p}: {len(marks)} marcadores", [m['km'] for m in marks], flush=True)
        if sheet:
            sheet.sort(key=lambda s: s[0]); rows = []
            for x, km, why, crop, key in sheet:
                c = 255 - cv2.resize(crop, None, fx=1.0, fy=1.0)
                im = Image.fromarray(c).convert('RGB'); canvas = Image.new('RGB', (max(im.width, 330) + 360, im.height + 8), 'white')
                canvas.paste(im, (4, 4)); ImageDraw.Draw(canvas).text((im.width + 14, 6), f"{km // 1000}+{km % 1000:03d}  [{why}]  {key}", fill=(200, 0, 0))
                rows.append(canvas)
            Wd = max(r.width for r in rows); Ht = sum(r.height for r in rows)
            S = Image.new('RGB', (Wd, Ht), 'white'); yy = 0
            for r_ in rows: S.paste(r_, (0, yy)); yy += r_.height
            S.save(dbg / f"{yd['id']}-p{p}.png")
        if marks: pages.append({'page': p, 'marks': marks})
    if pages: result[yd['id']] = {'planta': yd['planta'], 'pages': pages}

out = root / 'data' / 'kms.json'
prev = json.loads(out.read_text()) if out.exists() and only else {}
prev.update(result)
out.write_text(json.dumps(prev, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('gravado', out, '—', len(prev), 'pátios')
