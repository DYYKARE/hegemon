import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {installGlobalErrorLogging} from './log.ts';
import './index.css';

// Yakalanmamış hatalar/promise redleri log halkasına düşer (saha teşhisi)
installGlobalErrorLogging();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Otomatik Play-Test Döngüsü (yalnız DEV + ?playtest ile): gerçek UI üzerinde
// Setup → Interact → Assert → Log → Loop koşucusu. Prod build'e girmez
// (koşullu dinamik import — Vite dead-code eliminasyonu).
if (import.meta.env.DEV && new URLSearchParams(location.search).has('playtest')) {
  import('./test/playtest').then(m => m.installPlayTest());
}
