import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ArtesApp from './ArtesApp.jsx';
import DebugPage from './pages/DebugPage.jsx';
import { debugAllowed } from './utils/debugAccess.js';
import './App.css';
import './index.css';

export default function App() {
  const allowDebug = debugAllowed();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ArtesApp />} />
        {allowDebug && <Route path="/debug" element={<DebugPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
