import { useEffect, useRef } from 'react';
import './DeveloperCredit.css';

// 개발자 이름 (요청 순서)
const DEVS = ['지윤정', '박가은', '윤가연', '유건혁', '김동완'];

// 가사 — 빈 문자열은 연(stanza) 사이 간격
const LYRICS = [
    '김새는 일이나 예기치 못한 난관 속에서도 흔들림 없이 시작했던 우리 팀플',
    '동고동락하며 서로에게 힘이 되어준 시간들이 스쳐 지나갑니다.',
    '완벽하지 않아도 서로의 부족함을 채워가며 완성해 낸 결과물과',
    '',
    '박수받아 마땅한 우리 모두의 노력은 정말 빛이 났어요.',
    '가슴 졸이고 고민하던 수많은 밤들이 있었지만,',
    '은은하게 빛나는 서로의 재능과 배려 덕분에 이겨낼 수 있었습니다.',
    '',
    '지치고 힘들 때마다 든든한 버팀목이 되어준 팀원분들,',
    '윤기 나는 아이디어로 프로젝트를 가득 채워준 순간들 모두',
    '정말 잊지 못할 소중한 추억이자 자산이 될 것입니다.',
    '',
    '윤곽이 잡히지 않던 막막한 시작점부터 마침내 마침표를 찍기까지,',
    '가장 가까운 곳에서 서로를 믿고 지지해 주었기에',
    '연속되는 어려운 과제 속에서도 우리는 결국 해낼 수 있었습니다.',
    '',
    '정성을 다해 한 걸음 한 걸음 함께 걸어와 준',
    '말로 다 표현하지 못할 만큼 고마운 우리 팀원분들,',
    '',
    '고단했던 모든 과정이 우리를 한 단계 더 성장시켰으리라 믿습니다.',
    '생각지도 못한 좋은 인연을 만나 함께 몰입할 수 있어 행복했고,',
    '했던 모든 경험들이 앞으로의 길에 큰 힘이 되기를 바랍니다.',
    '어디서든 늘 빛나기를, 그동안 정말 고생 많았어',
];

export default function DeveloperCredit({ onClose }) {
    const audioRef = useRef(null);
    const scrollRef = useRef(null);

    useEffect(() => {
        // 노래 BGM 재생 (버튼 클릭 제스처 컨텍스트라 자동재생 허용)
        const audio = audioRef.current;
        if (audio) {
            audio.volume = 0.65;
            audio.play().catch(() => { /* 자동재생 막히면 조용히 무시 */ });
        }

        // 크레딧 롤 — 사진→이름→가사 순으로 천천히 자동 스크롤(아래로)
        let raf;
        let last = null;
        let userScrolling = false;
        const el = scrollRef.current;
        const onWheel = () => { userScrolling = true; };
        el?.addEventListener('wheel', onWheel, { passive: true });
        el?.addEventListener('touchstart', onWheel, { passive: true });

        const tick = (now) => {
            if (last == null) last = now;
            const dt = now - last;
            last = now;
            if (el && !userScrolling) {
                const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
                if (!atBottom) el.scrollTop += dt * 0.028;   // ≈ 28px/s 천천히
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('keydown', onKey);
            el?.removeEventListener('wheel', onWheel);
            el?.removeEventListener('touchstart', onWheel);
            if (audio) { audio.pause(); audio.currentTime = 0; }
        };
    }, [onClose]);

    return (
        <div className="credit-overlay" role="dialog" aria-label="개발자 크레딧">
            <button className="credit-close" onClick={onClose} title="닫기 (Esc)">✕</button>

            <div className="credit-scroll" ref={scrollRef}>
                <div className="credit-inner">
                    {/* 1) 사진 */}
                    <img className="credit-photo" src="/developer_credit/credit.png" alt="NodeVelture 1팀" />

                    {/* 사진 아래 개발자 이름 */}
                    <div className="credit-title">NodeVelture · 1팀</div>
                    <div className="credit-names">
                        {DEVS.map((n, i) => (
                            <span key={n}>
                                {i > 0 && <span className="credit-sep">|</span>}
                                {n}
                            </span>
                        ))}
                    </div>

                    {/* 2) 가사 */}
                    <div className="credit-lyrics">
                        {LYRICS.map((line, i) => (
                            line ? <p key={i}>{line}</p> : <div key={i} className="credit-gap" />
                        ))}
                    </div>

                    <div className="credit-fin">— 고생 많았습니다 —</div>
                </div>
            </div>

            <audio ref={audioRef} src="/developer_credit/credit.mp3" preload="auto" />
        </div>
    );
}
