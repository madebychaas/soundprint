import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/outfit';
import '@fontsource/dm-mono/300.css';
import '@fontsource/dm-mono/400.css';
import './styles.css';
import App from './App';
import { useUi } from './store';
import { instrument, PADS } from './engine/instrument';

// ?q=high|low forces a rendering tier
const q = new URLSearchParams(window.location.search).get('q');
if (q === 'high' || q === 'low') useUi.setState({ quality: q });

// handle for automated checks
(window as unknown as Record<string, unknown>).__st = { ui: useUi, instrument, PADS };

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
