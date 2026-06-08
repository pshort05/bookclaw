import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import '../../shared/src/tokens.css';
import '../../shared/src/fonts.js';
import { App } from './App.js';
import { Board } from './routes/Board.js';
import { Activity } from './routes/Activity.js';
import { NewBook } from './routes/NewBook.js';
import { AssetStudio } from './routes/AssetStudio.js';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Board />} />
          <Route path="activity" element={<Activity />} />
          <Route path="new-book" element={<NewBook />} />
          <Route path="library" element={<AssetStudio />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
