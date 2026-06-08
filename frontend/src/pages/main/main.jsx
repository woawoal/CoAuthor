/* src/pages/main/main.jsx */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../index.css';
import './main.css';
import { ExitIcon } from '../../components/icons';
import { getAuthors } from '../../lib/authorsApi';

const FALLBACK_AUTHORS = [
    { id: 1, name: "백야 (白夜)", genre: "호러 / 미스터리", quote: "공포는 보여주는 게 아니라 안 보여주는 것이다", image: "/assets/author1/author1.png", video: "/assets/author1/author1.mp4" },
    { id: 2, name: "차로운",      genre: "본격 추리",       quote: "독자는 항상 작가보다 영리하다고 가정해라",       image: "/assets/author2/author2.png", video: "/assets/author2/author2.mp4" },
    { id: 3, name: "한여름",      genre: "로맨스",          quote: "심장이 두근거려야 페이지를 넘긴다",              image: "/assets/author3/author3.png", video: "/assets/author3/author3.mp4" },
    { id: 4, name: "김도현",      genre: "일상 / 에세이",   quote: "특별한 하루보다 평범한 순간이 더 문학적이다",    image: "/assets/author4/author4.png", video: "/assets/author4/author4.mp4" },
];

// 비디오가 마운트될 때 명시적으로 play()를 호출해주는 커스텀 컴포넌트
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

        // 컴포넌트가 언마운트(마우스를 치웠을 때)되면 실행 중인 타이머를 취소
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    // 영상이 끝났을 때 실행될 핸들러
    const handleVideoEnded = () => {
        const video = videoRef.current;
        if (!video) return;

        // 1000ms(1초) 딜레이 후 다시 재생하도록 예약하고, ID를 timeoutRef에 저장
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
            onError={(e) => {
                // console.log("video error", e);
            }}
            onCanPlay={() => {
                // console.log("can play");
            }}
        />
    );
}

function Main() {
    const navigate = useNavigate();
    const [hoveredAuthorId, setHoveredAuthorId] = useState(null);

    const [authors, setAuthors] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

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

    // 작가 카드 클릭 시 실행될 핸들러 함수
    const handleAuthorSelect = (authorId) => {
        navigate('/worldview', { state: { authorId } });
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
                    <div className={`grid ${hoveredAuthorId ? 'is-hovering' : ''}`}>
                        {authors.map((author) => {
                            const isHovered = hoveredAuthorId === author.id;
                            const hasVideo = !!author.video;

                            return (
                                <div
                                    key={author.id}
                                    className={`card ${isHovered ? 'is-expanded' : ''}`}
                                    onClick={() => handleAuthorSelect(author.id)}
                                    onMouseEnter={() => setHoveredAuthorId(author.id)}
                                    onMouseLeave={() => setHoveredAuthorId(null)}
                                >
                                    {/* 작가 아바타 */}
                                    <div className="avatar-wrapper">
                                        {isHovered && hasVideo ? (
                                            <>
                                                <HoverVideo src={author.video} />
                                            </>
                                        ) : (
                                            <img
                                                src={author.image}
                                                alt={author.name}
                                                className="card-avatar-image"
                                            />
                                        )}
                                    </div>

                                    {/* 본문 텍스트 정보 */}
                                    <div className="card-content">
                                        <h4 className="card-title">{author.name}</h4>
                                        <span className="card-genre">{author.genre}</span>
                                        <p className="card-quote">{author.quote}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* 하단 네비게이션 버튼 영역 */}
                <div className="bottom-nav">
                    <div className="speech-text">
                        <span>작가를 선택하세요</span>
                    </div>
                    <button className="chatlist-btn" onClick={() => navigate('/chatlist')}>
                        내 소설 목록 →
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Main;