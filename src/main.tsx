import React from 'react';
import ReactDOM from 'react-dom/client';
import '@daypicker/react/style.css';
import App from './App';
import { GlobalStyle } from './styles';
import { installTouchHaptics } from './haptics';
import { installCaretMotion } from './textEntry';
import { applyStoredAppearance } from './preferences';
import { migrateLegacyStorage } from './legacyStorage';
import { loadWorkspaceArchive } from './todoStore';
import { WorkspaceTransition } from './components/WorkspaceTransition';

async function start() {
  await migrateLegacyStorage();
  applyStoredAppearance();

  installTouchHaptics();
  const removeCaretMotion = installCaretMotion();
  if (import.meta.hot) import.meta.hot.dispose(removeCaretMotion);

  const root = ReactDOM.createRoot(document.getElementById('root')!);
  const archive = await loadWorkspaceArchive();
  const renderApp = () => root.render(<React.StrictMode><GlobalStyle /><App /></React.StrictMode>);
  if (archive) root.render(<React.StrictMode><GlobalStyle /><WorkspaceTransition archive={archive} onReady={renderApp}/></React.StrictMode>);
  else renderApp();
}

void start().catch(error => {
  const root = document.getElementById('root')!;
  root.setAttribute('role', 'alert');
  root.textContent = `Hot Cross Buns could not open saved data. The original data has been kept. Reload to retry. ${String(error)}`;
});
