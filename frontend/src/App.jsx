import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Main from './pages/main/main';
/*import Write from './pages/write/write';*/
import Worldview from './pages/worldview/worldview';
import Intro from './pages/intro/intro';
import Chat from './pages/chat/ui';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Main />} />
        <Route path="/worldview" element={<Worldview />} />
        <Route path="/intro" element={<Intro />} />
        <Route path="/chat" element={<Chat />} />
      </Routes>
    </Router>
  );
}

export default App;