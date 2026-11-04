import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { preventDoubleTapZoom } from './ui/doubleTap';

// iOS sceglie il colore della barra di stato solo quando la pagina si carica: se il tema di
// sistema cambia con l'app aperta resterebbe quello vecchio. Mai a form aperto, per non perdere dati.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.querySelector('[role="dialog"]')) window.location.reload();
});

// Chiede a iOS di non cancellare i dati in caso di poco spazio: non è garantito, il backup resta necessario.
void navigator.storage?.persist?.().catch(() => {});

preventDoubleTapZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
