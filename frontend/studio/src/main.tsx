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
import { Write } from './routes/Write.js';
import { Insights } from './routes/Insights.js';
import { Settings } from './routes/Settings.js';
import { Confirmations } from './routes/Confirmations.js';
import { Files } from './routes/Files.js';
import { PromptRunner } from './routes/PromptRunner.js';
import { Series } from './routes/Series.js';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Board />} />
          <Route path="activity" element={<Activity />} />
          <Route path="new-book" element={<NewBook />} />
          <Route path="library" element={<AssetStudio />} />
          <Route path="files" element={<Files />} />
          <Route path="prompt-runner" element={<PromptRunner />} />
          <Route path="series" element={<Series />} />
          <Route path="write" element={<Write />} />
          <Route path="write/:slug" element={<Write />} />
          <Route path="insights" element={<Insights />} />
          <Route path="settings" element={<Settings />} />
          <Route path="confirmations" element={<Confirmations />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
