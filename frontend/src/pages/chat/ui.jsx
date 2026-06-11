import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  sendMessage, connectChatStream, completeSession, generateNovel, convertToNovel,
  getSuggestions, sendAuthorMessage, getMemos, saveMemos, getAuthorReaction,
} from '../../lib/chatApi';
import { getSession, getWorld, getCharacters, getDialogues } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import { authClient } from '../../lib/auth';
import { saveSentence } from '../../lib/mypageApi';
import './ui.css';

const AUTHOR_IDS = [1, 2, 3, 4];

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

const AUTHOR_MAP = {
  1: { characterId: 'baekya',      displayName: '백야',   image: '/assets/author1/author1.png' },
  2: { characterId: 'charoun',     displayName: '차로운', image: '/assets/author2/author2.png' },
  3: { characterId: 'hanyeoreum', displayName: '한여름', image: '/assets/author3/author3.png' },
  4: { characterId: 'kimdohyeon', displayName: '김도현', image: '/assets/author4/author4.png' },
};

function buildWorldContext(world, characters) {
  if (!world) return '';
  const lines = [];
  if (world.title)       lines.push(`제목: ${world.title}`);
  if (world.genre)       lines.push(`장르: ${world.genre}`);
  if (world.description) lines.push(`배경: ${world.description}`);
  if (world.setting)     lines.push(`공간: ${world.setting}`);
  if (world.rules)       lines.push(`규칙: ${world.rules}`);
  if (characters.length > 0) {
    lines.push('등장인물:');
    characters.forEach(c => {
      const roleKo = c.role === 'protagonist' ? '주인공' : '조연';
      lines.push(`- ${c.name} (${roleKo})${c.personality ? ': ' + c.personality : ''}`);
    });
  }
  return lines.join('\n');
}

function formatText(text) {
  return text
    .replace(/\n?\[STATE:[^\]]*\]/g, '')
    .replace(/"([^"]*)"/g, '\n\n"$1"\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function Bubble({ msg, persona, characterName, streaming, hasBookmark, isSelected, onContextMenu }) {
  if (msg.role === 'system') {
    return <div className="world-info-header">{msg.text}</div>;
  }

  const isUser = msg.role === 'user';

  if (!isUser) {
    const hasNarration = !!(msg.narration || msg.text);
    const hasDialogue = !!msg.dialogue;
    const isLoading = !hasNarration && !hasDialogue && streaming;
    const charName = characterName || msg.name;

    return (
      <div
        id={`bubble-${msg.id}`}
        className={`bubble-row bubble-row--char${isSelected ? ' bubble-row--selected' : ''}`}
        onContextMenu={onContextMenu}
      >
        <div className="bubble-content">
          {hasNarration && (
            <p className="narration-text">
              {hasBookmark && !hasDialogue && <span className="bubble-bookmark">🔖</span>}
              {formatText(msg.narration || msg.text)}
            </p>
          )}
          {isLoading && <div className="typing-dots"><span /><span /><span /></div>}
          {hasDialogue && (
            <div className="dialogue-block">
              <span className="badge">{charName}</span>
              <div className="bubble bubble--char">
                {hasBookmark && <span className="bubble-bookmark">🔖</span>}
                &ldquo;{msg.dialogue}&rdquo;
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      id={`bubble-${msg.id}`}
      className={`bubble-row bubble-row--user${isSelected ? ' bubble-row--selected' : ''}`}
      onContextMenu={onContextMenu}
    >
      <div className="bubble-content bubble-content--user">
        <span className="badge badge--user">{msg.name}</span>
        <div className="bubble bubble--user bubble--markdown">
          {hasBookmark && <span className="bubble-bookmark">🔖</span>}
          <ReactMarkdown>{msg.text}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  const location = useLocation();
  const navigate = useNavigate();
  const { worldId, chatId: chatIdFromState, authorId: authorIdRaw, opening, manuscriptContent } = location.state ?? {};
  const chatId = chatIdFromState ?? worldId ?? 'room_001';
  const [authorId, setAuthorId] = useState(() => resolveAuthorId(authorIdRaw));
  useAuthorTheme(authorId);

  // manuscriptContent: state로 오면 localStorage에 저장, 없으면 localStorage에서 복원
  useEffect(() => {
    if (!chatId || chatId === 'room_001') return;
    if (manuscriptContent) {
      localStorage.setItem(`manuscript_${chatId}`, manuscriptContent);
    }
  }, [chatId, manuscriptContent]);

  // 스토리 채팅 작가 (고정)
  const storyAuthor = AUTHOR_MAP[authorId] ?? AUTHOR_MAP[1];

  // 오른쪽 패널 작가 (슬라이드로 전환 가능)
  const initialAuthorIdx = AUTHOR_IDS.indexOf(Number(authorId));
  const [currentAuthorIdx, setCurrentAuthorIdx] = useState(
    initialAuthorIdx !== -1 ? initialAuthorIdx : 0
  );
  const currentAuthor = AUTHOR_MAP[AUTHOR_IDS[currentAuthorIdx]];

  // ── 스토리 채팅 상태 ───────────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(opening || '');
  const [streaming, setStreaming] = useState(false);
  const [reaction, setReaction] = useState('');     // F-AS-05 작가 리액션 자막
  const reactionTimerRef = useRef(null);
  const [world, setWorld] = useState(null);
  const [dbCharacters, setDbCharacters] = useState([]);
  const [ending, setEnding] = useState(false);
  const [converting, setConverting] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [importedNarration] = useState(() => {
    if (manuscriptContent) return manuscriptContent;
    if (chatId && chatId !== 'room_001') return localStorage.getItem(`manuscript_${chatId}`) ?? null;
    return null;
  });

  // ── 오른쪽 패널 상태 ──────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelView, setPanelView] = useState('author'); // 'author' | 'memo'
  const [authorMessages, setAuthorMessages] = useState([]);
  const [authorInput, setAuthorInput] = useState('');
  const [authorLoading, setAuthorLoading] = useState(false);

  // ── 메모 상태 ────────────────────────────────────────────
  const [memos, setMemos] = useState([]);
  const [selectedMsgId, setSelectedMsgId] = useState(null);
  const [memoInput, setMemoInput] = useState('');
  const [editingMemoId, setEditingMemoId] = useState(null);
  const memosLoadedRef = useRef(false);

  // ── 컨텍스트 메뉴 ─────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, msgId: null });

  // ── 자동 피드백 상태 ─────────────────────────────────────
  const [autoFeedback, setAutoFeedback] = useState(false);

  // ── 문장 저장 상태 ───────────────────────────────────────
  const [userId, setUserId] = useState(null);
  const [savedMsgId, setSavedMsgId] = useState(null);

  // ── Refs ─────────────────────────────────────────────────
  const bottomRef = useRef(null);
  const esRef = useRef(null);
  const authorBottomRef = useRef(null);
  const memoInputRef = useRef(null);
  const awaitingRecommendRef = useRef(false);
  const feedbackTimerRef = useRef(null);

  // ── userId 로드 ──────────────────────────────────────────
  useEffect(() => {
    authClient.getSession().then(s => setUserId(s.data?.user?.id ?? null));
  }, []);

  // ── 마지막 사용 모드 기록 ────────────────────────────────
  useEffect(() => {
    if (chatId && chatId !== 'room_001') localStorage.setItem(`session_mode_${chatId}`, 'chat');
  }, [chatId]);

  // ── 메모 Redis 로드 ───────────────────────────────────────
  useEffect(() => {
    if (!chatId || chatId === 'room_001') return;
    getMemos(chatId).then(({ memos: loaded }) => {
      setMemos(loaded ?? []);
      memosLoadedRef.current = true;
    });
  }, [chatId]);

  // ── 메모 Redis 저장 ───────────────────────────────────────
  useEffect(() => {
    if (!memosLoadedRef.current) return;
    saveMemos(chatId, memos);
  }, [memos]);

  // ── 세션/세계관 로드 ──────────────────────────────────────
  useEffect(() => {
    if (!chatId || chatId === 'room_001') return;
    getSession(chatId)
      .then(session => {
        if (session?.author_id) setAuthorId(session.author_id);  // 진짜 작가 id로 테마 확정
        return Promise.all([
          getWorld(session.world_id),
          getCharacters(session.world_id),
          getDialogues(chatId),
        ]);
      })
      .then(([w, chars, dialogues]) => {
        setWorld(w);
        setDbCharacters(chars);
        const protagonistName = chars.find(c => c.role === 'protagonist')?.name ?? '나';

        if (dialogues.length > 0) {
          const restored = dialogues.map(d => ({
            id: d.id,
            role: d.speaker_type === 'user' ? 'user' : 'character',
            name: d.speaker_type === 'user' ? protagonistName : storyAuthor.displayName,
            text: d.content,
          }));
          setMessages(restored);
        }
      })
      .catch(console.error);
  }, [chatId]);

  // ── 자동 스크롤 ──────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    authorBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [authorMessages, authorLoading]);

  // ── 자동 피드백 (스트리밍 종료 시 트리거) ────────────────
  useEffect(() => {
    if (streaming || !autoFeedback) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'character') return;
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(handleFeedback, 2000);
    return () => clearTimeout(feedbackTimerRef.current);
  }, [streaming, autoFeedback]);

  // ── 컨텍스트 메뉴 외부 클릭 닫기 ─────────────────────────
  useEffect(() => {
    function close() { setContextMenu(prev => ({ ...prev, visible: false })); }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // ── 세계관/등장인물 카드 토글 ────────────────────────────
  const [showWorldInfo, setShowWorldInfo] = useState(false);
  const [showCharInfo, setShowCharInfo] = useState(false);

  // ── 작가 페르소나 전환 ───────────────────────────────────
  function prevAuthor() {
    setCurrentAuthorIdx(prev => (prev - 1 + AUTHOR_IDS.length) % AUTHOR_IDS.length);
  }
  function nextAuthor() {
    setCurrentAuthorIdx(prev => (prev + 1) % AUTHOR_IDS.length);
  }

  // ── 컨텍스트 메뉴 ─────────────────────────────────────────
  function handleBubbleContextMenu(e, msgId) {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, msgId });
  }

  function handleMemoFromContext(msgId) {
    setContextMenu(prev => ({ ...prev, visible: false }));
    const existing = memos.find(m => m.msgId === msgId);
    setEditingMemoId(existing ? existing.id : null);
    setMemoInput(existing ? existing.text : '');
    setSelectedMsgId(msgId);
    setPanelOpen(true);
    setPanelView('memo');
    setTimeout(() => memoInputRef.current?.focus(), 80);
  }

  function handleDeleteMsg(msgId) {
    setContextMenu(prev => ({ ...prev, visible: false }));
    setMessages(prev => prev.filter(m => m.id !== msgId));
  }

  // ── 메모 조작 ─────────────────────────────────────────────
  function clearBookmarkState() {
    setSelectedMsgId(null);
    setEditingMemoId(null);
    setMemoInput('');
  }

  function handleAddMemo() {
    if (!memoInput.trim()) return;
    if (editingMemoId) {
      setMemos(prev => prev.map(m => m.id === editingMemoId ? { ...m, text: memoInput } : m));
    } else {
      setMemos(prev => [...prev, {
        id: Date.now(),
        type: 'manual',
        text: memoInput,
        msgId: selectedMsgId || null,
      }]);
    }
    clearBookmarkState();
  }

  function handleMemoClick(memo) {
    if (!memo.msgId) return;
    document.getElementById(`bubble-${memo.msgId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setSelectedMsgId(memo.msgId);
  }

  // ── 작가 AI 채팅 ─────────────────────────────────────────
  async function handleSendAuthorMessage(overrideText) {
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
      });
      setAuthorMessages(prev => [...prev, { id: data.messageId, role: 'ai', content: data.content }]);
      if (isNarrationReq) fetchSuggestions();
    } catch (err) {
      console.error('작가 AI 오류:', err);
    } finally {
      setAuthorLoading(false);
    }
  }

  function handleTagClick(tag) {
    if (authorLoading) return;
    if (tag.label === '#세계관') {
      setShowWorldInfo(prev => !prev);
      setShowCharInfo(false);
      return;
    }
    if (tag.label === '#등장인물') {
      setShowCharInfo(prev => !prev);
      setShowWorldInfo(false);
      return;
    }
    if (tag.label === '#추천') {
      setShowWorldInfo(false);
      setShowCharInfo(false);
      setPanelView('author');
      awaitingRecommendRef.current = true;
      const greeting = AUTHOR_RECOMMEND_GREETING[currentAuthor.characterId] ?? '어떤 추천을 받고 싶으신가요?';
      setAuthorMessages(prev => [...prev, { id: `au_rec_${Date.now()}`, role: 'ai', content: greeting }]);
      return;
    }
    setShowWorldInfo(false);
    setShowCharInfo(false);
    setPanelView('author');
    handleSendAuthorMessage(tag.prompt);
  }

  // ── 스토리 채팅 ──────────────────────────────────────────
  // F-AS-05: 사용자 대사 → 작가 리액션 자막(아바타 위)을 잠깐 표시
  function showReaction(text) {
    setReaction(text);
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = setTimeout(() => setReaction(''), 4500);
  }

  async function handleSend() {
    if (!input.trim() || streaming) return;
    const userText = input.trim();
    setInput('');

    const protagonistName = dbCharacters.find(c => c.role === 'protagonist')?.name ?? '나';
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', name: protagonistName, text: userText }]);

    // 작가 리액션 자막 — 메인 응답과 독립(느려도/실패해도 본 흐름 안 막음)
    getAuthorReaction(chatId, { content: userText, character_id: currentAuthor.characterId })
      .then(r => { if (r.reaction) showReaction(r.reaction); })
      .catch(() => {});

    await sendMessage(chatId, { content: userText, character_id: storyAuthor.characterId });

    const streamMsgId = `stream_${Date.now()}`;
    setMessages(prev => [...prev, { id: streamMsgId, role: 'character', name: storyAuthor.displayName, text: '' }]);
    setStreaming(true);

    const worldContext = buildWorldContext(world, dbCharacters);
    esRef.current = connectChatStream(
      chatId,
      { content: userText, character_id: storyAuthor.characterId, mode: 'author', world_context: worldContext },
      ({ narration, dialogue }) => {
        setMessages(prev =>
          prev.map(m => m.id === streamMsgId ? { ...m, narration, dialogue } : m)
        );
      },
      () => setStreaming(false),
    );
  }

  async function handleEnd() {
    if (!chatId || chatId === 'room_001') return alert('유효한 세션이 없습니다.');
    if (!window.confirm('채팅을 종료하고 대화 로그를 저장할까요?')) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setStreaming(false);
    setEnding(true);
    try {
      await completeSession(chatId);
    } catch (err) {
      alert(`세션 종료 실패: ${err.message}`);
      setEnding(false);
      return;
    }
    try { await generateNovel(chatId); } catch { /* 무시 */ }
    navigate('/storylist');
  }

  function handleFeedback() {
    if (!messages.length || authorLoading) return;
    const recent = messages.slice(-6).filter(m => m.text || m.narration || m.dialogue);
    const excerpt = recent.map(m => {
      if (m.role === 'user') return `독자: ${m.text}`;
      const parts = [];
      if (m.narration) parts.push(m.narration);
      if (m.dialogue) parts.push(`"${m.dialogue}"`);
      return parts.join('\n');
    }).join('\n\n');
    const prompt = `다음 대화 장면을 읽고 작가로서 피드백을 줘:\n\n---\n${excerpt}\n---`;
    setPanelView('author');
    handleSendAuthorMessage(prompt);
  }

  async function handleSaveSentence(msgId, content) {
    if (!userId) return;
    try {
      await saveSentence({ userId, content, sessionId: chatId !== 'room_001' ? chatId : null });
      setSavedMsgId(msgId);
      setTimeout(() => setSavedMsgId(null), 1500);
    } catch (e) { console.error(e); }
  }

  async function handleSwitchToEditor() {
    if (!chatId || chatId === 'room_001') return;
    setConverting(true);
    try {
      await convertToNovel(chatId);
    } catch { /* 변환 실패해도 에디터로 이동 */ }
    navigate('/editor', { state: { chatId, authorId } });
  }

  async function fetchSuggestions() {
    if (!chatId || chatId === 'room_001') return;
    const worldContext = buildWorldContext(world, dbCharacters);
    const data = await getSuggestions(chatId, { character_id: storyAuthor.characterId, world_context: worldContext });
    setSuggestions(data.suggestions ?? []);
  }

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className="chat-layout">

      {/* 왼쪽: 스토리 채팅 */}
      <div className="chat-main">
        <div className="chat-header">
          <div className="chat-header__info">
            {storyAuthor.image && (
              <img src={storyAuthor.image} alt={storyAuthor.displayName} className="chat-header__avatar" />
            )}
            <div className="chat-header__text">
              <span className="chat-header__persona">{world?.title ?? storyAuthor.displayName}</span>
              <span className="chat-header__genre">{world?.genre ?? ''}</span>
            </div>
          </div>
          <div className="chat-header__btns">
            <button className="mode-switch-btn" onClick={handleSwitchToEditor} disabled={converting || ending}>
              {converting ? '변환 중...' : '집필형 →'}
            </button>
            <button className="chat-end-btn" onClick={handleEnd} disabled={ending || converting}>
              {ending ? '저장 중...' : '채팅 종료'}
            </button>
          </div>
        </div>

        <div className="chat-messages">
          {importedNarration && (
            <div className="narration-import-block">
              <span className="narration-import-block__label">✍ 집필형 원고</span>
              <div className="narration-import-block__text">{importedNarration}</div>
              <div className="narration-import-block__divider">— 여기서부터 참여형 대화 —</div>
            </div>
          )}
          {messages.map(msg => (
            <Bubble
              key={msg.id}
              msg={msg}
              persona={storyAuthor}
              characterName={dbCharacters.find(c => c.role !== 'protagonist')?.name}
              streaming={streaming && msg === messages[messages.length - 1]}
              hasBookmark={memos.some(m => m.msgId === msg.id)}
              isSelected={selectedMsgId === msg.id}
              onContextMenu={msg.role !== 'system'
                ? e => handleBubbleContextMenu(e, msg.id)
                : undefined}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {suggestions.length > 0 && !streaming && (
          <div className="chat-suggestions">
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="suggestion-chip"
                onClick={() => { setInput(s); setSuggestions([]); }}
              >{s}</button>
            ))}
          </div>
        )}

        <div className="chat-input-bar">
          <button className="suggest-btn" onClick={fetchSuggestions} disabled={streaming} title="입력 추천">
            💡
          </button>
          <textarea
            className="chat-input"
            placeholder={streaming ? '응답 중...' : '주인공으로 대사 입력...'}
            value={input}
            disabled={streaming}
            rows={1}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
          />
          <button className="chat-send-btn" onClick={handleSend} disabled={streaming}>전송</button>
        </div>
      </div>

      {/* 오른쪽: 작가 AI 패널 */}
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
                  {reaction && (
                    <div className="author-reaction-subtitle" key={reaction}>— {reaction}</div>
                  )}
                  <div className="author-switcher author-panel__switcher-overlay">
                    <button className="author-switch-btn" onClick={prevAuthor}>‹</button>
                    <span className="author-name-badge">{currentAuthor.displayName}</span>
                    <button className="author-switch-btn" onClick={nextAuthor}>›</button>
                  </div>
                </div>

                {/* 태그 바 + 메모 버튼 */}
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
                      disabled={authorLoading || messages.length === 0}
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
                        {currentAuthor.displayName}에게<br />소설에 대해 물어보세요
                      </p>
                    )}
                    {authorMessages.map(msg => (
                      msg.role === 'ai' ? (
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
                      ) : (
                        <div key={msg.id} className="author-msg author-msg--user">{msg.content}</div>
                      )
                    ))}
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
                    <button
                      className="author-chat__send"
                      onClick={handleSendAuthorMessage}
                      disabled={authorLoading}
                    >→</button>
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
                {selectedMsgId && (
                  <div className="memo-context">
                    <div className="memo-context__header">
                      <span className="memo-context__label">🔖 책갈피</span>
                      <button className="memo-context__clear" onClick={clearBookmarkState}>×</button>
                    </div>
                    <textarea
                      ref={memoInputRef}
                      className="memo-input memo-context__input"
                      placeholder="메모 작성..."
                      value={memoInput}
                      rows={3}
                      onChange={e => setMemoInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddMemo(); }
                      }}
                    />
                    <button className="memo-context__save" onClick={handleAddMemo}>
                      {editingMemoId ? '수정' : '저장'}
                    </button>
                  </div>
                )}

                <div className="memo-view__list">
                  {memos.length === 0 && (
                    <p className="author-chat__empty">메모가 없습니다<br />말풍선을 우클릭해 추가하세요</p>
                  )}
                  {memos.map(memo => (
                    <div
                      key={memo.id}
                      className={`memo-item memo-item--${memo.type}${memo.msgId ? ' memo-item--bookmark' : ''}`}
                      onClick={() => handleMemoClick(memo)}
                    >
                      {memo.msgId && <p className="memo-item__ref">🔖 책갈피</p>}
                      <div className="memo-item__body">
                        <span>{memo.text}</span>
                        <button
                          className="memo-item__delete"
                          onClick={e => { e.stopPropagation(); setMemos(prev => prev.filter(m => m.id !== memo.id)); }}
                        >×</button>
                      </div>
                    </div>
                  ))}
                </div>

                {!selectedMsgId && (
                  <div className="memo-add">
                    <textarea
                      className="memo-input"
                      placeholder="메모 추가..."
                      value={memoInput}
                      rows={2}
                      onChange={e => setMemoInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddMemo(); }
                      }}
                    />
                    <button className="memo-add-btn" onClick={handleAddMemo}>+</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 컨텍스트 메뉴 */}
      {contextMenu.visible && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button className="context-menu__item" onClick={() => handleMemoFromContext(contextMenu.msgId)}>
            메모
          </button>
          <button
            className="context-menu__item context-menu__item--danger"
            onClick={() => handleDeleteMsg(contextMenu.msgId)}
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}
