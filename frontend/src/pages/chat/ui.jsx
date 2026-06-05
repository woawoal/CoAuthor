import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { sendMessage, connectChatStream } from '../../lib/chatApi';
import './ui.css';

const AUTHOR_MAP = {
  1: { characterId: 'baekya',      displayName: '백야' },
  2: { characterId: 'charoun',     displayName: '차로운' },
  3: { characterId: 'hanyeoreum', displayName: '한여름' },
  4: { characterId: 'kimdohyeon', displayName: '김도현' },
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

function Bubble({ msg }) {
  const isUser = msg.role === 'user';
  const displayText = isUser ? msg.text : formatText(msg.text);
  const isLoading = !isUser && msg.text === '';
  return (
    <div className={`bubble-row ${isUser ? 'bubble-row--user' : 'bubble-row--char'}`}>
      {!isUser && <span className="badge">{msg.name}</span>}
      <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--char'}`}>
        {isLoading ? (
          <div className="typing-dots">
            <span /><span /><span />
          </div>
        ) : displayText}
      </div>
      {isUser && <span className="badge badge--user">{msg.name}</span>}
    </div>
  );
}

export default function Chat() {
  const location = useLocation();
  const { worldId, authorId } = location.state ?? {};
  const chatId = worldId ?? 'room_001';
  const persona = AUTHOR_MAP[authorId] ?? { characterId: 'baekya', displayName: '백야' };

  const [messages, setMessages] = useState([]);
  const [memos, setMemos] = useState(MOCK_MEMOS);
  const [input, setInput] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef(null);
  const esRef = useRef(null);

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
          <span className="chat-header__persona">{persona.displayName}</span>
          <span className="chat-header__genre">스릴러/미스터리</span>
        </div>

        <div className="chat-messages">
          {messages.map(msg => <Bubble key={msg.id} msg={msg} />)}
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

            <div className="char-list">
              <p className="char-list__title">등장인물</p>
              <div className="char-item">● 백일 (작가 AI)</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
