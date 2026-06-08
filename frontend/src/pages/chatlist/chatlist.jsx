import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSessions } from '../../lib/worldviewApi';
import './chatlist.css';

const STATUS_LABEL = {
  active: '진행 중',
  paused: '일시정지',
  completed: '완료',
};

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function ChatList() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleResume = (session) => {
    navigate('/chat', { state: { chatId: session.id } });
  };

  return (
    <div className="chatlist-container">
      <div className="chatlist-wrapper">
        <header className="chatlist-header">
          <button className="back-btn" onClick={() => navigate('/')}>← 돌아가기</button>
          <h2 className="chatlist-title">내 소설 목록</h2>
        </header>

        {loading && <p className="chatlist-empty">불러오는 중...</p>}

        {!loading && sessions.length === 0 && (
          <p className="chatlist-empty">아직 작성한 소설이 없어요.<br />작가를 선택해 첫 세계관을 만들어보세요.</p>
        )}

        <div className="chatlist-grid">
          {sessions.map((s) => (
            <div key={s.id} className="chatlist-card">
              <div className="chatlist-card__body">
                <h3 className="chatlist-card__title">{s.world_title}</h3>
                <div className="chatlist-card__meta">
                  <span className={`status-badge status-badge--${s.status}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  <span className="chatlist-card__date">{formatDate(s.started_at)}</span>
                </div>
              </div>
              <button className="chatlist-card__btn" onClick={() => handleResume(s)}>
                이어쓰기 →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
