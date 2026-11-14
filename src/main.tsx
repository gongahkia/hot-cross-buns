import React from 'react';
import ReactDOM from 'react-dom/client';
import '@daypicker/react/style.css';
import App from './App';
import { GlobalStyle } from './styles';
import { installTouchHaptics } from './haptics';
import { applyStoredAppearance } from './preferences';
import { migrateLegacyStorage } from './legacyStorage';

async function start() {
  await migrateLegacyStorage();
  applyStoredAppearance();

  installTouchHaptics();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><GlobalStyle /><App /></React.StrictMode>,
  );
}

void start().catch(error => {
  const root = document.getElementById('root')!;
  root.setAttribute('role', 'alert');
  root.textContent = `Hot Cross Buns could not open saved data. The original data has been kept. Reload to retry. ${String(error)}`;
});
