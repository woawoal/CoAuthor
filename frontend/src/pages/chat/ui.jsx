import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  sendMessage, connectChatStream, completeSession, generateNovel, convertToNovel,
  getSuggestions, getVoiceSuggestions, sendAuthorMessage, generateAuthorRewrite,
  getMemos, saveMemos, getAuthorReaction, getTasteRecommend, proofread,
} from '../../lib/chatApi';
import { getVoiceProfile } from '../../lib/voiceApi';
import { getSession, getWorld, getCharacters, getDialogues } from '../../lib/worldviewApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import { authClient } from '../../lib/auth';
import { saveSentence } from '../../lib/mypageApi';
import { getTaste, analyzeTaste } from '../../lib/tasteApi';
import { applyGlobalVideoVolume, VIDEO_VOLUME_EVENT } from '../../lib/videoVolume';
import './ui.css';

const AUTHOR_IDS = [1, 2, 3, 4];

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

const AUTHOR_RECOMMEND_GREETING = {
  baekya: '...어떤 추천이 필요한가요.',
  charoun: '어떤 방향의 추천을 드릴까요?',
  hanyeoreum: '어떤 거 추천해드릴까요~?',
  kimdohyeon: '어떤 추천이 필요해요?',
};

const NARRATION_KEYWORDS = ['지문', '대사', '문장', '씬', '장면', '선택지', '다음', '행동', '추천'];

const AUTHOR_MAP = {
  1: { characterId: 'baekya', displayName: '백야', image: '/assets/author1/author1.png' },
  2: { characterId: 'charoun', displayName: '차로운', image: '/assets/author2/author2.png' },
  3: { characterId: 'hanyeoreum', displayName: '한여름', image: '/assets/author3/author3.png' },
  4: { characterId: 'kimdohyeon', displayName: '김도현', image: '/assets/author4/author4.png' },
};

function buildWorldContext(world, characters) {
  if (!world) return '';
  const lines = [];
  if (world.title) lines.push(`제목: ${world.title}`);
  if (world.genre) lines.push(`장르: ${world.genre}`);
  if (world.description) lines.push(`배경: ${world.description}`);
  if (world.setting) lines.push(`공간: ${world.setting}`);
  if (world.rules) lines.push(`규칙: ${world.rules}`);
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

// 받은 텍스트를 타자기처럼 한 글자씩 표시(백엔드는 통째로 보내고 화면 노출만 점진적 → 응답 '마' 제거)
function TypedText({ text, speed = 30, step = 1, onType, onDone }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!text) { onDone?.(); return; }
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(text.length, i + step);
      setCount(i);
      onType?.();
      if (i >= text.length) { clearInterval(id); onDone?.(); }
    }, speed);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return text.slice(0, count);
}

// 작가 AI 메시지 — 라이브 응답이면 나레이션→대사 순으로 타이핑, 복원된 기록은 즉시 표시
function CharMessage({ msg, characterName, hasBookmark, onType, onDone }) {
  const live = !!msg.narration;                       // 스트림 응답만 타이핑(복원 기록 X)
  const narration = formatText(msg.narration || msg.text || '');
  const hasDialogue = !!msg.dialogue;
  const charName = characterName || msg.name;
  const [narrDone, setNarrDone] = useState(!live || !narration);

  return (
    <div className="bubble-content">
      {narration && (
        <p className="narration-text">
          {hasBookmark && !hasDialogue && <span className="bubble-bookmark">🔖</span>}
          {live
            ? <TypedText text={narration} onType={onType} onDone={() => { setNarrDone(true); if (!hasDialogue) onDone?.(); }} />
            : narration}
        </p>
      )}
      {hasDialogue && narrDone && (
        <div className="dialogue-block">
          <span className="badge">{charName}</span>
          <div className="bubble bubble--char">
            {hasBookmark && <span className="bubble-bookmark">🔖</span>}
            &ldquo;{live ? <TypedText text={msg.dialogue} onType={onType} onDone={onDone} /> : msg.dialogue}&rdquo;
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ msg, persona, characterName, streaming, hasBookmark, isSelected, onContextMenu, onType, onDone }) {
  if (msg.role === 'system') {
    return <div className="world-info-header">{msg.text}</div>;
  }

  const isUser = msg.role === 'user';

  if (!isUser) {
    const hasContent = !!(msg.narration || msg.text || msg.dialogue);
    const isLoading = !hasContent && streaming;

    return (
      <div
        id={`bubble-${msg.id}`}
        className={`bubble-row bubble-row--char${isSelected ? ' bubble-row--selected' : ''}`}
        onContextMenu={onContextMenu}
      >
        {isLoading ? (
          <div className="bubble-content">
            <div className="typing-dots"><span /><span /><span /></div>
          </div>
        ) : (
          <CharMessage msg={msg} characterName={characterName} hasBookmark={hasBookmark} onType={onType} onDone={onDone} />
        )}
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
  const [videoError, setVideoError] = useState(false);
  const [reactionEmotion, setReactionEmotion] = useState(null);
  const delayTimerRef = useRef(null);
  const delayPlayedRef = useRef(false);
  const pendingReactionEmotionRef = useRef(null);

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

  useEffect(() => {
    setVideoError(false);
  }, [currentAuthorIdx]);

  // ── 스토리 채팅 상태 ───────────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(!!chatId && chatId !== 'room_001');   // 채팅 기록 로딩 표시
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
  const [panelWidth, setPanelWidth] = useState(760);    // 작가 패널 기본 너비 = 드래그 최대값(px)
  const [isResizing, setIsResizing] = useState(false);
  const [panelView, setPanelView] = useState('author'); // 'author' | 'memo'
  const [authorMessages, setAuthorMessages] = useState([]);
  const [authorInput, setAuthorInput] = useState('');
  const [authorLoading, setAuthorLoading] = useState(false);

  // ── 메모 상태 ────────────────────────────────────────────
  const [memos, setMemos] = useState([]);
  const [corrections, setCorrections] = useState([]);   // 맞춤법 교정 결과(작가 메모로 표시)
  const [selectedMsgId, setSelectedMsgId] = useState(null);
  const [memoInput, setMemoInput] = useState('');
  const [editingMemoId, setEditingMemoId] = useState(null);
  const memosLoadedRef = useRef(false);

  // ── 컨텍스트 메뉴 ─────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, msgId: null, recContent: null, copyContent: null });

  // ── 자동 피드백 상태 ─────────────────────────────────────
  const [autoFeedback, setAutoFeedback] = useState(false);
  const [realtimeProof, setRealtimeProof] = useState(false);   // 실시간 교정 ON/OFF

  // ── 문장 저장 상태 ───────────────────────────────────────
  const [userId, setUserId] = useState(null);
  const [savedMsgId, setSavedMsgId] = useState(null);

  // ── 취향 패널 상태 ────────────────────────────────────────
  const [showTastePanel, setShowTastePanel] = useState(false);
  const [tasteWorks, setTasteWorks] = useState([]);
  const [tasteInput, setTasteInput] = useState('');
  const [tasteProfile, setTasteProfile] = useState(null);
  const [tasteAnalyzing, setTasteAnalyzing] = useState(false);
  const [tasteRecommending, setTasteRecommending] = useState(false);

  // ── Refs ─────────────────────────────────────────────────
  const bottomRef = useRef(null);
  const esRef = useRef(null);
  const authorBottomRef = useRef(null);
  const memoInputRef = useRef(null);
  const awaitingRecommendRef = useRef(false);
  const feedbackTimerRef = useRef(null);

  // ── userId 로드 + 기존 취향 복원 ────────────────────────
  useEffect(() => {
    authClient.getSession().then(s => {
      const uid = s.data?.user?.id ?? null;
      setUserId(uid);
      if (uid && chatId && chatId !== 'room_001') {
        getTaste(chatId, uid).then(data => {
          if (data.works?.length) setTasteWorks(data.works);
          if (data.taste_profile && Object.keys(data.taste_profile).length) setTasteProfile(data.taste_profile);
        }).catch(() => { });
      }
    });
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
    if (!chatId || chatId === 'room_001') { setLoadingHistory(false); return; }
    setLoadingHistory(true);
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
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
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

  // ── 작가 패널 너비 드래그 리사이즈 ───────────────────────
  useEffect(() => {
    if (!isResizing) return;
    function onMove(e) {
      // 패널은 화면 오른쪽에 도킹 → 너비 = 화면폭 - 마우스X (320~760px로 제한)
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

  async function handleSendAuthorMessage(overrideText, { skipRecommend = false, mode = 'chat', hideUser = false } = {}) {
    const text = (overrideText ?? authorInput).trim();
    if (!text || authorLoading) return;
    if (!overrideText) setAuthorInput('');
    // 피드백 요청처럼 원문을 패널에 노출하기 싫을 땐 opts.hideUser 로 사용자 말풍선 생략
    if (!hideUser) setAuthorMessages(prev => [...prev, { id: `au_${Date.now()}`, role: 'user', content: text }]);
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
      if (isNarrationReq) fetchSuggestions();
      if (!skipRecommend) fetchRecommendation(data.messageId, currentAuthor.characterId, text, data.content);
    } catch (err) {
      console.error('작가 AI 오류:', err);
    } finally {
      setAuthorLoading(false);
    }
  }

  async function runTasteAnalysis(works) {
    if (!userId || !chatId || chatId === 'room_001') return;
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
    if (!userId || !chatId || chatId === 'room_001' || tasteRecommending) return;
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
      if (userId && chatId && chatId !== 'room_001') {
        analyzeTaste(chatId, { user_id: userId, works: [] }).catch(() => { });
      }
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
      setShowTastePanel(prev => !prev);
      return;
    }
    if (tag.label === '#취향저격ai') {
      setShowWorldInfo(false);
      setShowCharInfo(false);
      setPanelView('author');
      handleTasteRecommend();
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
    reactionTimerRef.current = setTimeout(() => setReaction(''), 15000);
  }

  function playPendingReaction() {
    if (!pendingReactionEmotionRef.current) return;

    setReactionEmotion(pendingReactionEmotionRef.current);
    pendingReactionEmotionRef.current = null;
  }

  function resetDelayTimer() {
    if (delayTimerRef.current) clearTimeout(delayTimerRef.current);

    delayTimerRef.current = setTimeout(() => {
      if (!delayPlayedRef.current && !streaming) {
        setReactionEmotion('delays');
        delayPlayedRef.current = true;
      }
    }, 3 * 60 * 1000);
  }

  useEffect(() => {
    resetDelayTimer();

    return () => {
      if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
    };
  }, [streaming]);

  async function handleSend() {
    if (!input.trim() || streaming) return;
    const userText = input.trim();
    setInput('');

    const isFirstChat = messages.length === 0 && !importedNarration;
    delayPlayedRef.current = false;
    resetDelayTimer();

    const protagonistName = dbCharacters.find(c => c.role === 'protagonist')?.name ?? '나';
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', name: protagonistName, text: userText }]);

    // 작가 리액션 자막 — 메인 응답과 독립(느려도/실패해도 본 흐름 안 막음)
    getAuthorReaction(chatId, {
      content: userText,
      character_id: currentAuthor.characterId
    })
      .then(r => {
        if (r.reaction) {
          console.log(
            `[REACTION] emotion=${r.emotion}, reaction=${r.reaction}`
          );

          showReaction(r.reaction);

          if (isFirstChat) {
            pendingReactionEmotionRef.current = 'start';
          } else if (r.emotion === 'joy' || r.emotion === 'tension') {
            pendingReactionEmotionRef.current = r.emotion;
          }
        }
      })
      .catch(err => {
        console.error('[REACTION ERROR]', err);
      });

    // 맞춤법 교정 — 실시간 교정 ON일 때만 작가가 '여백 메모'로 짚어줌 (느려도/실패해도 본 흐름 안 막음)
    if (realtimeProof) {
      proofread(chatId, userText, currentAuthor.characterId)
        .then(r => {
          if (r.errors?.length) {
            setCorrections(prev => [{ id: Date.now(), errors: r.errors, memo: r.memo }, ...prev].slice(0, 5));
            setPanelView('proof');   // 교정 있으면 교정 뷰로 자동 전환(바로 보이게)
          }
        })
        .catch(() => {});
    }

    await sendMessage(chatId, { content: userText, character_id: storyAuthor.characterId });

    const streamMsgId = `stream_${Date.now()}`;
    setMessages(prev => [...prev, { id: streamMsgId, role: 'character', name: storyAuthor.displayName, text: '' }]);
    setStreaming(true);

    const worldContext = buildWorldContext(world, dbCharacters);

    // 50초 내 응답 없으면 로딩 해제
    const streamTimeoutId = setTimeout(() => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      setStreaming(false);
      setMessages(prev => prev.map(m =>
        m.id === streamMsgId && !m.narration && !m.dialogue
          ? { ...m, text: '⏱️ 응답 시간이 초과되었습니다. 다시 시도해주세요.' }
          : m
      ));
    }, 50000);

    esRef.current = connectChatStream(
      chatId,
      { content: userText, character_id: storyAuthor.characterId, mode: 'author', world_context: worldContext },
      ({ narration, dialogue }) => {
        setMessages(prev =>
          prev.map(m => m.id === streamMsgId ? { ...m, narration, dialogue } : m)
        );
      },
      () => {
        clearTimeout(streamTimeoutId);
        setStreaming(false);
      },
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
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user' && m.text);
    if (!lastUserMsg) return;
    setPanelView('author');
    handleSendAuthorMessage(lastUserMsg.text, { mode: 'feedback', hideUser: true });
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

    if (userId) {
      try {
        const voiceProfile = await getVoiceProfile();
        if (voiceProfile) {
          const lastCharMsg = [...messages].reverse().find(m => m.role === 'character');
          const npcDialogue = lastCharMsg?.dialogue || lastCharMsg?.narration || '';
          const data = await getVoiceSuggestions(chatId, {
            npc_dialogue: npcDialogue,
            genre: world?.genre || '',
          });
          if (data.suggestions?.length) {
            setSuggestions(data.suggestions);
            return;
          }
        }
      } catch { /* 폴백 */ }
    }

    const worldContext = buildWorldContext(world, dbCharacters);
    const data = await getSuggestions(chatId, { character_id: storyAuthor.characterId, world_context: worldContext });
    setSuggestions(data.suggestions ?? []);
  }

  const authorVideoRef = useRef(null);
  // ── 볼륨 설정 ─────────────────────────────────────────────────
  useEffect(() => {
    const video = authorVideoRef.current;
    if (!video) return;

    applyGlobalVideoVolume(video);

    const handleVolumeChange = () => {
      applyGlobalVideoVolume(authorVideoRef.current);
    };

    window.addEventListener(
      VIDEO_VOLUME_EVENT,
      handleVolumeChange
    );

    return () => {
      window.removeEventListener(
        VIDEO_VOLUME_EVENT,
        handleVolumeChange
      );
    };
  }, [currentAuthorIdx, reactionEmotion]);

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className="chat-layout">
      {converting && (
        <div className="convert-loading">소설로 변환하는 중...</div>
      )}

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
              <span className="narration-import-block__label">원고</span>
              <div className="narration-import-block__text">{importedNarration}</div>
              <div className="narration-import-block__divider">— 여기서부터 참여형 대화 —</div>
            </div>
          )}
          {loadingHistory && (
            <div className="chat-loading">채팅을 불러오는 중...</div>
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
              onType={() => bottomRef.current?.scrollIntoView({ block: 'end' })}
              onDone={playPendingReaction}
              onContextMenu={msg.role !== 'system'
                ? e => handleBubbleContextMenu(e, msg.id)
                : undefined}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {suggestions.length > 0 && !streaming && (
          <div className="chat-suggestions">
            {suggestions.map((s, i) => {
              const text = typeof s === 'string' ? s : s.text;
              const label = typeof s === 'object' ? s.label : null;
              return (
                <button
                  key={i}
                  className="suggestion-chip"
                  onClick={() => { setInput(text); setSuggestions([]); }}
                >
                  {label && <span className="suggestion-chip__label">{label}</span>}
                  {text}
                </button>
              );
            })}
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
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); }
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
                      ref={authorVideoRef}
                      key={`${AUTHOR_IDS[currentAuthorIdx]}-${reactionEmotion ?? 'default'}`}
                      src={
                        reactionEmotion
                          ? `/assets/author${AUTHOR_IDS[currentAuthorIdx]}/${reactionEmotion}.mp4`
                          : `/assets/author${AUTHOR_IDS[currentAuthorIdx]}/default.mp4`
                      }
                      autoPlay
                      loop={!reactionEmotion}
                      playsInline
                      onEnded={() => setReactionEmotion(null)}
                      onError={() => setVideoError(true)}
                    />
                  ) : (
                    <img
                      src={currentAuthor.image}
                      alt={currentAuthor.displayName}
                    />
                  )}
                  {reaction && (
                    <div className="author-reaction-subtitle" key={reaction}>- {reaction}</div>
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
                      className={`author-tag${(tag.label === '#세계관' && showWorldInfo) ||
                        (tag.label === '#등장인물' && showCharInfo)
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
                    {corrections.reduce((n, c) => n + c.errors.length, 0) > 0 &&
                      <span className="memo-count memo-count--proof">{corrections.reduce((n, c) => n + c.errors.length, 0)}</span>}
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
                  <span className="auto-feedback-bar__label auto-feedback-bar__label--proof">실시간 교정</span>
                  <button
                    className={`auto-feedback-toggle${realtimeProof ? ' auto-feedback-toggle--on' : ''}`}
                    onClick={() => setRealtimeProof(prev => !prev)}
                  >
                    {realtimeProof ? 'ON' : 'OFF'}
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
                                  setInput(prev => prev ? `${prev}\n${parts.join('\n')}` : parts.join('\n'));
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
                                setContextMenu({ visible: true, x: e.clientX, y: e.clientY, msgId: null, recContent: msg.content, copyContent: msg.content });
                              }}
                              title="우클릭 → 적용 / 복사"
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
                          <div
                            className="author-msg author-msg--ai"
                            onContextMenu={e => {
                              e.preventDefault();
                              setContextMenu({ visible: true, x: e.clientX, y: e.clientY, msgId: null, recContent: null, copyContent: msg.content });
                            }}
                          >{msg.content}</div>
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
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSendAuthorMessage(); }
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
            ) : panelView === 'proof' ? (
              /* ✏️ 교정 뷰 (메모와 분리된 독립 탭) */
              <div className="memo-view">
                <div className="memo-view__header">
                  <span>{storyAuthor.displayName}의 교정</span>
                  <button className="memo-view__back" onClick={() => setPanelView('author')}>← 돌아가기</button>
                </div>
                <div className="memo-view__list">
                  {corrections.length === 0 && (
                    <p className="author-chat__empty">맞춤법 오류가 없습니다 ✨<br />대화하면 작가가 봐줍니다</p>
                  )}
                  {corrections.map(c => (
                    <div key={c.id} className="memo-proof__card">
                      {c.memo && <p className="memo-proof__memo">“{c.memo}”</p>}
                      <ul className="memo-proof__list">
                        {c.errors.map((e, i) => (
                          <li key={i} className={`memo-proof__err${e.frequent ? ' memo-proof__err--frequent' : ''}`}>
                            <span className="memo-proof__wrong">{e.original}</span>
                            <span className="memo-proof__arrow">→</span>
                            <span className="memo-proof__right">{e.corrected}</span>
                            <span className="memo-proof__type">{e.type}</span>
                            {e.frequent && <span className="memo-proof__freq">자주 틀림 {e.count}회</span>}
                          </li>
                        ))}
                      </ul>
                      <button
                        className="memo-proof__dismiss"
                        onClick={() => setCorrections(prev => prev.filter(x => x.id !== c.id))}
                      >넘기기</button>
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
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleAddMemo(); }
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
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleAddMemo(); }
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
          {contextMenu.recContent ? (
            <>
              <button className="context-menu__item" onClick={() => {
                setInput(contextMenu.recContent);
                setContextMenu(m => ({ ...m, visible: false }));
              }}>
                적용하기
              </button>
              <button className="context-menu__item" onClick={() => {
                navigator.clipboard.writeText(contextMenu.recContent);
                setContextMenu(m => ({ ...m, visible: false }));
              }}>
                복사
              </button>
            </>
          ) : contextMenu.copyContent ? (
            <button className="context-menu__item" onClick={() => {
              navigator.clipboard.writeText(contextMenu.copyContent);
              setContextMenu(m => ({ ...m, visible: false }));
            }}>
              복사
            </button>
          ) : (
            <>
              <button className="context-menu__item" onClick={() => handleMemoFromContext(contextMenu.msgId)}>
                메모
              </button>
              <button
                className="context-menu__item context-menu__item--danger"
                onClick={() => handleDeleteMsg(contextMenu.msgId)}
              >
                삭제
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
