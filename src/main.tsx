import React from 'react';
import ReactDOM from 'react-dom/client';
import '@daypicker/react/style.css';
import App from './App';
import { GlobalStyle } from './styles';
import { installTouchHaptics } from './haptics';
import { installCaretMotion } from './textEntry';
import { applyStoredAppearance } from './preferences';
import { migrateLegacyStorage } from './legacyStorage';
import { loadWorkspaceArchive, loadTodoState, readBrowserRecovery } from './todoStore';
import { WorkspaceTransition } from './components/WorkspaceTransition';
import { downloadTextFile } from './files';
import { recordMarkdownDuration } from './markdownMeasurements';

async function start() {
  await migrateLegacyStorage();
  applyStoredAppearance();

  installTouchHaptics();
  const removeCaretMotion = installCaretMotion();
  if (import.meta.hot) import.meta.hot.dispose(removeCaretMotion);

  const root = ReactDOM.createRoot(document.getElementById('root')!);
  const archive = await loadWorkspaceArchive();
  const renderApp = () => root.render(<React.StrictMode><GlobalStyle />{import.meta.env.VITE_HCB_MARKDOWN_PROFILE === '1' ? <React.Profiler id="journal" onRender={(_id, _phase, duration) => recordMarkdownDuration('reactRender', duration)}><App/></React.Profiler> : <App/>}</React.StrictMode>);
  if (archive) root.render(<React.StrictMode><GlobalStyle /><WorkspaceTransition archive={archive} onReady={renderApp}/></React.StrictMode>);
  else { await loadTodoState(); renderApp(); }
}

void start().catch(error => {
  const root = document.getElementById('root')!;
  root.setAttribute('role', 'alert');
  root.textContent = `Hot Cross Buns could not open saved data. The original data has been kept. Reload to retry. ${String(error)}`;
  const recover = document.createElement('button');
  recover.textContent = 'Download browser recovery';
  recover.onclick = async () => {
    recover.disabled = true;
    try {
      const records = await readBrowserRecovery();
      const raw = JSON.stringify({ format: 'hcb-browser-recovery-1', ...records }, (_key,value) =>
        value && typeof value === 'object' && ['file','directory'].includes(value.kind) && typeof value.name === 'string'
          ? { kind: value.kind, name: value.name, browserHandleKept: true } : value, 2);
      downloadTextFile(raw,'Hot-Cross-Buns-browser-recovery.json');
    } catch (cause) { const message = document.createElement('p'); message.textContent = `Recovery could not be downloaded. Browser data is still kept. ${String(cause)}`; root.append(message); }
    finally { recover.disabled = false; }
  };
  root.append(recover);
});
