import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { configureBackendBase } from '../shared/backend-client/transport.js';
import './styles.css';
import '../shared/ui/styles.css';
import './layout/layout.css';
import '../features/chat/layout/layout.css';
import './layout/application-layout.css';

declare global {
  interface Window { desktopAPI?: { apiBase: string } }
}

if (window.desktopAPI) configureBackendBase(window.desktopAPI.apiBase);

const root = document.getElementById('root');
if (!root) throw new Error('Missing app root');
createRoot(root).render(<App />);
