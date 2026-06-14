import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getNovel, generateNovel } from '../../lib/chatApi';
import { toast } from '../../lib/toast';
import { getSession, getWorld } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import LoadingVideo from '../../components/loadingVideo';
import './read.css';

const CHAPTER_SIZE = 5;

const AUTHOR_NAME = {
  1: '백야',
  2: '차로운',
  3: '한여름',
  4: '김도현',
};

function parseChapters(content) {
  if (!content) return [];
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
  const chapters = [];
  for (let i = 0; i < paragraphs.length; i += CHAPTER_SIZE) {
    const num = chapters.length + 1;
    chapters.push({
      idx: chapters.length,
      title: `제 ${num}장`,
      paragraphs: paragraphs.slice(i, i + CHAPTER_SIZE),
    });
  }
  if (chapters.length === 0 && paragraphs.length > 0) {
    chapters.push({ idx: 0, title: '제 1장', paragraphs });
  }
  return chapters;
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

export default function ReadNovel() {
  const { storyId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [novel, setNovel] = useState(null);
  const [session, setSession] = useState(null);
  const [world, setWorld] = useState(null);
  const [error, setError] = useState(null);
  const [fontSize, setFontSize] = useState(16);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeChapter, setActiveChapter] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const chapterRefs = useRef([]);

  // 작가별 테마: 세션 로드 후 session.author_id(진짜 값), 그 전엔 네비게이션으로 받은 authorId,
  // 둘 다 없을 때만 localStorage 폴백 → 직전 작가 색 깜빡임 방지
  useAuthorTheme(session?.author_id ?? location.state?.authorId ?? resolveAuthorId(null));

  useEffect(() => {
    async function load() {
      try {
        const [novelData, sessionData] = await Promise.all([
          getNovel(storyId),
          getSession(storyId),
        ]);
        setNovel(novelData);
        setSession(sessionData);
        const worldData = await getWorld(sessionData.world_id);
        setWorld(worldData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [storyId]);

  const handleScroll = useCallback(() => {
    const scrollTop = window.scrollY;
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docH > 0 ? Math.round((scrollTop / docH) * 100) : 0;
    setProgress(pct);
    chapterRefs.current.forEach((el, i) => {
      if (el && el.getBoundingClientRect().top < 120) setActiveChapter(i);
    });
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const scrollToChapter = (idx) => {
    chapterRefs.current[idx]?.scrollIntoView({ behavior: 'smooth' });
    setActiveChapter(idx);
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const fresh = await generateNovel(storyId);
      setNovel(fresh);
      if (!(fresh?.content || '').trim()) {
        toast('대화가 짧아 변환할 내용이 부족해요. 이어쓰기로 대화를 더 진행해보세요.', 'info');
      } else {
        toast('소설로 변환했어요.', 'success');
      }
    } catch {
      toast('소설 변환에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
    } finally {
      setRegenerating(false);
    }
  };

  const handleExport = () => {
    if (!novel) return;
    const blob = new Blob([novel.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${novel.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!loading && (error || !novel)) {
    return (
      <div className="read-page">
        <div className="read-empty">
          <p>{error ?? '소설을 찾을 수 없습니다.'}</p>
          <button onClick={() => navigate('/storylist')}>목록으로</button>
        </div>
      </div>
    );
  }

  const content = novel?.content ?? '';
  if (!loading && novel && !content.trim()) {
    return (
      <div className="read-page">
        <div className="read-empty">
          <p>아직 변환된 소설 본문이 없어요.</p>
          <p className="read-empty__sub">대화를 조금 더 진행하거나 다시 변환해보세요.</p>
          <div className="read-empty__actions">
            <button className="read-empty__btn read-empty__btn--primary" onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? '변환 중…' : '다시 변환'}
            </button>
            <button className="read-empty__btn" onClick={() => navigate('/chat', { state: { chatId: storyId } })}>
              이어쓰기
            </button>
            <button className="read-empty__btn" onClick={() => navigate('/storylist')}>
              목록으로
            </button>
          </div>
        </div>
      </div>
    );
  }
  const chapters = parseChapters(content);
  const wordCount = content.replace(/\s+/g, '').length;
  const readingMins = Math.max(1, Math.ceil(wordCount / 350));

  return (
    <div className="read-page" onClick={() => setFontPanelOpen(false)}>
      {showLoading && (
        <LoadingVideo
          loading={loading}
          onFinish={() => setShowLoading(false)}
        />
      )}

      <div className="read-top-bar">
        <div className="read-top-bar__left">
          <button className="read-back-btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/storylist'))}>
            ← 돌아가기
          </button>
          <span className="read-doc-title">{novel?.title ?? ''}</span>
        </div>
        <div className="read-top-bar__right" onClick={e => e.stopPropagation()}>
          <div style={{ position: 'relative' }}>
            <button
              className="read-icon-btn"
              title="글자 크기"
              onClick={() => setFontPanelOpen(p => !p)}
            >
              Aa
            </button>
            {fontPanelOpen && (
              <div className="read-font-panel">
                <div className="read-font-panel__label">글자 크기</div>
                <div className="read-font-size-row">
                  <button
                    className="read-fs-btn"
                    style={{ fontSize: '13px' }}
                    onClick={() => setFontSize(f => Math.max(14, f - 1))}
                  >A</button>
                  <span className="read-fs-val">{fontSize}px</span>
                  <button
                    className="read-fs-btn"
                    style={{ fontSize: '18px' }}
                    onClick={() => setFontSize(f => Math.min(20, f + 1))}
                  >A</button>
                </div>
              </div>
            )}
          </div>
          <button
            className={`read-icon-btn${bookmarked ? ' read-icon-btn--active' : ''}`}
            title="북마크"
            onClick={() => setBookmarked(b => !b)}
          >
            {bookmarked ? '★' : '☆'}
          </button>
          <button className="read-export-btn" onClick={handleExport}>
            ↓ 내보내기
          </button>
        </div>
      </div>

      <div className="read-layout">
        <aside className="read-sidebar">
          <div className="read-sidebar__label">목차</div>
          {chapters.map((ch, i) => (
            <div
              key={i}
              className={`read-toc-item${activeChapter === i ? ' read-toc-item--active' : ''}`}
              onClick={() => scrollToChapter(i)}
            >
              <span className="read-toc-num">{i + 1}</span>
              <span className="read-toc-text">{ch.title}</span>
            </div>
          ))}

          <div className="read-sidebar__divider" />

          <div className="read-sidebar__label">작품 정보</div>
          <div className="read-meta-row">
            <span>AI 작가</span>
            <span className="read-meta-val">{AUTHOR_NAME[session?.author_id] ?? '—'}</span>
          </div>
          <div className="read-meta-row">
            <span>장르</span>
            <span className="read-meta-val">{world?.genre ?? '—'}</span>
          </div>
          <div className="read-meta-row">
            <span>총 글자</span>
            <span className="read-meta-val">{wordCount.toLocaleString()}자</span>
          </div>
          <div className="read-meta-row">
            <span>예상 읽기</span>
            <span className="read-meta-val">약 {readingMins}분</span>
          </div>
          <div className="read-meta-row">
            <span>작성일</span>
            <span className="read-meta-val">{novel?.created_at ? formatDate(novel.created_at) : '—'}</span>
          </div>
        </aside>

        <main className="read-main-content">
          <div className="read-novel-cover">
            <div className="read-persona-badge">
              <span className="read-persona-badge__dot" />
              AI 작가 {AUTHOR_NAME[session?.author_id] ?? 'AI'}
            </div>
            <h1 className="read-novel-title">{novel?.title ?? ''}</h1>
            {world?.description && (
              <p className="read-novel-subtitle">
                {world.description.length > 60
                  ? world.description.slice(0, 60) + '…'
                  : world.description}
              </p>
            )}
            <div className="read-cover-meta">
              {world?.genre && <><span>{world.genre}</span><span className="read-cover-meta__div">·</span></>}
              <span>단편</span>
              <span className="read-cover-meta__div">·</span>
              <span>{wordCount.toLocaleString()}자</span>
            </div>
            <div className="read-progress-wrap">
              <div className="read-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="read-progress-label">{progress}% 읽음</div>
          </div>

          {chapters.map((ch, i) => (
            <div
              key={i}
              className="read-chapter"
              id={`ch-${i}`}
              ref={el => { chapterRefs.current[i] = el; }}
            >
              <div className="read-chapter__header">
                <div className="read-chapter__num">Chapter {String(i + 1).padStart(2, '0')}</div>
                <h2 className="read-chapter__title">{ch.title}</h2>
                <div className="read-chapter__divider" />
              </div>
              <div className="read-chapter__body" style={{ fontSize: `${fontSize}px` }}>
                {ch.paragraphs.map((para, j) => (
                  <p key={j}>{para}</p>
                ))}
              </div>
            </div>
          ))}

          <div className="read-end-card">
            <div className="read-end-symbol">— 끝 —</div>
            <p className="read-end-text">
              이 소설은 AI 작가 <strong>{AUTHOR_NAME[session?.author_id] ?? 'AI'}</strong>와 함께 작성되었습니다.
            </p>
            <div className="read-end-actions">
              <button
                className="read-end-btn read-end-btn--primary"
                onClick={() => navigate('/chat', { state: { chatId: storyId } })}
              >
                이어쓰기
              </button>
              <button
                className="read-end-btn read-end-btn--secondary"
                onClick={() => navigate('/')}
              >
                새 소설 시작
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
