import React from 'react';
import ReactDOM from 'react-dom/client';
import '@daypicker/react/style.css';
import App from './App';
import { GlobalStyle } from './styles';
import { installTouchHaptics } from './haptics';
import { applyStoredAppearance } from './preferences';

applyStoredAppearance();

installTouchHaptics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><GlobalStyle /><App /></React.StrictMode>,
);
