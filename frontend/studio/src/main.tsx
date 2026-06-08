import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import '../../shared/src/tokens.css';
import '../../shared/src/fonts.js';
import { App } from './App.js';
import { Board } from './routes/Board.js';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes><Route element={<App />}><Route index element={<Board />} /></Route></Routes>
    </BrowserRouter>
  </React.StrictMode>
);
