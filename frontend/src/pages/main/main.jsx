/* src/pages/main/main.jsx */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import logoImg from '../../assets/logo.png';
import author1Img from '../../assets/author/author1.png';
import author2Img from '../../assets/author/author2.png';
import author3Img from '../../assets/author/author3.png';
import author4Img from '../../assets/author/author4.png';
import '../../index.css';
import './main.css';
import { ExitIcon } from '../../components/icons';

function Main() {
    const navigate = useNavigate();
    const authors = [
        {
            id: 1,
            name: "백야 (白夜)",
            genre: "호러 / 미스터리",
            quote: '"공포는 보여주는 게 아니라 안 보여주는 것이다"',
            image: author1Img
        },
        {
            id: 2,
            name: "차로운",
            genre: "본격 추리",
            quote: '"독자는 항상 작가보다 영리하다고 가정해라"',
            image: author2Img
        },
        {
            id: 3,
            name: "한여름",
            genre: "로맨스",
            quote: '"심장이 두근거려야 페이지를 넘긴다"',
            image: author3Img
        },
        {
            id: 4,
            name: "김도현",
            genre: "일상 / 에세이",
            quote: '"특별한 하루보다 평범한 순간이 더 문학적이다"',
            image: author4Img
        }
    ];
    return (
        <div className="app-container">
            <div className="app-wrapper">
                {/* 상단 헤더 */}
                <header className="header">
                    <img
                        src={logoImg}
                        alt="Soseorieo Logo"
                        className="header-image"
                    />
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
                        {authors.map((author, index) => (
                            <div
                                key={author.id}
                                className={`card`}
                            >
                                {/* 작가 아바타 이미지 */}
                                <div className="avatar-wrapper">
                                    <img
                                        src={author.image}
                                        alt={author.name}
                                        className="card-avatar-image"
                                    />
                                </div>

                                {/* 본문 텍스트 정보 */}
                                <div className="card-content">
                                    <h4 className="card-title">{author.name}</h4>
                                    <span className="card-genre">{author.genre}</span>
                                    <p className="card-quote">{author.quote}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* 하단 네비게이션 버튼 영역 */}
                <div className="speech-text">
                    <span>작가를 선택하세요</span>
                </div>
            </div>
        </div>
    );
}

export default Main;