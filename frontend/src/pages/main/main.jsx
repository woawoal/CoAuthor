/* src/pages/main/main.jsx */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../index.css';
import './main.css';
import { ExitIcon } from '../../components/icons';
import { getAuthors } from '../../lib/authorsApi';
import { authClient, syncCurrentUser } from '../../lib/auth';

const FALLBACK_AUTHORS = [
    { id: 1, name: "백야 (白夜)", genre: "호러 / 미스터리", quote: "공포는 보여주는 게 아니라 안 보여주는 것이다", image: "/assets/author1/author1.png", video: "/assets/author1/author1.mp4" },
    { id: 2, name: "차로운", genre: "본격 추리", quote: "독자는 항상 작가보다 영리하다고 가정해라", image: "/assets/author2/author2.png", video: "/assets/author2/author2.mp4" },
    { id: 3, name: "한여름", genre: "로맨스", quote: "심장이 두근거려야 페이지를 넘긴다", image: "/assets/author3/author3.png", video: "/assets/author3/author3.mp4" },
    { id: 4, name: "김도현", genre: "일상 / 에세이", quote: "특별한 하루보다 평범한 순간이 더 문학적이다", image: "/assets/author4/author4.png", video: "/assets/author4/author4.mp4" },
];

function HoverVideo({ src }) {
    const videoRef = useRef(null);
    const timeoutRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        video.muted = false;

        video.play().catch(err => {
            if (err.name === 'AbortError') return;
            video.muted = true;
            video.play().catch(e => { if (e.name !== 'AbortError') console.log("음소거 재생도 실패:", e); });
        });

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const handleVideoEnded = () => {
        const video = videoRef.current;
        if (!video) return;

        timeoutRef.current = setTimeout(() => {
            if (video) {
                video.currentTime = 0;
                video.play().catch(e => console.log("재시작 실패:", e));
            }
        }, 1000);
    };

    return (
        <video
            ref={videoRef}
            src={src}
            className="card-avatar-video"
            autoPlay
            playsInline
            preload="auto"
            onEnded={handleVideoEnded}
            onError={() => { }}
            onCanPlay={() => { }}
        />
    );
}


function VoicePopup({ onClose, onGo }) {
    return (
        <div className="popup-overlay" onClick={onClose}>
            <div className="popup-card" onClick={e => e.stopPropagation()}>
                <p className="popup-emoji">✨</p>
                <h2 className="popup-title">더 실감나는 장면을 위해</h2>
                <p className="popup-desc">
                    나만의 문체를 설정하면 소설 속 대사를
                    <br />내 말투에 맞게 추천받을 수 있어요.
                </p>
                <div className="popup-actions">
                    <button className="popup-btn-secondary" onClick={onClose}>나중에</button>
                    <button className="popup-btn-primary" onClick={onGo}>말투 설정하러 가기</button>
                </div>
            </div>
        </div>
    );
}

function Main() {
    const navigate = useNavigate();
    const [hoveredAuthorId, setHoveredAuthorId] = useState(null);
    const [authors, setAuthors] = useState([]);
    const [userId, setUserId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showVoicePopup, setShowVoicePopup] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isDraggingPanel, setIsDraggingPanel] = useState(false);
    const panelRef = useRef(null);

    useEffect(() => {
        const checkLogin = async () => {
            const session = await authClient.getSession();
            const authUserId = session.data?.user?.id || null;

            setUserId(authUserId);

            if (authUserId) {
                try {
                    const user = await syncCurrentUser();
                    setIsAdmin(user.is_admin);
                    console.log("로그인됨");
                } catch (error) {
                    console.error(error);
                }

                const popupKey = `voice_popup_seen_${authUserId}`;
                if (!localStorage.getItem(popupKey)) {
                    setShowVoicePopup(true);
                }
            }
        };

        checkLogin();
    }, []);

    const handleClosePopup = () => {
        setShowVoicePopup(false);
        if (userId) {
            localStorage.setItem(`voice_popup_seen_${userId}`, '1');
        }
    };

    const handleGoVoice = () => {
        handleClosePopup();
        navigate('/voice-profile');
    };

    const handleLogout = async () => {
        await authClient.signOut();
        setUserId(null);
        setIsAdmin(false);
        navigate('/');
    };

    useEffect(() => {
        const fetchAuthorsData = async () => {
            try {
                const data = await getAuthors();
                setAuthors(data.authors || data);
                console.log("작가 목록 로딩 성공:", data);
            } catch (error) {
                console.warn("작가 목록 API 실패, 기본 데이터 사용:", error);
                setAuthors(FALLBACK_AUTHORS);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAuthorsData();
    }, []);

    const handleMouseMove = (e) => {
        const nextWidth = Math.min(
            1440,
            Math.max(0, window.innerWidth - e.clientX)
        );

        if (panelRef.current) {
            panelRef.current.style.flexBasis = `${nextWidth}px`;
        }
    };

    const handleMouseUp = () => {
        setIsDraggingPanel(false);
    };

    const handlePanelDragStart = (e) => {
        e.preventDefault();
        setIsDraggingPanel(true);
    };

    useEffect(() => {
        if (!isDraggingPanel) return;

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingPanel]);

    // 작가 카드 마우스 호버 시 실행되는 함수
    const handleAuthorHover = (authorId) => {
        const themeKey = `author${authorId}`;
        localStorage.setItem('selectedTheme', themeKey);
        document.documentElement.setAttribute('data-author', themeKey);
    };

    const handleAuthorSelect = (authorId) => {
        if (!userId) {
            alert('로그인 후 이용 가능합니다.');
            navigate('/login');
            return;
        }

        handleAuthorHover(authorId);
        navigate('/intro', { state: { authorId } });
    };

    if (isLoading) {
        return (
            <div className="app-container">
                <div className="app-wrapper flex-center">
                    <p style={{ color: 'white' }}>작가 목록을 불러오는 중입니다...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            {showVoicePopup && (
                <VoicePopup onClose={handleClosePopup} onGo={handleGoVoice} />
            )}
            <div className="app-wrapper">
                {/* 상단 헤더 */}
                <header className="header">
                    <img src="/assets/logo.png" alt="NodeVelture Logo" className="header-image" />
                    <h1 className="logo">NodeVelture</h1>
                </header>

                {/* 메인 타이틀 영역 */}
                <div className="title-area">
                    <h2 className="main-heading">어떤 <span className="highlight">작가</span>와 함께 쓸까요?</h2>
                    <p className="desc-text">장르와 철학이 다른 네 명의 작가 중 한 명을 선택하세요</p>
                </div>

                {/* 작가 */}
                <section className="author-section">
                    <div className="grid">
                        {authors.map((author) => (
                            <div
                                key={author.id}
                                className="card"
                                onClick={() => handleAuthorSelect(author.id)}
                                onMouseEnter={() => handleAuthorHover(author.id)}
                            >
                                {/* 작가 아바타 */}
                                <div className="avatar-wrapper">
                                    <img
                                        src={author.image}
                                        alt={author.name}
                                        className="card-avatar-image"
                                    />
                                </div>

                                {/* 본문 텍스트 정보 */}
                                <div className="card-content">
                                    <span className="card-title">{author.name}</span>
                                    <span className="card-genre">{author.genre}</span>
                                    <p className="card-quote">{author.quote}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

            </div>

            <div
                className="panel-resize-handle"
                onMouseDown={handlePanelDragStart}
            >
                <span className="panel-resize-icon">⋮</span>
            </div>

            <div
                ref={panelRef}
                className="author-panel-slide"
            >
                <div className="author-panel">
                    <button
                        className="btn"
                        onClick={() => {
                            if (!userId) {
                                alert('로그인 후 이용 가능합니다.');
                                navigate('/login');
                                return;
                            }

                            navigate('/mypage');
                        }}>
                        내 서재
                    </button>
                    <button
                        className="btn"
                        onClick={() => {
                            if (!userId) {
                                alert('로그인 후 이용 가능합니다.');
                                navigate('/login');
                                return;
                            }

                            navigate('/storylist');
                        }}
                    >
                        내 소설 목록
                    </button>
                    {isAdmin && (
                        <button
                            className="btn"
                            onClick={() => navigate('/tokendashboard')}
                        >
                            토큰 대시보드
                        </button>
                    )}
                    {userId ? (
                        <button className="btn main-logout-btn" onClick={handleLogout}>
                            로그아웃
                        </button>
                    ) : (
                        <button className="btn main-logout-btn" onClick={() => navigate('/login')}>
                            로그인
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Main;