import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import './styles.css';
// Solana dependencies read Buffer while their modules are evaluated.
// Load the app only after the browser polyfill has been installed.
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
void import('./App').then(({ default: App }) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
});
