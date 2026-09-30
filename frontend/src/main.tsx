import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing app root');
createRoot(root).render(<App />);
