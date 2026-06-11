import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { sendMessage, connectChatStream, completeSession, generateNovel, getSuggestions } from '../../lib/chatApi';
import { getSession, getWorld, getCharacters, getDialogues } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import './ui.css';

const AUTHOR_MAP = {
  1: { characterId: 'baekya',      displayName: '백야',   image: '/assets/author1/author1.png' },
  2: { characterId: 'charoun',     displayName: '차로운', image: '/assets/author2/author2.png' },
  3: { characterId: 'hanyeoreum', displayName: '한여름', image: '/assets/author3/author3.png' },
  4: { characterId: 'kimdohyeon', displayName: '김도현', image: '/assets/author4/author4.png' },
};

const MOCK_MEMOS = [
  { id: 1, type: 'auto', text: '복선 — 깜빡이는 가로등은 불안정한 현실을 암시' },
  { id: 2, type: 'auto', text: '방향 제안 — 골목 끝에 익숙한 실루엣을 등장시킬 것' },
];

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

function Bubble({ msg, persona, characterName, streaming, hasBookmark, isSelected, onClick }) {
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
      <div id={`bubble-${msg.id}`} className={`bubble-row bubble-row--char${isSelected ? ' bubble-row--selected' : ''}`} onClick={onClick}>
        <img src={persona.image} alt={msg.name} className="bubble-avatar" />
        <div className="bubble-content">
          <span className="badge badge--author">작가 {msg.name}</span>

          {/* 나레이션 — 말풍선 없음 */}
          {hasNarration && (
            <p className="narration-text">
              {hasBookmark && !hasDialogue && <span className="bubble-bookmark">🔖</span>}
              {formatText(msg.narration || msg.text)}
            </p>
          )}

          {isLoading && <div className="typing-dots"><span /><span /><span /></div>}

          {/* 대사 — 말풍선 */}
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
    <div id={`bubble-${msg.id}`} className={`bubble-row bubble-row--user${isSelected ? ' bubble-row--selected' : ''}`} onClick={onClick}>
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

// 작가 아바타 — 메모 패널 상단에 앉아 협업 반응(생각중·기억소환·일관성지적·메모받아적기)을 말풍선으로 표시
function AuthorAvatar({ persona, bubble }) {
  return (
    <div className="author-avatar">
      <div className={`author-avatar__bubble-wrap${bubble ? ' is-on' : ''}`}>
        {bubble && (
          <div className={`author-avatar__bubble author-avatar__bubble--${bubble.kind}`}>
            <span className="author-avatar__text">{bubble.text}</span>
            {bubble.kind === 'thinking' && (
              <span className="typing-dots typing-dots--inline"><span /><span /><span /></span>
            )}
          </div>
        )}
      </div>
      <div className={`author-avatar__figure${bubble ? ' is-reacting' : ''}`}>
        {persona.image
          ? <img src={persona.image} alt={persona.displayName} className="author-avatar__img" />
          : <div className="author-avatar__img author-avatar__img--ph">{persona.displayName?.[0]}</div>}
        <span className="author-avatar__name">작가 {persona.displayName}</span>
      </div>
    </div>
  );
}

export default function Chat() {
  const location = useLocation();
  const navigate = useNavigate();
  const { worldId, chatId: chatIdFromState, authorId: authorIdFromState } = location.state ?? {};
  const chatId = chatIdFromState ?? worldId ?? 'room_001';
  // authorId: state → localStorage 로 복원하고, 세션 로드 후 session.author_id(진짜 값)로 덮어쓴다
  const [authorId, setAuthorId] = useState(() => resolveAuthorId(authorIdFromState));
  useAuthorTheme(authorId);
  const persona = AUTHOR_MAP[authorId] ?? { characterId: 'baekya', displayName: '백야' };

  const MEMO_KEY = `memos_${chatId}`;

  const [messages, setMessages] = useState([]);
  const [memos, setMemos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(MEMO_KEY)) ?? MOCK_MEMOS; }
    catch { return MOCK_MEMOS; }
  });
  const [input, setInput] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [world, setWorld] = useState(null);
  const [dbCharacters, setDbCharacters] = useState([]);
  const [ending, setEnding] = useState(false);
  const [worldOpen, setWorldOpen] = useState(true);
  const [selectedMsgId, setSelectedMsgId] = useState(null);
  const [editingMemoId, setEditingMemoId] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const bottomRef = useRef(null);
  const esRef = useRef(null);
  const memoInputRef = useRef(null);

  // ── 작가 아바타 협업 말풍선 ──────────────────────────────
  const [avatarBubble, setAvatarBubble] = useState(null);  // { kind: 'thinking'|'memory'|'consistency'|'memo', text }
  const avatarTimerRef = useRef(null);

  function showAvatar(kind, text, ttl = 8000) {
    if (avatarTimerRef.current) clearTimeout(avatarTimerRef.current);
    setAvatarBubble({ kind, text });
    if (ttl > 0) avatarTimerRef.current = setTimeout(() => setAvatarBubble(null), ttl);
  }

  function trimText(s, n) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  // 응답에 딸려온 기억검색·일관성검수 결과를 아바타 말풍선으로 surface
  function reactAsAuthor(memories, consistency) {
    if (consistency && !consistency.consistent && consistency.violations?.length) {
      const v = consistency.violations[0];
      const txt = typeof v === 'string' ? v : (v.conflict || v.established || '설정이 좀 어긋나는데');
      showAvatar('consistency', `어, ${trimText(txt, 30)} — 설정 맞아?`, 11000);
    } else if (memories?.length) {
      showAvatar('memory', `아까 “${trimText(memories[0], 26)}” 기억하지?`, 9000);
    } else {
      setAvatarBubble(b => (b?.kind === 'thinking' ? null : b));  // 짚을 게 없으면 '쓰는 중' 정리
    }
  }

  useEffect(() => {
    localStorage.setItem(MEMO_KEY, JSON.stringify(memos));
  }, [memos]);

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
        // 세계관 요약 헤더 — 신규/이어쓰기 모두 항상 표시
        const summaryLines = [];
        if (w.title)       summaryLines.push(`제목     ${w.title}`);
        if (w.genre)       summaryLines.push(`장르     ${w.genre}`);
        if (w.description) summaryLines.push(`배경     ${w.description}`);
        if (w.setting)     summaryLines.push(`공간     ${w.setting}`);
        if (w.rules)       summaryLines.push(`규칙     ${w.rules}`);
        if (chars.length > 0) {
          if (summaryLines.length) summaryLines.push('');
          summaryLines.push('등장인물');
          chars.forEach(c => {
            const roleKo = c.role === 'protagonist' ? '주인공' : '조연';
            summaryLines.push(`• ${c.name}  (${roleKo})${c.personality ? `  —  ${c.personality}` : ''}`);
          });
        }
        summaryLines.push('');
        summaryLines.push('───────────────────────────────');
        const summaryMsg = { id: `summary_${Date.now()}`, role: 'system', text: summaryLines.join('\n') };

        const protagonistName = chars.find(c => c.role === 'protagonist')?.name ?? '나';


        if (dialogues.length > 0) {
          const restored = dialogues.map(d => ({
            id: d.id,
            role: d.speaker_type === 'user' ? 'user' : 'character',
            name: d.speaker_type === 'user' ? protagonistName : persona.displayName,
            text: d.content,
          }));
          setMessages([summaryMsg, ...restored]);
        } else {
          setMessages([summaryMsg]);
        }
      })
      .catch(console.error);
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || streaming) return;
    const userText = input.trim();
    setInput('');

    const protagonistName = dbCharacters.find(c => c.role === 'protagonist')?.name ?? '나';
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', name: protagonistName, text: userText }]);

    // 전송 즉시 '작가가 쓰는 중…' 피드백을 띄운다(백엔드 왕복을 기다리지 않음) → 체감 지연 제거
    const streamMsgId = `stream_${Date.now()}`;
    setMessages(prev => [...prev, { id: streamMsgId, role: 'character', name: persona.displayName, text: '' }]);
    setStreaming(true);
    showAvatar('thinking', '이야기, 쓰는 중…', 0);  // 응답 동안 '쓰는 중' 유지(자동 사라짐 X)

    try {
      await sendMessage(chatId, { content: userText, character_id: persona.characterId });
    } catch (err) {
      console.error('메시지 전송 실패:', err);
      setStreaming(false);
      setAvatarBubble(b => (b?.kind === 'thinking' ? null : b));  // '쓰는 중' 정리
      setMessages(prev => prev.filter(m => m.id !== streamMsgId));  // 빈 말풍선 제거
      return;
    }

    const worldContext = buildWorldContext(world, dbCharacters);
    esRef.current = connectChatStream(
      chatId,
      { content: userText, character_id: persona.characterId, mode: 'author', world_context: worldContext, check_consistency: true },
      ({ narration, dialogue, memories, consistency }) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === streamMsgId
              ? { ...m, narration, dialogue }
              : m
          )
        );
        reactAsAuthor(memories, consistency);  // 기억소환 / 일관성지적 말풍선
      },
      () => {
        setStreaming(false);
        setAvatarBubble(b => (b?.kind === 'thinking' ? null : b));  // 반응 없이 끝나면 '쓰는 중' 정리
      },
    );
  }

  async function handleEnd() {
    if (!chatId || chatId === 'room_001') return alert('유효한 세션이 없습니다.');
    if (!window.confirm('채팅을 종료하고 대화 로그를 저장할까요?')) return;

    // 응답 중이면 스트림 강제 종료
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStreaming(false);

    setEnding(true);
    try {
      await completeSession(chatId);
    } catch (err) {
      alert(`세션 종료 실패: ${err.message}`);
      setEnding(false);
      return;
    }

    // 소설 생성 실패해도 종료는 진행
    try {
      await generateNovel(chatId);
    } catch (err) {
      console.warn('소설 생성 실패 (무시):', err.message);
    }

    navigate('/chatlist');
  }

  async function fetchSuggestions() {
    if (!chatId || chatId === 'room_001') return;
    const worldContext = buildWorldContext(world, dbCharacters);
    const data = await getSuggestions(chatId, { character_id: persona.characterId, world_context: worldContext });
    setSuggestions(data.suggestions ?? []);
  }


  function getMsgPreview(msgId) {
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return '';
    const text = msg.narration || msg.dialogue || msg.text || '';
    return text.length > 36 ? text.slice(0, 36) + '…' : text;
  }

  function clearBookmarkState() {
    setSelectedMsgId(null);
    setEditingMemoId(null);
    setMemoInput('');
  }

  function handleBubbleClick(msgId) {
    const existing = memos.find(m => m.msgId === msgId);
    if (existing) {
      setEditingMemoId(existing.id);
      setMemoInput(existing.text);
    } else {
      setEditingMemoId(null);
      setMemoInput('');
    }
    setSelectedMsgId(prev => prev === msgId ? null : msgId);
    setPanelOpen(true);
    setTimeout(() => memoInputRef.current?.focus(), 80);
  }

  function handleMemoClick(memo) {
    if (memo.msgId) {
      document.getElementById(`bubble-${memo.msgId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setSelectedMsgId(memo.msgId);
      setEditingMemoId(memo.id);
      setMemoInput(memo.text);
      setPanelOpen(true);
      setTimeout(() => memoInputRef.current?.focus(), 80);
    }
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
    showAvatar('memo', '기억해둘게.', 2800);  // 작가가 메모를 받아적는 연출
    clearBookmarkState();
  }

  return (
    <div className="chat-layout">
      {/* 채팅 영역 */}
      <div className="chat-main">
        <div className="chat-header">
          <div className="chat-header__info">
            {persona.image && (
              <img src={persona.image} alt={persona.displayName} className="chat-header__avatar" />
            )}
            <div className="chat-header__text">
              <span className="chat-header__persona">{world?.title ?? persona.displayName}</span>
              <span className="chat-header__genre">{world?.genre ?? ''}</span>
            </div>
          </div>
          <button className="chat-end-btn" onClick={handleEnd} disabled={ending}>
            {ending ? '저장 중...' : '채팅 종료'}
          </button>
        </div>

        <div className="chat-messages">
          {messages.map(msg => (
            <Bubble
              key={msg.id}
              msg={msg}
              persona={persona}
              characterName={dbCharacters.find(c => c.role !== 'protagonist')?.name}
              streaming={streaming && msg === messages[messages.length - 1]}
              hasBookmark={memos.some(m => m.msgId === msg.id)}
              isSelected={selectedMsgId === msg.id}
              onClick={msg.role !== 'system' ? () => handleBubbleClick(msg.id) : undefined}
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
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="chat-input-bar">
          <button
            className="suggest-btn"
            onClick={fetchSuggestions}
            disabled={streaming}
            title="입력 추천"
          >💡</button>
          <textarea
            className="chat-input"
            placeholder={streaming ? '응답 중...' : '주인공으로 대사 입력...'}
            value={input}
            disabled={streaming}
            rows={1}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button className="chat-send-btn" onClick={handleSend} disabled={streaming}>전송</button>
        </div>
      </div>

      {/* 메모 패널 래퍼 */}
      <div className="memo-wrapper">
        <button
          className="panel-toggle-btn"
          onClick={() => setPanelOpen(prev => !prev)}
          aria-label={panelOpen ? '메모 패널 닫기' : '메모 패널 열기'}
        >
          {panelOpen ? '>' : '<'}
        </button>

        <div className={`memo-slide ${panelOpen ? 'memo-slide--open' : ''}`}>
          <aside className="memo-panel">
            <AuthorAvatar persona={persona} bubble={avatarBubble} />
            {world && (
              <div className="world-summary">
                <button
                  className="world-summary__toggle"
                  onClick={() => setWorldOpen(prev => !prev)}
                >
                  세계관 요약 {worldOpen ? '▲' : '▼'}
                </button>
                {worldOpen && (
                  <div className="world-summary__body">
                    {world.description && (
                      <p className="world-summary__desc">{world.description}</p>
                    )}
                    {world.setting && (
                      <div className="world-summary__field">
                        <span className="world-summary__label">배경</span>
                        <p className="world-summary__text">{world.setting}</p>
                      </div>
                    )}
                    {world.rules && (
                      <div className="world-summary__field">
                        <span className="world-summary__label">규칙</span>
                        <p className="world-summary__text">{world.rules}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="char-list">
              <p className="char-list__title">등장인물</p>
              {dbCharacters.length > 0
                ? dbCharacters.map(c => (
                    <div key={c.id} className="char-item">
                      ● {c.name} <span className="char-role">({c.role === 'protagonist' ? '주인공' : '조연'})</span>
                    </div>
                  ))
                : <div className="char-item">● {persona.displayName} (작가 AI)</div>
              }
            </div>

            <p className="memo-panel__title">작가 메모</p>

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
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAddMemo();
                    }
                  }}
                />
                <button className="memo-context__save" onClick={handleAddMemo}>{editingMemoId ? '수정' : '저장'}</button>
              </div>
            )}

            <div className="memo-list">
              {memos.map(memo => (
                <div
                  key={memo.id}
                  className={`memo-item memo-item--${memo.type}${memo.msgId ? ' memo-item--bookmark' : ''}`}
                  onClick={() => handleMemoClick(memo)}
                >
                  {memo.msgId && (
                    <p className="memo-item__ref">🔖 책갈피</p>
                  )}
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
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAddMemo();
                    }
                  }}
                />
                <button className="memo-add-btn" onClick={handleAddMemo}>+</button>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
