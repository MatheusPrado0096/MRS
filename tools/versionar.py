#!/usr/bin/env python3
"""Carimba uma nova versão (?v=...) nos arquivos JS/CSS/dados referenciados, para o celular não usar cópia antiga em cache.
O GitHub Pages deixa o navegador guardar arquivos por ~10 min; sem isso, o celular pode misturar um index.html novo
com um app.js velho (ex.: botão que "não faz nada"). Rode antes de cada publicação:   python3 tools/versionar.py"""
import re, time
from pathlib import Path
root = Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M')
def stamp(path, pats):
    f = root / path; s = f.read_text(encoding='utf-8')
    for p in pats: s = re.sub(p, lambda m: m.group(1) + '?v=' + v + m.group(2), s)
    f.write_text(s, encoding='utf-8')
stamp('index.html', [r'(assets/css/style\.css)(?:\?v=\w+)?(")', r'(href="manifest\.webmanifest)(?:\?v=\w+)?(")', r'(src="data\.js)(?:\?v=\w+)?(")', r'(assets/js/app\.js)(?:\?v=\w+)?(")'])
stamp('assets/js/app.js', [r"(from '\./(?:viewer|km)\.js)(?:\?v=\w+)?(')", r"(fetch\('data/(?:meta|kms)\.json)(?:\?v=\w+)?(')"])
stamp('assets/js/viewer.js', [r"(from '\./km\.js)(?:\?v=\w+)?(')", r"(import\('\./pdfexport\.js)(?:\?v=\w+)?(')"])
print('versão', v)
