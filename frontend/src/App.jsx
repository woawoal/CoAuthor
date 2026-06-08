import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Main from './pages/main/main';
/*import Write from './pages/write/write';*/
import Worldview from './pages/worldview/worldview';
import Intro from './pages/intro/intro';
import Chat from './pages/chat/ui';
import ChatList from './pages/chatlist/chatlist';
import ReadNovel from './pages/read/read';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Main />} />
        <Route path="/worldview" element={<Worldview />} />
        <Route path="/intro" element={<Intro />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/chatlist" element={<ChatList />} />
        <Route path="/read/:storyId" element={<ReadNovel />} />
      </Routes>
    </Router>
  );
}

export default App;