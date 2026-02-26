# FocusTab

Extensao de nova aba (MV3) com foco em produtividade local-only.

## Stack

- WXT + React + TypeScript
- chrome.storage.local para preferencias
- lucide-react para icones

## Scripts

- `npm run dev`: desenvolvimento
- `npm run build`: build de producao
- `npm run zip`: gera zip para distribuicao manual

## Como carregar no Chrome

1. Rode `npm install`.
2. Rode `npm run build`.
3. Abra `chrome://extensions`.
4. Ative `Developer mode`.
5. Clique em `Load unpacked` e selecione `.output/chrome-mv3`.
