/* src/pages/intro/intro.jsx */
import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../../index.css';
import './intro.css';
import { ExitIcon, ChevronRight } from '../../components/icons';
import { getAuthor } from '../../lib/authorsApi';
import { useAuthorTheme, resolveAuthorId } from '../../hooks/useAuthorTheme';
import { applyGlobalVideoVolume, VIDEO_VOLUME_EVENT } from '../../lib/videoVolume';

function Intro() {
    const location = useLocation();
    const navigate = useNavigate();

    const authorId = resolveAuthorId(location.state?.authorId);
    useAuthorTheme(authorId);
    const [selectedAuthor, setSelectedAuthor] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const authorData = await getAuthor(authorId);
                setSelectedAuthor(authorData);

            } catch (error) {
                console.error("Error fetching data:", error);
                alert("작가 정보를 불러오지 못했습니다.");
                navigate('/');
            } finally {
                setIsLoading(false);
            }
        };

        if (authorId) {
            fetchData();
        }
    }, [authorId, navigate]);

    const videoRef = useRef(null);
    /* 비디오 볼륨 설정 */
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        applyGlobalVideoVolume(video);

        const handleVolumeChange = () => {
            applyGlobalVideoVolume(video);
        };

        window.addEventListener(VIDEO_VOLUME_EVENT, handleVolumeChange);

        return () => {
            window.removeEventListener(VIDEO_VOLUME_EVENT, handleVolumeChange);
        };
    }, [selectedAuthor?.video]);

    const handleCancel = () => {
        navigate('/');
    };

    const handleSelect = () => {
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

                {/* 작가 영상 */}
                <main className="intro-content">
                    {/* 작가 동영상 화면 채우기 */}
                    <div className="large-video-container">
                        {selectedAuthor?.video ? (
                            <video
                                ref={videoRef}
                                src={selectedAuthor.video}
                                className="large-video"
                                autoPlay
                                loop
                                playsInline
                            />
                        ) : (
                            <div className="no-video-placeholder">
                                <img src={selectedAuthor?.image} alt={selectedAuthor?.name} className="placeholder-img" />
                                <p>동영상을 준비 중입니다.</p>
                            </div>
                        )}
                    </div>

                    {/* <p className="intro-quote">{selectedAuthor?.quote}</p> */}


                    {/* 버튼 영역 */}
                    <div className="action-buttons">
                        <button className="btn-cancel" onClick={handleCancel}>
                            <ExitIcon /> 취소
                        </button>
                        <button className="btn-submit" onClick={handleSelect}>
                            선택 <ChevronRight />
                        </button>
                    </div>
                </main>
            </div>
        </div>
    );
}

export default Intro;