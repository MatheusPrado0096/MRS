# Portal de Pátios • MRS Logística (v2)

Portal estático (HTML + CSS + JavaScript puro, **sem build**) para consultar plantas de pátios e documentos de abrigos, PNs e CXs.
Funciona direto no **GitHub Pages**.

## O que mudou em relação à v1
- Visual novo com a logo da MRS, tema claro/escuro (segue o sistema), animações e navegação inferior no celular.
- Cards com **miniatura da 1ª página** de cada PDF, contador de páginas, favoritos (★) e busca com destaque.
- **Visualizador de PDF reescrito**
  - Zoom por **pinça** no celular, arrastar com inércia, **toque duplo** para ampliar/voltar, deslizar para trocar de página.
  - Mouse: roda = zoom no cursor, arrastar = mover, duplo clique. Teclado: `+` `-` `0` setas `PgUp/PgDn` `R` (girar) `N` (modo noturno) `F` (tela cheia) `Esc`.
  - Renderiza só a área visível, então fica **nítido em qualquer ampliação** sem travar o celular.
  - Grade de páginas (miniaturas), girar página, modo noturno do documento, compartilhar link, baixar PDF, abrir localização.
  - Botão "Voltar" do celular fecha o visualizador; cada documento tem link direto (`#equipamentos/FSJ?ver=docs/...pdf`).
- **Busca por KM** (formato `364+520`, também `364520`, `364,520` ou só `364`): informe o KM da ocorrência e o portal mostra **em qual pátio** ele está e abre a planta com um **alfinete** e uma linha vertical no ponto exato (interpolado entre os marcos de KM desenhados na planta). Se nenhum pátio cobrir o KM, mostra o mais próximo.
  O campo fica na página inicial e na aba Pesquisa; o link do resultado (`...?ver=docs/plantas/FCA.pdf&km=364620`) pode ser compartilhado.
- **Download com as cores corrigidas:** o botão de download oferece PDF **claro** (linhas pretas no branco), **escuro** (linhas brancas no preto) ou **original**. O arquivo é gerado no próprio navegador (continua vetorial, mesma qualidade).
- pdf.js agora vai **dentro do repositório** (`assets/vendor/pdfjs`), sem depender de CDN.

## Publicar no GitHub Pages
1. Crie um repositório e envie estes arquivos (branch `main`).
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. Acesse `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

> Teste local: `python3 -m http.server 8000` e abra http://localhost:8000 (abrir o `index.html` com duplo clique não funciona, por causa dos módulos JS).

## Como atualizar o conteúdo
- **Pátios, itens, nomes, KMs e links do mapa:** edite `data.js` (mesmo formato da v1).
- **PDFs:** coloque as plantas em `docs/plantas/` e os documentos em `docs/equipamentos/`, com o nome igual ao campo `planta`/`pdf` do `data.js`.
- **Depois de adicionar/trocar PDFs**, regenere as miniaturas e a contagem de páginas:
  ```bash
  python3 tools/gerar-miniaturas.py   # requer poppler-utils e Pillow
  ```
  Isso atualiza `thumbs/` e `data/meta.json`. Itens cujo PDF não existe aparecem como **"PDF em breve"** (sem quebrar nada).

## Busca por KM — como funciona e como atualizar
As plantas são desenhos vetoriais sem texto pesquisável, então os marcos de KM (`000+000`, texto ciano na vertical) são lidos por OCR:
```bash
python3 tools/extrair-kms.py          # ou: python3 tools/extrair-kms.py FPI   (só um pátio)
```
(requer `poppler-utils`, `tesseract-ocr`, `opencv-python`, `numpy`, `Pillow`). Gera `data/kms.json` e, em `data/kms-debug/`, uma folha de conferência por página (recorte de cada marco + valor lido).
Se algum valor sair errado, corrija em `tools/kms-correcoes.json` (`"PÁTIO:página:x": km_em_metros`, a chave aparece na folha de conferência) e rode de novo.
- O alfinete é posicionado por interpolação linear entre dois marcos vizinhos (≤ 1,5 km de distância entre si); a planta é esquemática, então a posição é uma **referência visual**, não uma medição.
- Pátios sem planta enviada (IEF, FGA, FCE) ainda não entram na busca por KM.

## Antes de publicar uma atualização
Rode `python3 tools/versionar.py`: ele carimba uma versão (`?v=...`) nos arquivos JS/CSS/dados. Sem isso, o celular pode guardar um `app.js` antigo em cache e o site novo "não responder" (o GitHub Pages deixa o navegador reaproveitar arquivos por ~10 minutos).

## Estrutura
```
index.html            página única
data.js               cadastro dos pátios/itens
data/meta.json        (gerado) páginas, tamanho e miniatura de cada PDF
data/kms.json         (gerado) marcos de KM lidos de cada planta
thumbs/               (gerado) miniaturas
docs/                 PDFs
assets/css/style.css  estilos
assets/js/app.js      interface, busca, rotas
assets/js/viewer.js   visualizador de PDF (zoom, pinça, alfinete de KM)
assets/js/km.js       busca por KM
assets/js/pdfexport.js geração do PDF claro/escuro para download
assets/vendor/pdfjs   pdf.js (Apache-2.0)
assets/img/           logo e ícones
tools/                scripts auxiliares
```

## Observações sobre os dados recebidos
- Os PDFs de FCA, FEA, FEM, FSJ01, FGA, FCE e as plantas de IEF/FGA/FCE não estavam no zip enviado; aparecem como "em breve" até serem adicionados.
- `IEF10` apontava para `IEF01.pdf` (mesmo arquivo do `IEF01`); apontei para `IEF02.pdf`, que existia sem uso. Se não for isso, ajuste em `data.js`.


## Aba Estudos e Portal de acesso
- A aba **Estudos** lista o material de aprendizagem por assunto (AMVs/Travador, Sinalização, Registrador Wabtec, Projetos/Aspect Charts, Ferrovias). Os PDFs ficam em `docs/estudos/<assunto>/` e são descritos em `data/estudos.json`.
- Para adicionar um material: copie o PDF para a pasta do assunto, acrescente uma entrada em `data/estudos.json` (ou crie um assunto novo) e rode `python3 tools/gerar-miniaturas.py` e `python3 tools/versionar.py`.
- Os PDFs de estudo abrem **coloridos** (as plantas continuam em preto e branco).
- O botão **Portal** no menu (e o cartão no topo de Estudos) abre https://linktr.ee/MRSPinheirinho em outra aba.
