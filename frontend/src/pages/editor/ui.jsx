import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sendAuthorMessage, generateAuthorRewrite, getMemos, saveMemos, getTasteRecommend, proofread } from '../../lib/chatApi';
import { getSession, getWorld, getCharacters } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import { authClient } from '../../lib/auth';
import { saveSentence } from '../../lib/mypageApi';
import { getTaste, analyzeTaste } from '../../lib/tasteApi';
import './ui.css';

const AUTHOR_IDS = [1, 2, 3, 4];
const AUTHOR_MAP = {
  1: { characterId: 'baekya', displayName: '백야', image: '/assets/author1/author1.png' },
  2: { characterId: 'charoun', displayName: '차로운', image: '/assets/author2/author2.png' },
  3: { characterId: 'hanyeoreum', displayName: '한여름', image: '/assets/author3/author3.png' },
  4: { characterId: 'kimdohyeon', displayName: '김도현', image: '/assets/author4/author4.png' },
};

const AUTHOR_TAGS = [
  { label: '#세계관', prompt: null },
  { label: '#등장인물', prompt: null },
  { label: '#에피소드', prompt: '지금까지 이야기에서 주요 에피소드를 정리해줘.' },
  { label: '#추천', prompt: null },
  { label: '#취향저격ai', prompt: null },
];

const TASTE_LABELS = {
  fantasy: '판타지', growth: '성장', romance: '로맨스', action: '액션',
  sf: 'SF', mystery: '미스터리', horror: '호러', politics: '정치', slice_of_life: '일상',
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
  const [panelWidth, setPanelWidth] = useState(760);    // 작가 패널 기본 너비 = 드래그 최대값(px)
  const [isResizing, setIsResizing] = useState(false);
  const [panelView, setPanelView] = useState('author');
  const [autoFeedback, setAutoFeedback] = useState(false);
  const [authorMessages, setAuthorMessages] = useState([]);
  const [userId, setUserId] = useState(null);
  const [savedMsgId, setSavedMsgId] = useState(null);
  const [authorInput, setAuthorInput] = useState('');
  const [authorLoading, setAuthorLoading] = useState(false);
  const [showWorldInfo, setShowWorldInfo] = useState(false);
  const [showCharInfo, setShowCharInfo] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [recContextMenu, setRecContextMenu] = useState({ visible: false, x: 0, y: 0, content: '' });

  // ── 취향 패널 상태 ────────────────────────────────────────
  const [showTastePanel, setShowTastePanel] = useState(false);
  const [tasteWorks, setTasteWorks] = useState([]);
  const [tasteInput, setTasteInput] = useState('');
  const [tasteProfile, setTasteProfile] = useState(null);
  const [tasteAnalyzing, setTasteAnalyzing] = useState(false);
  const [tasteRecommending, setTasteRecommending] = useState(false);

  // ── 메모 상태 ────────────────────────────────────────────
  const [memos, setMemos] = useState([]);
  const [memoInput, setMemoInput] = useState('');
  const [corrections, setCorrections] = useState([]);   // 누적 교정 체크리스트 [{key,original,corrected,type,frequent,count,applied}]
  const [proofMemo, setProofMemo] = useState('');       // 최신 작가 톤 멘트
  const memosLoadedRef = useRef(false);
  const proofTimerRef = useRef(null);

  // ── Refs ─────────────────────────────────────────────────
  const authorBottomRef = useRef(null);
  const saveTimerRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const awaitingRecommendRef = useRef(false);
  const textareaRef = useRef(null);

  const [hasSelection, setHasSelection] = useState(false);

  // ── userId 로드 + 기존 취향 복원 ────────────────────────
  useEffect(() => {
    authClient.getSession().then(s => {
      const uid = s.data?.user?.id ?? null;
      setUserId(uid);
      if (uid && chatId) {
        getTaste(chatId, uid).then(data => {
          if (data.works?.length) setTasteWorks(data.works);
          if (data.taste_profile && Object.keys(data.taste_profile).length) setTasteProfile(data.taste_profile);
        }).catch(() => { });
      }
    });
  }, []);

  useEffect(() => {
    setVideoError(false);
  }, [currentAuthorIdx]);

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
      .catch(() => { });
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

  // ── 작가 패널 너비 드래그 리사이즈 (채팅과 동일) ───────────
  useEffect(() => {
    if (!isResizing) return;
    function onMove(e) {
      // 패널은 화면 오른쪽에 도킹 → 너비 = 화면폭 - 마우스X (320~760px 제한)
      setPanelWidth(Math.min(760, Math.max(320, window.innerWidth - e.clientX)));
    }
    function onUp() { setIsResizing(false); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

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
    const paragraphs = content.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const lastParagraph = paragraphs[paragraphs.length - 1] ?? content.trim();
    feedbackTimerRef.current = setTimeout(() => handleFeedback(lastParagraph), 3000);
    return () => clearTimeout(feedbackTimerRef.current);
  }, [content, autoFeedback]);

  // ── 맞춤법 교정 (2.5초 debounce, 마지막 문단을 F-QC-02로 검사) ──
  useEffect(() => {
    if (!chatId || !content.trim()) { setCorrections([]); return; }
    clearTimeout(proofTimerRef.current);
    const paras = content.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const last = paras[paras.length - 1] ?? content.trim();
    proofTimerRef.current = setTimeout(() => {
      proofread(chatId, last, currentAuthor.characterId)
        .then(r => {
          if (!r.errors?.length) return;
          setProofMemo(r.memo || '');
          // 누적: 새 오류만 추가(중복 제외), 적용완료 항목은 유지 → 체크리스트
          setCorrections(prev => {
            const have = new Set(prev.map(x => x.key));
            const added = r.errors
              .filter(e => !have.has(`${e.original}→${e.corrected}`))
              .map(e => ({
                key: `${e.original}→${e.corrected}`,
                original: e.original, corrected: e.corrected,
                type: e.type, frequent: e.frequent, count: e.count, applied: false,
              }));
            return [...prev, ...added];
          });
          setPanelView('proof');   // 교정 있으면 교정 뷰로 자동 전환
        })
        .catch(() => { });
    }, 2500);
    return () => clearTimeout(proofTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

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
  function handleFeedback(forcedExcerpt = null) {
    if (!content.trim() || authorLoading) return;
    let excerpt = forcedExcerpt;
    if (!excerpt && textareaRef.current) {
      const { selectionStart, selectionEnd } = textareaRef.current;
      if (selectionStart !== selectionEnd) {
        excerpt = content.slice(selectionStart, selectionEnd);
      }
    }
    if (!excerpt) {
      excerpt = content.length > 800 ? content.slice(-800) : content;
    }
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

  async function runTasteAnalysis(works) {
    if (!userId || !chatId) return;
    setTasteAnalyzing(true);
    try {
      const data = await analyzeTaste(chatId, { user_id: userId, works });
      setTasteProfile(data.taste_profile);
    } catch (e) {
      console.error('취향 분석 실패', e);
    } finally {
      setTasteAnalyzing(false);
    }
  }

  async function handleTasteRecommend() {
    if (!userId || !chatId || tasteRecommending) return;
    setTasteRecommending(true);
    const loadingId = `tr_${Date.now()}`;
    setAuthorMessages(prev => [...prev, {
      id: loadingId,
      role: 'ai',
      type: 'taste-recommend',
      loading: true,
      narration: '',
      dialogue: '',
      reason: '',
    }]);
    try {
      const data = await getTasteRecommend(chatId, userId);
      setAuthorMessages(prev => prev.map(m =>
        m.id === loadingId ? { ...m, loading: false, ...data } : m
      ));
    } catch (e) {
      console.error('취향저격 오류', e);
      setAuthorMessages(prev => prev.filter(m => m.id !== loadingId));
    } finally {
      setTasteRecommending(false);
    }
  }

  async function handleTasteInputKeyDown(e) {
    if (e.key !== 'Enter' || !tasteInput.trim()) return;
    e.preventDefault();
    const newWorks = [...tasteWorks, tasteInput.trim()];
    setTasteWorks(newWorks);
    setTasteInput('');
    await runTasteAnalysis(newWorks);
  }

  async function handleRemoveTasteWork(idx) {
    const newWorks = tasteWorks.filter((_, i) => i !== idx);
    setTasteWorks(newWorks);
    if (newWorks.length > 0) {
      await runTasteAnalysis(newWorks);
    } else {
      setTasteProfile(null);
      if (userId && chatId) analyzeTaste(chatId, { user_id: userId, works: [] }).catch(() => { });
    }
  }

  function handleTagClick(tag) {
    if (authorLoading) return;
    if (tag.label === '#세계관') { setShowWorldInfo(prev => !prev); setShowCharInfo(false); return; }
    if (tag.label === '#등장인물') { setShowCharInfo(prev => !prev); setShowWorldInfo(false); return; }
    if (tag.label === '#추천') return;
    if (tag.label === '#취향저격ai') {
      setShowWorldInfo(false); setShowCharInfo(false); setPanelView('author');
      handleTasteRecommend();
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
          ref={textareaRef}
          className="editor-textarea"
          placeholder="원고를 자유롭게 작성하세요..."
          value={content}
          onChange={e => setContent(e.target.value)}
          onSelect={e => setHasSelection(e.target.selectionStart !== e.target.selectionEnd)}
          onMouseUp={e => setHasSelection(e.target.selectionStart !== e.target.selectionEnd)}
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

        {panelOpen && (
          <div
            className={`author-panel-resizer${isResizing ? ' author-panel-resizer--active' : ''}`}
            onMouseDown={e => { e.preventDefault(); setIsResizing(true); }}
            title="드래그하여 패널 너비 조절"
          />
        )}

        <div
          className="author-panel-slide"
          style={{ width: panelOpen ? panelWidth : 0, transition: isResizing ? 'none' : 'width 0.3s ease' }}
        >
          <div className="author-panel" style={{ width: panelWidth }}>

            {panelView === 'author' ? (
              <>
                {/* 작가 이미지 + 스위처 오버레이 */}
                <div className="author-panel__image">
                  {!videoError ? (
                    <video
                      key={AUTHOR_IDS[currentAuthorIdx]}
                      src={`/assets/author${AUTHOR_IDS[currentAuthorIdx]}/default.mp4`}
                      autoPlay
                      loop
                      muted
                      playsInline
                      onError={() => setVideoError(true)}
                    />
                  ) : (
                    <img
                      src={currentAuthor.image}
                      alt={currentAuthor.displayName}
                    />
                  )}
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
                      className={`author-tag${(tag.label === '#세계관' && showWorldInfo) || (tag.label === '#등장인물' && showCharInfo)
                          ? ' author-tag--active' : ''
                        }${tag.label === '#취향저격ai' ? ' author-tag--accent' : ''}${tag.label === '#추천' ? ' author-tag--disabled' : ''
                        }`}
                      onClick={() => handleTagClick(tag)}
                      disabled={authorLoading || tag.label === '#추천' || (tag.label === '#취향저격ai' && tasteRecommending)}
                    >{tag.label === '#취향저격ai' && tasteRecommending ? '추천 중...' : tag.label}</button>
                  ))}
                  <button
                    className={`memo-view-btn author-tag-bar__memo${panelView === 'memo' ? ' memo-view-btn--active' : ''}`}
                    onClick={() => setPanelView('memo')}
                  >
                    🗒️ 메모
                    {memos.length > 0 && <span className="memo-count">{memos.length}</span>}
                  </button>
                  <button
                    className={`memo-view-btn author-tag-bar__memo${panelView === 'proof' ? ' memo-view-btn--active' : ''}`}
                    onClick={() => setPanelView('proof')}
                  >
                    ✏️ 교정
                    {corrections.filter(e => !e.applied).length > 0 &&
                      <span className="memo-count memo-count--proof">{corrections.filter(e => !e.applied).length}</span>}
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
                      className={`feedback-btn${hasSelection ? ' feedback-btn--selection' : ''}`}
                      onClick={handleFeedback}
                      disabled={authorLoading || !content.trim()}
                      title={hasSelection ? '선택한 구간만 피드백' : '전체 원고 피드백'}
                    >{hasSelection ? '선택 구간 피드백' : '피드백 받기'}</button>
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
                      if (msg.type === 'taste-recommend') return (
                        <div key={msg.id} className="author-msg-group">
                          <span className="author-msg__name author-msg__name--rec">✨ 취향저격 추천</span>
                          {msg.loading ? (
                            <div className="author-msg author-msg--taste-rec">
                              <div className="typing-dots"><span /><span /><span /></div>
                            </div>
                          ) : (
                            <div className="author-msg author-msg--taste-rec">
                              {msg.narration && (
                                <p className="taste-rec__narration">{msg.narration}</p>
                              )}
                              {msg.dialogue && (
                                <p className="taste-rec__dialogue">"{msg.dialogue}"</p>
                              )}
                              {msg.reason && (
                                <p className="taste-rec__reason">💡 {msg.reason}</p>
                              )}
                              <button
                                className="taste-rec__use-btn"
                                onClick={() => {
                                  const parts = [
                                    msg.narration,
                                    msg.dialogue ? `"${msg.dialogue}"` : '',
                                  ].filter(Boolean);
                                  const text = parts.join('\n');
                                  setContent(prev => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + text);
                                }}
                              >이 문장 사용하기 →</button>
                            </div>
                          )}
                        </div>
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
                  {showTastePanel && (
                    <div className="taste-panel">
                      <div className="taste-panel__header">
                        <span className="taste-panel__title">좋아하는 작품을 입력해주세요 ({tasteWorks.length}/5)</span>
                        <button className="taste-panel__close" onClick={() => setShowTastePanel(false)}>×</button>
                      </div>
                      <div className="taste-panel__chips">
                        {tasteWorks.map((w, i) => (
                          <span key={i} className="taste-chip">
                            {w}
                            <button className="taste-chip__remove" onClick={() => handleRemoveTasteWork(i)}>×</button>
                          </span>
                        ))}
                      </div>
                      {tasteWorks.length < 5 && (
                        <input
                          className="taste-panel__input"
                          placeholder="작품명 입력 후 엔터..."
                          value={tasteInput}
                          onChange={e => setTasteInput(e.target.value)}
                          onKeyDown={handleTasteInputKeyDown}
                          autoFocus
                        />
                      )}
                      {tasteAnalyzing && <div className="taste-panel__analyzing">분석 중...</div>}
                      {tasteProfile && Object.keys(tasteProfile).length > 0 && (
                        <div className="taste-panel__result">
                          {Object.entries(tasteProfile)
                            .sort(([, a], [, b]) => b - a)
                            .slice(0, 5)
                            .map(([key, val]) => (
                              <div key={key} className="taste-bar">
                                <span className="taste-bar__label">{TASTE_LABELS[key] ?? key}</span>
                                <div className="taste-bar__track">
                                  <div className="taste-bar__fill" style={{ width: `${Math.round(val * 100)}%` }} />
                                </div>
                                <span className="taste-bar__val">{Math.round(val * 100)}%</span>
                              </div>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  )}
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
            ) : panelView === 'proof' ? (
              /* ✏️ 교정 뷰 (메모와 분리된 독립 탭) */
              <div className="memo-view">
                <div className="memo-view__header">
                  <span>✏️ 작가의 교정</span>
                  <div className="memo-proof__head-actions">
                    {corrections.length > 0 && (
                      <button className="memo-view__back" onClick={() => { setCorrections([]); setProofMemo(''); }}>비우기</button>
                    )}
                    <button className="memo-view__back" onClick={() => setPanelView('author')}>← 돌아가기</button>
                  </div>
                </div>
                {proofMemo && <p className="memo-proof__memo">"{proofMemo}"</p>}
                <div className="memo-view__list">
                  {corrections.length === 0 && (
                    <p className="author-chat__empty">맞춤법 오류가 없습니다 ✨<br />글을 쓰면 작가가 봐줍니다</p>
                  )}
                  {corrections.map(e => (
                    <div key={e.key} className={`memo-proof__card${e.applied ? ' memo-proof__card--applied' : ''}`}>
                      <div className={`memo-proof__err${e.frequent ? ' memo-proof__err--frequent' : ''}`}>
                        <span className="memo-proof__wrong">{e.original}</span>
                        <span className="memo-proof__arrow">→</span>
                        <span className="memo-proof__right">{e.corrected}</span>
                        <span className="memo-proof__type">{e.type}</span>
                        {e.frequent && <span className="memo-proof__freq">자주 틀림 {e.count}회</span>}
                      </div>
                      <div className="memo-proof__actions">
                        {e.applied ? (
                          <span className="memo-proof__done">✓ 적용완료</span>
                        ) : (
                          <button
                            className="memo-proof__apply"
                            onClick={() => {
                              setContent(prev => prev.split(e.original).join(e.corrected));
                              setCorrections(prev => prev.map(x => x.key === e.key ? { ...x, applied: true } : x));
                            }}
                          >적용</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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
