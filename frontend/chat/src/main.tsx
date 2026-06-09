import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/src/tokens.css';
import '../../shared/src/fonts.js';
import { App } from './App.js';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
