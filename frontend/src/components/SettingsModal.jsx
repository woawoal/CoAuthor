import { useState, useEffect } from 'react';
import { getGlobalVideoVolume, setGlobalVideoVolume } from '../lib/videoVolume';

// 환경설정 — BGM / 로딩 영상 소리 / 작가 리액션 음성 조절.
// BGM·로딩영상은 기존 컴포넌트가 듣는 이벤트로 라이브 반영, 리액션은 voice_reaction 키.
const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: 360, maxWidth: '100%', boxSizing: 'border-box',
    background: 'var(--card-main, #fff)', color: 'var(--text-main, #222)',
    borderRadius: 18, padding: 24, boxShadow: '0 12px 44px rgba(0,0,0,0.28)',
  },
  title: { margin: '0 0 6px', fontSize: 18, fontWeight: 800 },
  block: { padding: '14px 0', borderTop: '1px solid rgba(0,0,0,0.08)' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 14, fontWeight: 600 },
  range: {
    width: '100%', display: 'block', marginTop: 10, boxSizing: 'border-box',
    accentColor: 'var(--theme-color, #6b5bd2)',
  },
  toggle: (on) => ({
    border: 'none', borderRadius: 999, padding: '6px 0', cursor: 'pointer',
    fontSize: 12, fontWeight: 700, width: 64, flexShrink: 0, textAlign: 'center',
    background: on ? 'var(--theme-color, #6b5bd2)' : 'rgba(0,0,0,0.12)',
    color: on ? '#fff' : 'var(--text-sub, #888)',
  }),
  close: {
    width: '100%', marginTop: 18, border: 'none', borderRadius: 12, padding: '11px',
    background: 'var(--theme-color, #6b5bd2)', color: '#fff', cursor: 'pointer',
    fontWeight: 700, fontSize: 15, boxSizing: 'border-box',
  },
};

export default function SettingsModal({ open, onClose }) {
  const [bgmOn, setBgmOn] = useState(true);
  const [bgmVol, setBgmVol] = useState(0.2);
  const [videoVol, setVideoVol] = useState(0.3);
  const [reactionOn, setReactionOn] = useState(true);

  // 열릴 때 현재 저장값 로드
  useEffect(() => {
    if (!open) return;
    setBgmOn(localStorage.getItem('bgm_playing') !== 'false');
    setBgmVol(Number(localStorage.getItem('bgm_volume') ?? 0.2));
    setVideoVol(getGlobalVideoVolume());
    setReactionOn(localStorage.getItem('voice_reaction') !== 'off');
  }, [open]);

  if (!open) return null;

  const changeBgmOn = (v) => {
    setBgmOn(v);
    localStorage.setItem('bgm_playing', String(v));
    window.dispatchEvent(new Event('bgm-playing-changed'));
  };
  const changeBgmVol = (v) => {
    setBgmVol(v);
    localStorage.setItem('bgm_volume', String(v));
    window.dispatchEvent(new Event('bgm-volume-changed'));
  };
  const changeVideoVol = (v) => {
    setVideoVol(v);
    setGlobalVideoVolume(v);   // 내부에서 video-volume-changed 이벤트 발생
  };
  const changeReaction = (v) => {
    setReactionOn(v);
    localStorage.setItem('voice_reaction', v ? 'on' : 'off');
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.card} onClick={(e) => e.stopPropagation()}>
        <h3 style={S.title}>환경설정</h3>

        {/* 배경음악 */}
        <div style={S.block}>
          <div style={S.head}>
            <span style={S.label}>배경음악 (BGM)</span>
            <button style={S.toggle(bgmOn)} onClick={() => changeBgmOn(!bgmOn)}>{bgmOn ? 'ON' : 'OFF'}</button>
          </div>
          <input
            style={S.range} type="range" min="0" max="1" step="0.01"
            value={bgmVol} disabled={!bgmOn}
            onChange={(e) => changeBgmVol(Number(e.target.value))}
          />
        </div>

        {/* 로딩 영상 소리 */}
        <div style={S.block}>
          <div style={S.head}>
            <span style={S.label}>로딩 영상 소리</span>
            <button style={S.toggle(videoVol > 0)} onClick={() => changeVideoVol(videoVol > 0 ? 0 : 0.3)}>
              {videoVol > 0 ? 'ON' : '음소거'}
            </button>
          </div>
          <input
            style={S.range} type="range" min="0" max="1" step="0.01"
            value={videoVol}
            onChange={(e) => changeVideoVol(Number(e.target.value))}
          />
        </div>

        {/* 작가 리액션 음성 */}
        <div style={S.block}>
          <div style={S.head}>
            <span style={S.label}>작가 리액션 음성</span>
            <button style={S.toggle(reactionOn)} onClick={() => changeReaction(!reactionOn)}>{reactionOn ? 'ON' : 'OFF'}</button>
          </div>
        </div>

        <button style={S.close} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
