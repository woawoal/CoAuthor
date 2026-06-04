import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Main from './pages/main/main';
import Write from './pages/write/write';
import Chat from './pages/chat/ui';
import Worldview from './pages/worldview/worldview';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Main />} />
        <Route path="/write" element={<Write />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/worldview" element={<Worldview />} />
      </Routes>
    </Router>
  );
}

export default App;