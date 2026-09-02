import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { initTheme } from './store/uiStore';

import './index.css';

/**
 * Entry point.
 *
 * The theme is applied before React mounts so the page never paints light and
 * then flips to dark — a flash on every load of a tool someone stares at all day.
 */
initTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
