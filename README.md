# Finanze

Web app per le finanze personali, installabile sulla Home dell'iPhone. Funziona offline.

Questo repository contiene solo codice. I dati restano sul telefono, in IndexedDB: non esistono backend, account, analytics o API esterne, e una Content-Security-Policy blocca ogni connessione verso altri siti. Il backup è un file JSON che esporti tu.

## Sviluppo

Serve Node 26 (vedi `.nvmrc`).

```bash
npm install
npm run dev
npm test
```

`npm run icons` rigenera le icone in `public/`.

## Pubblicazione

Ogni push su `main` esegue i test e pubblica l'app su GitHub Pages con la GitHub Action in `.github/workflows/deploy.yml`. In GitHub, Settings → Pages → Source deve essere impostato su "GitHub Actions".
