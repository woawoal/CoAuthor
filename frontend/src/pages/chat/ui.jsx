import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sendMessage, connectChatStream, completeSession, generateNovel } from '../../lib/chatApi';
import { getSession, getWorld, getCharacters, getDialogues } from '../../lib/worldviewApi';
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

function formatText(text) {
  return text
    .replace(/"([^"]*)"/g, '\n\n"$1"\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function Bubble({ msg, persona }) {
  const isUser = msg.role === 'user';
  const displayText = isUser ? msg.text : formatText(msg.text);
  const isLoading = !isUser && msg.text === '';

  if (!isUser) {
    return (
      <div className="bubble-row bubble-row--char">
        <img src={persona.image} alt={msg.name} className="bubble-avatar" />
        <div className="bubble-content">
          <span className="badge">{msg.name}</span>
          <div className="bubble bubble--char">
            {isLoading ? <div className="typing-dots"><span /><span /><span /></div> : displayText}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bubble-row bubble-row--user">
      <div className={`bubble bubble--user`}>{displayText}</div>
      <span className="badge badge--user">{msg.name}</span>
    </div>
  );
}

export default function Chat() {
  const location = useLocation();
  const navigate = useNavigate();
  const { worldId, chatId: chatIdFromState, authorId } = location.state ?? {};
  const chatId = chatIdFromState ?? worldId ?? 'room_001';
  const persona = AUTHOR_MAP[authorId] ?? { characterId: 'baekya', displayName: '백야' };

  const [messages, setMessages] = useState([]);
  const [memos, setMemos] = useState(MOCK_MEMOS);
  const [input, setInput] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [world, setWorld] = useState(null);
  const [dbCharacters, setDbCharacters] = useState([]);
  const [ending, setEnding] = useState(false);
  const [worldOpen, setWorldOpen] = useState(true);
  const bottomRef = useRef(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!chatId || chatId === 'room_001') return;
    getSession(chatId)
      .then(session =>
        Promise.all([
          getWorld(session.world_id),
          getCharacters(session.world_id),
          getDialogues(chatId),
        ])
      )
      .then(([w, chars, dialogues]) => {
        setWorld(w);
        setDbCharacters(chars);
        if (dialogues.length > 0) {
          const restored = dialogues.map(d => ({
            id: d.id,
            role: d.speaker_type === 'user' ? 'user' : 'character',
            name: d.speaker_type === 'user' ? '나' : persona.displayName,
            text: d.content,
          }));
          setMessages(restored);
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

    setMessages(prev => [...prev, { id: Date.now(), role: 'user', name: '나', text: userText }]);

    await sendMessage(chatId, { content: userText, character_id: persona.characterId });

    const streamMsgId = `stream_${Date.now()}`;
    setMessages(prev => [...prev, { id: streamMsgId, role: 'character', name: persona.displayName, text: '' }]);
    setStreaming(true);

    esRef.current = connectChatStream(
      chatId,
      { content: userText, character_id: persona.characterId, mode: 'author' },
      (data) => {
        setMessages(prev =>
          prev.map(m => m.id === streamMsgId ? { ...m, text: m.text + data.text } : m)
        );
      },
      () => setStreaming(false),
    );
  }

  async function handleEnd() {
    if (!chatId || chatId === 'room_001') return alert('유효한 세션이 없습니다.');
    if (!window.confirm('채팅을 종료하고 대화 로그를 저장할까요?')) return;
    setEnding(true);
    try {
      await completeSession(chatId);
      await generateNovel(chatId);
      navigate('/chatlist');
    } catch (err) {
      alert(`저장 실패: ${err.message}`);
    } finally {
      setEnding(false);
    }
  }

  function handleAddMemo() {
    if (!memoInput.trim()) return;
    setMemos(prev => [...prev, { id: Date.now(), type: 'manual', text: memoInput }]);
    setMemoInput('');
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
          {messages.map(msg => <Bubble key={msg.id} msg={msg} persona={persona} />)}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-bar">
          <input
            className="chat-input"
            placeholder={streaming ? '응답 중...' : '주인공으로 대사 입력...'}
            value={input}
            disabled={streaming}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
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

            <div className="memo-list">
              {memos.map(memo => (
                <div key={memo.id} className={`memo-item memo-item--${memo.type}`}>
                  {memo.text}
                </div>
              ))}
            </div>

            <div className="memo-add">
              <input
                className="memo-input"
                placeholder="메모 추가..."
                value={memoInput}
                onChange={e => setMemoInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddMemo()}
              />
              <button className="memo-add-btn" onClick={handleAddMemo}>+</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
