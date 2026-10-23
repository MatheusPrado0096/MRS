#!/usr/bin/env python3
"""Indexa o texto dos PDFs de Aprendizagem (data/estudos.json) para a pesquisa por conteúdo.
Usa o texto do PDF; páginas sem texto (escaneadas) passam por OCR com tesseract.
Uso: python3 tools/indexar-aprendizagem.py      (requer poppler-utils e tesseract-ocr)
Saída: data/aprendizagem-texto.json  {pdf: [texto da pág. 1, pág. 2, ...]}"""
import json, re, subprocess, tempfile
from pathlib import Path
root = Path(__file__).resolve().parent.parent
est = json.loads((root / 'data' / 'estudos.json').read_text(encoding='utf-8'))
cache_f = root / 'data' / 'aprendizagem-texto.json'
cache = json.loads(cache_f.read_text(encoding='utf-8')) if cache_f.exists() else {}
langs = subprocess.run(['tesseract', '--list-langs'], capture_output=True, text=True).stdout
lang = 'por+eng' if 'por' in langs else 'eng'
clean = lambda t: re.sub(r'\s+', ' ', t.replace('\x0c', ' ')).strip()
out = {}
for c in est:
    for d in c['docs']:
        f = root / d['pdf']
        if not f.exists(): continue
        key = d['pdf']; size = f.stat().st_size
        if key in cache and cache[key].get('size') == size: out[key] = cache[key]; continue
        n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', str(f)], capture_output=True, text=True).stdout).group(1))
        pages = []
        for p in range(1, n + 1):
            t = clean(subprocess.run(['pdftotext', '-f', str(p), '-l', str(p), str(f), '-'], capture_output=True, text=True).stdout)
            if len(t) < 40:   # página escaneada: OCR
                with tempfile.TemporaryDirectory() as td:
                    subprocess.run(['pdftoppm', '-f', str(p), '-l', str(p), '-r', '170', '-png', str(f), td + '/p'], check=True)
                    img = next(Path(td).glob('p*.png'))
                    t = clean(subprocess.run(['tesseract', str(img), '-', '-l', lang, '--psm', '3'], capture_output=True, text=True).stdout)
            pages.append(t)
        out[key] = {'size': size, 'pages': pages}
        print(key, n, 'páginas,', sum(len(x) for x in pages), 'caracteres', flush=True)
cache_f.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('gravado', cache_f)
