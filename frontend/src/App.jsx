import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Main from './pages/main/main';
import Worldview from './pages/worldview/worldview';
import Intro from './pages/intro/intro';
import Chat from './pages/chat/ui';
import ChatList from './pages/chatlist/chatlist';

function App() {
  useEffect(() => {
    // 앱이 처음 켜질 때 로컬 스토리지에서 테마를 읽어와 html 태그에 세팅
    const savedTheme = localStorage.getItem('selectedTheme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-author', savedTheme);
    } else {
      // 값이 없으면 기본값인 author1 (백야) 셋팅
      document.documentElement.setAttribute('data-author', 'author1');
    }
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Main />} />
        <Route path="/worldview" element={<Worldview />} />
        <Route path="/intro" element={<Intro />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/chatlist" element={<ChatList />} />
      </Routes>
    </Router>
  );
}

export default App;