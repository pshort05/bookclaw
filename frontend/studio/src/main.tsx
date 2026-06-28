import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import '../../shared/src/tokens.css';
import '../../shared/src/fonts.js';
import { App } from './App.js';
import { DialogProvider } from './components/Dialog.js';
import { Board } from './routes/Board.js';
import { Activity } from './routes/Activity.js';
import { NewBook } from './routes/NewBook.js';
import { EasyStart } from './routes/EasyStart.js';
import { AssetStudio } from './routes/AssetStudio.js';
import { Write } from './routes/Write.js';
import { Settings } from './routes/Settings.js';
import { Confirmations } from './routes/Confirmations.js';
import { Files } from './routes/Files.js';
import { PromptRunner } from './routes/PromptRunner.js';
import { Consistency } from './routes/Consistency.js';
import { TryFail } from './routes/TryFail.js';
import { StructureLength } from './routes/StructureLength.js';
import { Reports } from './routes/Reports.js';
import { Series } from './routes/Series.js';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DialogProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
          <Route index element={<Board />} />
          <Route path="activity" element={<Activity />} />
          <Route path="new-book" element={<NewBook />} />
          <Route path="start" element={<EasyStart />} />
          <Route path="library" element={<AssetStudio />} />
          {/* Deep-link to a specific library kind (e.g. the top-level "Worlds" item). */}
          <Route path="library/:kind" element={<AssetStudio />} />
          <Route path="files" element={<Files />} />
          <Route path="prompt-runner" element={<PromptRunner />} />
          <Route path="consistency" element={<Consistency />} />
          <Route path="try-fail" element={<TryFail />} />
          <Route path="structure-length" element={<StructureLength />} />
          <Route path="reports" element={<Reports />} />
          <Route path="series" element={<Series />} />
          <Route path="write" element={<Write />} />
          <Route path="write/:slug" element={<Write />} />
          {/* Insights merged into Activity; redirect old links. */}
          <Route path="insights" element={<Navigate to="/activity" replace />} />
          <Route path="settings" element={<Settings />} />
          <Route path="confirmations" element={<Confirmations />} />
        </Route>
        </Routes>
      </BrowserRouter>
    </DialogProvider>
  </React.StrictMode>
);
