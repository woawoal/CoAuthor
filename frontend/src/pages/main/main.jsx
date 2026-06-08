/* src/pages/main/main.jsx */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../index.css';
import './main.css';
import { ExitIcon } from '../../components/icons';
import { getAuthors } from '../../lib/authorsApi';

function Main() {
    const navigate = useNavigate();
    const [authors, setAuthors] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchAuthorsData = async () => {
            try {
                const data = await getAuthors();
                setAuthors(data.authors || data);
                console.log("작가 목록 로딩 성공:", data);
            } catch (error) {
                console.error("작가 목록 로딩 실패:", error);
                alert("작가 목록을 불러오지 못했습니다.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchAuthorsData();
    }, []);

    // 작가 카드 마우스 호버 시 실행되는 함수
    const handleAuthorHover = (authorId) => {
        const themeKey = `author${authorId}`;
        localStorage.setItem('selectedTheme', themeKey);
        document.documentElement.setAttribute('data-author', themeKey);
    };

    // 작가 카드 클릭 시 실행될 핸들러 함수
    const handleAuthorSelect = (authorId) => {
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
                                    <div className="card-title">
                                        {author.name}
                                    </div>
                                    <span className="card-genre">{author.genre}</span>
                                    <p className="card-quote">{author.quote}</p>
                                </div>
                            </div>
                        ))}
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