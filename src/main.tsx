import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './design/tokens.css';
import App from './App';
import { scheduler, useStore } from './store/useStore';

// Dev/test hook: lets Playwright and the browser console drive the transport.
if (import.meta.env.DEV) {
  (window as unknown as { __tokenscope: unknown }).__tokenscope = { scheduler, useStore };
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
