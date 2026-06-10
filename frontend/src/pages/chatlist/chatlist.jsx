import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSessions, deleteSession } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import './chatlist.css';

const STATUS_LABEL = {
  active: '진행 중',
  paused: '일시정지',
  completed: '완료',
};

const AUTHOR_NAME = {
  1: '백야',
  2: '차로운',
  3: '한여름',
  4: '김도현',
};

function GenreTags({ genre }) {
  if (!genre) return null;
  const tags = genre.split(/[,/]/).map(t => t.trim()).filter(Boolean);
  return (
    <div className="chatlist-card__tags">
      {tags.map(tag => <span key={tag} className="genre-tag">#{tag}</span>)}
    </div>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function ChatList() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  // 목록은 작가가 여러 명 — 마지막으로 쓴 작가 테마(localStorage) 유지
  useAuthorTheme(resolveAuthorId(null));

  useEffect(() => {
    getSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleResume = (session) => {
    navigate('/chat', { state: { chatId: session.id, authorId: session.author_id } });
  };

  const handleRead = (session) => {
    navigate(`/read/${session.id}`);
  };

  const handleDelete = async (session) => {
    if (!window.confirm(`"${session.world_title}" 세션을 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await deleteSession(session.id);
      setSessions(prev => prev.filter(s => s.id !== session.id));
    } catch (err) {
      alert(`삭제 실패: ${err.message}`);
    }
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
                <GenreTags genre={s.world_genre} />
                <div className="chatlist-card__meta">
                  <span className={`status-badge status-badge--${s.status}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  {s.author_id && (
                    <span className="chatlist-card__author">✒ {AUTHOR_NAME[s.author_id]}</span>
                  )}
                  <span className="chatlist-card__date">{formatDate(s.started_at)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {s.status === 'completed' && (
                  <button className="chatlist-card__btn chatlist-card__btn--read" onClick={() => handleRead(s)}>
                    읽기
                  </button>
                )}
                <button className="chatlist-card__btn" onClick={() => handleResume(s)}>
                  이어쓰기 →
                </button>
                <button className="chatlist-card__btn chatlist-card__btn--delete" onClick={() => handleDelete(s)}>
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
