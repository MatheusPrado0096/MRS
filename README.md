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

## Estrutura
```
index.html            página única
data.js               cadastro dos pátios/itens
data/meta.json        (gerado) páginas, tamanho e miniatura de cada PDF
thumbs/               (gerado) miniaturas
docs/                 PDFs
assets/css/style.css  estilos
assets/js/app.js      interface, busca, rotas
assets/js/viewer.js   visualizador de PDF
assets/vendor/pdfjs   pdf.js (Apache-2.0)
assets/img/           logo e ícones
tools/                scripts auxiliares.
```

## Observações sobre os dados recebidos
- Os PDFs de FCA, FEA, FEM, FSJ01, FGA, FCE e as plantas de IEF/FGA/FCE não estavam no zip enviado; aparecem como "em breve" até serem adicionados.
- `IEF10` apontava para `IEF01.pdf` (mesmo arquivo do `IEF01`); apontei para `IEF02.pdf`, que existia sem uso. Se não for isso, ajuste em `data.js`.
