#!/usr/bin/env python3
"""Gera miniaturas (1ª página) e metadados (nº de páginas) dos PDFs listados em data.js.
Uso:  python3 tools/gerar-miniaturas.py     (requer poppler-utils e Pillow)
Saída: thumbs/*.webp  e  data/meta.json
Rode novamente sempre que adicionar/trocar PDFs."""
import json, re, subprocess, os, tempfile, sys
from pathlib import Path
from PIL import Image, ImageChops
root = Path(__file__).resolve().parent.parent
txt = (root/'data.js').read_text(encoding='utf-8')
data = json.loads(re.search(r'window\.PATIOS\s*=\s*(\[.*\])\s*;?\s*$', txt, re.S).group(1))
paths = []
for p in data:
    paths.append(p['planta']); paths += [i['pdf'] for i in p['itens']]
est = json.loads((root/'data'/'estudos.json').read_text(encoding='utf-8')) if (root/'data'/'estudos.json').exists() else []
estudos = [d['pdf'] for c in est for d in c['docs']]   # material de estudo: colorido (sem a conversão monocromática das plantas)
paths += estudos
(root/'thumbs').mkdir(exist_ok=True)
meta = {}
for rel in dict.fromkeys(paths):
    f = root/rel
    if not f.exists(): print('ausente:', rel); continue
    info = subprocess.run(['pdfinfo', str(f)], capture_output=True, text=True).stdout
    pages = int(re.search(r'Pages:\s+(\d+)', info).group(1))
    size = re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', info)
    name = f.stem
    out = root/'thumbs'/f'{f.parent.name}-{name}.webp'
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(['pdftoppm','-f','1','-l','1','-r','60','-png',str(f),td+'/p'],check=True)
        png = next(Path(td).glob('p*.png'))
        im = Image.open(png).convert('RGB'); im.thumbnail((640,640))
        color = rel in estudos
        r, g, b = im.split()   # monocromático: menor canal = "tinta" (preto no tema claro; o CSS inverte no escuro)
        if not color: im = ImageChops.darker(ImageChops.darker(r, g), b).convert('RGB')
        im.save(out,'WEBP',quality=72,method=6)
    meta[rel] = {'pages': pages, 'thumb': f'thumbs/{out.name}', 'w': float(size.group(1)), 'h': float(size.group(2)), 'kb': round(f.stat().st_size/1024), **({'color': True} if color else {})}
(root/'data'/'meta.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
print(len(meta), 'PDFs processados')
