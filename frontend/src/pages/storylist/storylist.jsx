import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSessions, deleteSession } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import { toast } from '../../lib/toast';
import './storylist.css';
import LoadingVideo from '../../components/loadingVideo';

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
    <div className="storylist-card__tags">
      {tags.map(tag => <span key={tag} className="genre-tag">#{tag}</span>)}
    </div>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function StoryList() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(true);
  useAuthorTheme(resolveAuthorId(null));

  useEffect(() => {
    getSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleResume = (session) => {
    const mode = localStorage.getItem(`session_mode_${session.id}`) ?? 'chat';
    const dest = mode === 'editor' ? '/editor' : '/chat';
    navigate(dest, { state: { chatId: session.id, authorId: session.author_id } });
  };

  const handleRead = (session) => {
    // 작가 테마 즉시 적용 위해 authorId 전달(없으면 read가 직전 작가 색으로 깜빡임)
    navigate(`/read/${session.id}`, { state: { authorId: session.author_id } });
  };

  const handleDelete = async (session) => {
    if (!window.confirm(`"${session.world_title}" 세션을 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await deleteSession(session.id);
      setSessions(prev => prev.filter(s => s.id !== session.id));
    } catch (err) {
      toast(`삭제 실패: ${err.message}`, "error");
    }
  };

  return (
    <div className="storylist-container">
      {showLoading && (
        <LoadingVideo
          loading={loading}
          onFinish={() => setShowLoading(false)}
        />
      )}

      <div className="storylist-wrapper">
        <header className="storylist-header">
          <button className="storylist-back-btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>‹</button>
          <h2 className="storylist-title">내 소설 목록</h2>
          <div className="storylist-header__actions">
            <button className="back-btn" onClick={() => navigate('/')}>← 메인화면</button>
            <button className="back-btn storylist-mypage-btn" onClick={() => navigate('/mypage')}>📚 내 서재</button>
          </div>
        </header>

        {!loading && sessions.length === 0 && (
          <p className="storylist-empty">아직 작성한 소설이 없어요.<br />작가를 선택해 첫 세계관을 만들어보세요.</p>
        )}

        <div className="storylist-grid">
          {sessions.map((s) => (
            <div key={s.id} className="storylist-card">
              <div className="storylist-card__body">
                <h3 className="storylist-card__title">{s.world_title}</h3>
                <GenreTags genre={s.world_genre} />
                <div className="storylist-card__meta">
                  <span className={`status-badge status-badge--${s.status}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  {s.author_id && (
                    <span className="storylist-card__author">✒ {AUTHOR_NAME[s.author_id]}</span>
                  )}
                  <span className="storylist-card__date">{formatDate(s.started_at)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {s.status === 'completed' && (
                  <button className="storylist-card__btn storylist-card__btn--read" onClick={() => handleRead(s)}>
                    읽기
                  </button>
                )}
                <button className="storylist-card__btn" onClick={() => handleResume(s)}>
                  이어쓰기 →
                </button>
                <button className="storylist-card__btn storylist-card__btn--delete" onClick={() => handleDelete(s)}>
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
