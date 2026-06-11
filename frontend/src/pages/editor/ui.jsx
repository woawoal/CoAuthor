import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sendAuthorMessage, generateAuthorRewrite, getMemos, saveMemos } from '../../lib/chatApi';
import { getSession, getWorld, getCharacters } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import { authClient } from '../../lib/auth';
import { saveSentence } from '../../lib/mypageApi';
import './ui.css';

const AUTHOR_IDS = [1, 2, 3, 4];
const AUTHOR_MAP = {
  1: { characterId: 'baekya',      displayName: '백야',   image: '/assets/author1/author1.png' },
  2: { characterId: 'charoun',     displayName: '차로운', image: '/assets/author2/author2.png' },
  3: { characterId: 'hanyeoreum', displayName: '한여름', image: '/assets/author3/author3.png' },
  4: { characterId: 'kimdohyeon', displayName: '김도현', image: '/assets/author4/author4.png' },
};

const AUTHOR_TAGS = [
  { label: '#세계관',   prompt: null },
  { label: '#등장인물', prompt: null },
  { label: '#에피소드', prompt: '지금까지 이야기에서 주요 에피소드를 정리해줘.' },
  { label: '#추천',     prompt: null },
];

const AUTHOR_RECOMMEND_GREETING = {
  baekya:      '...어떤 추천이 필요한가요.',
  charoun:     '어떤 방향의 추천을 드릴까요?',
  hanyeoreum:  '어떤 거 추천해드릴까요~?',
  kimdohyeon:  '어떤 추천이 필요해요?',
};

const NARRATION_KEYWORDS = ['지문', '대사', '문장', '씬', '장면', '선택지', '다음', '행동', '추천'];

export default function Editor() {
  const location = useLocation();
  const navigate = useNavigate();

  const { worldId, chatId: chatIdFromState, authorId: authorIdRaw } = location.state ?? {};
  const chatId = chatIdFromState ?? worldId ?? null;
  const [authorId, setAuthorId] = useState(() => resolveAuthorId(authorIdRaw));
  useAuthorTheme(authorId);

  const initialAuthorIdx = AUTHOR_IDS.indexOf(Number(authorId));
  const [currentAuthorIdx, setCurrentAuthorIdx] = useState(initialAuthorIdx !== -1 ? initialAuthorIdx : 0);
  const currentAuthor = AUTHOR_MAP[AUTHOR_IDS[currentAuthorIdx]];

  // ── 에디터 상태 ───────────────────────────────────────────
  const [content, setContent] = useState('');
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved'
  const [world, setWorld] = useState(null);
  const [dbCharacters, setDbCharacters] = useState([]);

  // ── 오른쪽 패널 상태 ──────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelView, setPanelView] = useState('author');
  const [autoFeedback, setAutoFeedback] = useState(false);
  const [authorMessages, setAuthorMessages] = useState([]);
  const [userId, setUserId] = useState(null);
  const [savedMsgId, setSavedMsgId] = useState(null);
  const [authorInput, setAuthorInput] = useState('');
  const [authorLoading, setAuthorLoading] = useState(false);
  const [showWorldInfo, setShowWorldInfo] = useState(false);
  const [showCharInfo, setShowCharInfo] = useState(false);
  const [recContextMenu, setRecContextMenu] = useState({ visible: false, x: 0, y: 0, content: '' });

  // ── 메모 상태 ────────────────────────────────────────────
  const [memos, setMemos] = useState([]);
  const [memoInput, setMemoInput] = useState('');
  const memosLoadedRef = useRef(false);

  // ── Refs ─────────────────────────────────────────────────
  const authorBottomRef = useRef(null);
  const saveTimerRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const awaitingRecommendRef = useRef(false);

  // ── userId 로드 ──────────────────────────────────────────
  useEffect(() => {
    authClient.getSession().then(s => setUserId(s.data?.user?.id ?? null));
  }, []);

  // ── 세션/세계관 로드 ──────────────────────────────────────
  useEffect(() => {
    if (!chatId) return;
    getSession(chatId)
      .then(session => {
        if (session?.author_id) setAuthorId(session.author_id);
        return Promise.all([getWorld(session.world_id), getCharacters(session.world_id)]);
      })
      .then(([w, chars]) => { setWorld(w); setDbCharacters(chars); })
      .catch(console.error);
  }, [chatId]);

  // ── 기존 초안 로드 ────────────────────────────────────────
  useEffect(() => {
    if (!chatId) return;
    fetch(`/api/v1/sessions/${chatId}/novel`)
      .then(r => r.ok ? r.json() : null)
      .then(novel => { if (novel?.content) setContent(novel.content); })
      .catch(() => {});
  }, [chatId]);

  // ── 메모 로드/저장 ────────────────────────────────────────
  useEffect(() => {
    if (!chatId) return;
    getMemos(chatId).then(({ memos: loaded }) => {
      setMemos(loaded ?? []);
      memosLoadedRef.current = true;
    });
  }, [chatId]);

  useEffect(() => {
    if (!memosLoadedRef.current) return;
    saveMemos(chatId, memos);
  }, [memos]);

  // ── 마지막 사용 모드 기록 ────────────────────────────────
  useEffect(() => {
    if (chatId) localStorage.setItem(`session_mode_${chatId}`, 'editor');
  }, [chatId]);

  // ── 추천 컨텍스트 메뉴 외부 클릭 닫기 ──────────────────
  useEffect(() => {
    if (!recContextMenu.visible) return;
    const close = () => setRecContextMenu(m => ({ ...m, visible: false }));
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [recContextMenu.visible]);

  // ── 자동 저장 (2초 debounce) ─────────────────────────────
  useEffect(() => {
    if (!chatId || content === '') return;
    setSaveStatus('unsaved');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveDraft, 2000);
    return () => clearTimeout(saveTimerRef.current);
  }, [content]);

  // ── 자동 피드백 (3초 debounce) ───────────────────────────
  useEffect(() => {
    if (!autoFeedback || !content.trim() || authorLoading) return;
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(handleFeedback, 3000);
    return () => clearTimeout(feedbackTimerRef.current);
  }, [content, autoFeedback]);

  // ── 작가 채팅 자동 스크롤 ─────────────────────────────────
  useEffect(() => {
    authorBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [authorMessages, authorLoading]);

  // ── 저장 ─────────────────────────────────────────────────
  async function saveDraft() {
    if (!chatId) return;
    setSaveStatus('saving');
    try {
      await fetch(`/api/v1/sessions/${chatId}/novel/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('unsaved');
    }
  }

  async function handleSaveSentence(msgId, content) {
    if (!userId) return;
    try {
      await saveSentence({ userId, content, sessionId: chatId ?? null });
      setSavedMsgId(msgId);
      setTimeout(() => setSavedMsgId(null), 1500);
    } catch (e) { console.error(e); }
  }

  // ── 피드백 요청 ───────────────────────────────────────────
  function handleFeedback() {
    if (!content.trim() || authorLoading) return;
    const excerpt = content.length > 800 ? content.slice(-800) : content;
    setPanelView('author');
    handleSendAuthorMessage(excerpt, { mode: 'feedback' });
  }

  // ── 작가 페르소나 전환 ───────────────────────────────────
  function prevAuthor() { setCurrentAuthorIdx(prev => (prev - 1 + AUTHOR_IDS.length) % AUTHOR_IDS.length); }
  function nextAuthor() { setCurrentAuthorIdx(prev => (prev + 1) % AUTHOR_IDS.length); }

  // ── 추천 문장 자동 요청 ──────────────────────────────────
  async function fetchRecommendation(aiMsgId, authorCharacterId, userText, aiFeedback) {
    const recId = `rec_${aiMsgId}`;
    setAuthorMessages(prev => [...prev, { id: recId, role: 'ai', type: 'recommend', content: '', loading: true }]);
    try {
      const data = await generateAuthorRewrite(chatId, {
        original: userText,
        feedback: aiFeedback,
        author_id: authorCharacterId,
      });
      setAuthorMessages(prev => prev.map(m =>
        m.id === recId ? { ...m, content: data.content, loading: false } : m
      ));
    } catch {
      setAuthorMessages(prev => prev.filter(m => m.id !== recId));
    }
  }

  // ── 작가 AI 채팅 ─────────────────────────────────────────
  async function handleSendAuthorMessage(overrideText, { skipRecommend = false, mode = 'chat' } = {}) {
    const text = (overrideText ?? authorInput).trim();
    if (!text || authorLoading) return;
    if (!overrideText) setAuthorInput('');
    setAuthorMessages(prev => [...prev, { id: `au_${Date.now()}`, role: 'user', content: text }]);
    setAuthorLoading(true);

    const isNarrationReq = awaitingRecommendRef.current &&
      NARRATION_KEYWORDS.some(kw => text.includes(kw));
    awaitingRecommendRef.current = false;

    try {
      const data = await sendAuthorMessage(chatId, {
        content: text,
        author_id: currentAuthor.characterId,
        mode,
      });
      setAuthorMessages(prev => [...prev, { id: data.messageId, role: 'ai', type: 'feedback', content: data.content }]);
      if (!skipRecommend) fetchRecommendation(data.messageId, currentAuthor.characterId, text, data.content);
    } catch (err) {
      console.error('작가 AI 오류:', err);
    } finally {
      setAuthorLoading(false);
    }
  }

  function handleTagClick(tag) {
    if (authorLoading) return;
    if (tag.label === '#세계관') { setShowWorldInfo(prev => !prev); setShowCharInfo(false); return; }
    if (tag.label === '#등장인물') { setShowCharInfo(prev => !prev); setShowWorldInfo(false); return; }
    if (tag.label === '#추천') {
      setShowWorldInfo(false); setShowCharInfo(false); setPanelView('author');
      awaitingRecommendRef.current = true;
      const greeting = AUTHOR_RECOMMEND_GREETING[currentAuthor.characterId] ?? '어떤 추천을 받고 싶으신가요?';
      setAuthorMessages(prev => [...prev, { id: `au_rec_${Date.now()}`, role: 'ai', content: greeting }]);
      return;
    }
    setShowWorldInfo(false); setShowCharInfo(false);
    setPanelView('author');
    handleSendAuthorMessage(tag.prompt);
  }

  function handleSwitchToChat() {
    navigate('/chat', { state: { chatId, authorId, manuscriptContent: content } });
  }

  const saveLabel = saveStatus === 'saving' ? '저장 중...' : saveStatus === 'unsaved' ? '저장 안됨' : '저장됨';

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className="editor-layout">

      {/* 왼쪽: 원고 에디터 */}
      <div className="editor-main">
        <div className="editor-header">
          <div className="editor-header__info">
            <span className="editor-header__title">{world?.title ?? '원고'}</span>
            <span className="editor-header__genre">{world?.genre ?? ''}</span>
          </div>
          <div className="editor-header__actions">
            <span className={`editor-save-status editor-save-status--${saveStatus}`}>{saveLabel}</span>
            <button className="editor-save-btn" onClick={saveDraft} disabled={saveStatus === 'saving'}>저장</button>
            <button className="mode-switch-btn" onClick={handleSwitchToChat}>← 참여형</button>
            <button className="editor-back-btn" onClick={() => navigate('/storylist')}>목록</button>
          </div>
        </div>

        <textarea
          className="editor-textarea"
          placeholder="원고를 자유롭게 작성하세요..."
          value={content}
          onChange={e => setContent(e.target.value)}
          spellCheck={false}
        />

        <div className="editor-footer">
          <span className="editor-wordcount">{content.length.toLocaleString()}자</span>
        </div>
      </div>

      {/* 오른쪽: 작가 패널 */}
      <div className="author-panel-wrapper">
        <button
          className="panel-toggle-btn"
          onClick={() => setPanelOpen(prev => !prev)}
          aria-label={panelOpen ? '패널 닫기' : '패널 열기'}
        >
          {panelOpen ? '>' : '<'}
        </button>

        <div className={`author-panel-slide${panelOpen ? ' author-panel-slide--open' : ''}`}>
          <div className="author-panel">

            {panelView === 'author' ? (
              <>
                {/* 작가 이미지 + 스위처 오버레이 */}
                <div className="author-panel__image">
                  <img src={currentAuthor.image} alt={currentAuthor.displayName} />
                  <div className="author-switcher author-panel__switcher-overlay">
                    <button className="author-switch-btn" onClick={prevAuthor}>‹</button>
                    <span className="author-name-badge">{currentAuthor.displayName}</span>
                    <button className="author-switch-btn" onClick={nextAuthor}>›</button>
                  </div>
                </div>

                {/* 태그 바 + 메모 + 자동피드백 토글 */}
                <div className="author-tag-bar">
                  {AUTHOR_TAGS.map(tag => (
                    <button
                      key={tag.label}
                      className={`author-tag${(tag.label === '#세계관' && showWorldInfo) || (tag.label === '#등장인물' && showCharInfo) ? ' author-tag--active' : ''}`}
                      onClick={() => handleTagClick(tag)}
                      disabled={authorLoading}
                    >{tag.label}</button>
                  ))}
                  <button
                    className={`memo-view-btn author-tag-bar__memo${panelView === 'memo' ? ' memo-view-btn--active' : ''}`}
                    onClick={() => setPanelView('memo')}
                  >
                    🗒️ 메모
                    {memos.length > 0 && <span className="memo-count">{memos.length}</span>}
                  </button>
                </div>

                {/* 자동 피드백 토글 */}
                <div className="auto-feedback-bar">
                  <span className="auto-feedback-bar__label">자동 피드백</span>
                  <button
                    className={`auto-feedback-toggle${autoFeedback ? ' auto-feedback-toggle--on' : ''}`}
                    onClick={() => setAutoFeedback(prev => !prev)}
                  >
                    {autoFeedback ? 'ON' : 'OFF'}
                  </button>
                  {!autoFeedback && (
                    <button
                      className="feedback-btn"
                      onClick={handleFeedback}
                      disabled={authorLoading || !content.trim()}
                    >피드백 받기</button>
                  )}
                </div>

                {/* 세계관 카드 */}
                {showWorldInfo && world && (
                  <div className="world-info-card">
                    {world.title && <div className="world-info-card__row"><span className="world-info-card__label">제목</span>{world.title}</div>}
                    {world.genre && <div className="world-info-card__row"><span className="world-info-card__label">장르</span>{world.genre}</div>}
                    {world.description && <div className="world-info-card__row"><span className="world-info-card__label">배경</span>{world.description}</div>}
                    {world.setting && <div className="world-info-card__row"><span className="world-info-card__label">공간</span>{world.setting}</div>}
                    {world.rules && <div className="world-info-card__row"><span className="world-info-card__label">규칙</span>{world.rules}</div>}
                  </div>
                )}

                {/* 등장인물 카드 */}
                {showCharInfo && dbCharacters.length > 0 && (
                  <div className="world-info-card">
                    {dbCharacters.map(c => (
                      <div key={c.id ?? c.name} className="world-info-card__char-row">
                        <span className="world-info-card__char-name">{c.name}</span>
                        <span className="world-info-card__char-role">{c.role === 'protagonist' ? '주인공' : '조연'}</span>
                        {c.personality && <span className="world-info-card__char-desc">{c.personality}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* 작가 AI 채팅 */}
                <div className="author-chat">
                  <div className="author-chat__messages">
                    {authorMessages.length === 0 && !authorLoading && (
                      <p className="author-chat__empty">
                        {currentAuthor.displayName}에게<br />원고 피드백을 받아보세요
                      </p>
                    )}
                    {authorMessages.map(msg => {
                      if (msg.role === 'user') return (
                        <div key={msg.id} className="author-msg author-msg--user">{msg.content}</div>
                      );
                      if (msg.type === 'recommend') return (
                        <div key={msg.id} className="author-msg-group">
                          <span className="author-msg__name author-msg__name--rec">💡 제 추천은 이래요</span>
                          {msg.loading ? (
                            <div className="author-msg author-msg--recommend">
                              <div className="typing-dots"><span /><span /><span /></div>
                            </div>
                          ) : (
                            <div
                              className="author-msg author-msg--recommend"
                              onContextMenu={e => {
                                e.preventDefault();
                                setRecContextMenu({ visible: true, x: e.clientX, y: e.clientY, content: msg.content });
                              }}
                              title="우클릭 → 적용하기"
                            >
                              {msg.content}
                            </div>
                          )}
                        </div>
                      );
                      return (
                        <div key={msg.id} className="author-msg-group">
                          <div className="author-msg-group__top">
                            <span className="author-msg__name">작가 {currentAuthor.displayName}</span>
                            <button
                              className={`save-sentence-btn${savedMsgId === msg.id ? ' save-sentence-btn--saved' : ''}`}
                              onClick={() => handleSaveSentence(msg.id, msg.content)}
                              title="문장 보관함에 저장"
                            >
                              {savedMsgId === msg.id ? '✓' : '💾'}
                            </button>
                          </div>
                          <div className="author-msg author-msg--ai">{msg.content}</div>
                        </div>
                      );
                    })}
                    {authorLoading && (
                      <div className="author-msg-group">
                        <span className="author-msg__name">작가 {currentAuthor.displayName}</span>
                        <div className="author-msg author-msg--ai">
                          <div className="typing-dots"><span /><span /><span /></div>
                        </div>
                      </div>
                    )}
                    <div ref={authorBottomRef} />
                  </div>
                  <div className="author-chat__input-bar">
                    <textarea
                      className="author-chat__input"
                      placeholder={`${currentAuthor.displayName}에게 물어보기...`}
                      value={authorInput}
                      rows={2}
                      disabled={authorLoading}
                      onChange={e => setAuthorInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendAuthorMessage(); }
                      }}
                    />
                    <button className="author-chat__send" onClick={() => handleSendAuthorMessage()} disabled={authorLoading}>→</button>
                  </div>
                </div>
              </>
            ) : (
              /* 메모 뷰 */
              <div className="memo-view">
                <div className="memo-view__header">
                  <span>🗒️ 메모</span>
                  <button className="memo-view__back" onClick={() => setPanelView('author')}>← 돌아가기</button>
                </div>
                <div className="memo-view__list">
                  {memos.length === 0 && (
                    <p className="author-chat__empty">메모가 없습니다</p>
                  )}
                  {memos.map(memo => (
                    <div key={memo.id} className="memo-item memo-item--manual">
                      <div className="memo-item__body">
                        <span>{memo.text}</span>
                        <button
                          className="memo-item__delete"
                          onClick={() => setMemos(prev => prev.filter(m => m.id !== memo.id))}
                        >×</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="memo-add">
                  <textarea
                    className="memo-input"
                    placeholder="메모 추가..."
                    value={memoInput}
                    rows={2}
                    onChange={e => setMemoInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (!memoInput.trim()) return;
                        setMemos(prev => [...prev, { id: Date.now(), type: 'manual', text: memoInput }]);
                        setMemoInput('');
                      }
                    }}
                  />
                  <button className="memo-add-btn" onClick={() => {
                    if (!memoInput.trim()) return;
                    setMemos(prev => [...prev, { id: Date.now(), type: 'manual', text: memoInput }]);
                    setMemoInput('');
                  }}>+</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {recContextMenu.visible && (
        <div
          className="rec-context-menu"
          style={{ top: recContextMenu.y, left: recContextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button className="rec-context-menu__item" onClick={() => {
            setContent(prev => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + recContextMenu.content);
            setRecContextMenu(m => ({ ...m, visible: false }));
          }}>
            적용하기
          </button>
        </div>
      )}
    </div>
  );
}
