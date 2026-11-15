import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Tipografías OFL 1.1 empaquetadas (sin peticiones a terceros): títulos, texto y cifras.
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import './i18n';
import { preloadModels } from './models/Models';
import { App } from './app/App';

preloadModels();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
