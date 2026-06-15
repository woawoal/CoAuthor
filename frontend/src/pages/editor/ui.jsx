import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sendAuthorMessage, generateAuthorRewrite, getMemos, saveMemos, getTasteRecommend, proofread, addGlossaryTerm } from '../../lib/chatApi';
import { API_BASE_URL } from '../../lib/apiBase';
import { getSession, getWorld, getCharacters } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import { authClient } from '../../lib/auth';
import AuthorPanel from '../../components/AuthorPanel';
import './ui.css';

const AUTHOR_IDS = [1, 2, 3, 4];
const AUTHOR_MAP = {
  1: { characterId: 'baekya', displayName: '백야', image: '/assets/author1/author1.png' },
  2: { characterId: 'charoun', displayName: '차로운', image: '/assets/author2/author2.png' },
  3: { characterId: 'hanyeoreum', displayName: '한여름', image: '/assets/author3/author3.png' },
  4: { characterId: 'kimdohyeon', displayName: '김도현', image: '/assets/author4/author4.png' },
};

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

  // ── 패널 관련 상태 (AuthorPanel과 공유) ──────────────────
  const [autoFeedback, setAutoFeedback] = useState(false);
  const [realtimeProof, setRealtimeProof] = useState(false);
  const [memos, setMemos] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [proofMemo, setProofMemo] = useState('');
  const [userId, setUserId] = useState(null);
  const [hasSelection, setHasSelection] = useState(false);

  // ── Refs ─────────────────────────────────────────────────
  const saveTimerRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const proofTimerRef = useRef(null);
  const textareaRef = useRef(null);
  const authorPanelRef = useRef(null);

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
    fetch(`${API_BASE_URL}/sessions/${chatId}/novel`)
      .then(r => r.ok ? r.json() : null)
      .then(novel => { if (novel?.content) setContent(novel.content); })
      .catch(() => { });
  }, [chatId]);

  // ── 마지막 사용 모드 기록 ────────────────────────────────
  useEffect(() => {
    if (chatId) localStorage.setItem(`session_mode_${chatId}`, 'editor');
  }, [chatId]);

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
    if (!autoFeedback || !content.trim()) return;
    clearTimeout(feedbackTimerRef.current);
    const paragraphs = content.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const lastParagraph = paragraphs[paragraphs.length - 1] ?? content.trim();
    feedbackTimerRef.current = setTimeout(() => {
      if (!authorPanelRef.current?.isLoading()) {
        authorPanelRef.current?.triggerFeedback(lastParagraph);
      }
    }, 3000);
    return () => clearTimeout(feedbackTimerRef.current);
  }, [content, autoFeedback]);

  // ── 맞춤법 교정 (2.5초 debounce, 마지막 문단을 F-QC-02로 검사) ──
  useEffect(() => {
    if (!chatId || !content.trim()) { setCorrections([]); return; }
    if (!realtimeProof) return;                 // 실시간 교정 OFF → 자동 검사·전환 안 함
    clearTimeout(proofTimerRef.current);
    const paras = content.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    const last = paras[paras.length - 1] ?? content.trim();
    proofTimerRef.current = setTimeout(() => {
      proofread(chatId, last, currentAuthor.characterId)
        .then(r => {
          if (!r.errors?.length) return;
          setProofMemo(r.memo || '');
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
          authorPanelRef.current?.showProofView();
        })
        .catch(() => { });
    }, 2500);
    return () => clearTimeout(proofTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, realtimeProof]);

  // ── 저장 ─────────────────────────────────────────────────
  async function saveDraft() {
    if (!chatId) return;
    setSaveStatus('saving');
    try {
      await fetch(`${API_BASE_URL}/sessions/${chatId}/novel/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('unsaved');
    }
  }

  function getEditorFeedbackText() {
    if (!content.trim()) return null;
    if (textareaRef.current) {
      const { selectionStart, selectionEnd } = textareaRef.current;
      if (selectionStart !== selectionEnd) return content.slice(selectionStart, selectionEnd);
    }
    return content.length > 800 ? content.slice(-800) : content;
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
            <span className="editor-header__title">{world?.title ?? ''}</span>
            <span className="editor-header__genre">{world?.genre ?? ''}</span>
          </div>
          <div className="editor-header__actions">
            <div className="mode-switcher mode-switcher--on">
              <button
                className="mode-switcher__track"
                onClick={handleSwitchToChat}
                aria-label="참여형으로 전환"
              />
              <span className="mode-switcher__label">집필형</span>
            </div>
            <button className="editor-save-btn" onClick={saveDraft} disabled={saveStatus === 'saving'}>저장</button>
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
      <AuthorPanel
        ref={authorPanelRef}
        chatId={chatId}
        userId={userId}
        world={world}
        dbCharacters={dbCharacters}
        mode="editor"
        currentAuthorIdx={currentAuthorIdx}
        onAuthorChange={setCurrentAuthorIdx}
        autoFeedback={autoFeedback}
        onAutoFeedbackChange={setAutoFeedback}
        realtimeProof={realtimeProof}
        onRealtimeProofChange={setRealtimeProof}
        memos={memos}
        onMemosChange={setMemos}
        onApplyText={text => setContent(prev => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + text)}
        getFeedbackText={getEditorFeedbackText}
        isFeedbackDisabled={!content.trim()}
        corrections={corrections}
        proofMemo={proofMemo}
        onApplyCorrection={(key, from, to) => {
          setContent(prev => prev.split(from).join(to));
          setCorrections(prev => prev.map(x => x.key === key ? { ...x, applied: true } : x));
        }}
        onSkipCorrection={key => setCorrections(prev => prev.filter(x => x.key !== key))}
        onClearCorrections={() => { setCorrections([]); setProofMemo(''); }}
        hasSelection={hasSelection}
      />
    </div>
  );
}
