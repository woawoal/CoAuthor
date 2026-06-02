import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Main from './pages/main/main';
/*import Write from './pages/write/write';*/

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Main />} />
        {/* <Route path="/write" element={<Write />} /> */}
      </Routes>
    </Router>
  );
}

export default App;