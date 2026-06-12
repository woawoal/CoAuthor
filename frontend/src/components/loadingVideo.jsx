// src/components/loadingVideo.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { getGlobalVideoVolume, setGlobalVideoVolume, applyGlobalVideoVolume } from '../lib/videoVolume';

const wrapStyle = {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.8)',
};

const videoBoxStyle = {
    position: 'relative',
    width: '80%',
    height: '80%',
    borderRadius: '24px',
    overflow: 'hidden',
};

const videoStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    borderRadius: '24px',
};

const volumeStyle = {
    position: 'absolute',
    right: '20px',
    bottom: '20px',
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: '999px',
    background: 'rgba(0, 0, 0, 0.45)',
    color: '#fff',
};

function LoadingVideo({ loading = true, minDuration = 3000, onFinish }) {
    const startTimeRef = useRef(Date.now());
    const videoRef = useRef(null);
    const [volume, setVolume] = useState(() => getGlobalVideoVolume());

    const videoSrc = useMemo(() => {
        const authorId = Math.floor(Math.random() * 4) + 1;
        return `/assets/author${authorId}/loading.mp4`;
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        setGlobalVideoVolume(volume);
        applyGlobalVideoVolume(video);
    }, [volume]);

    useEffect(() => {
        if (loading) return;

        const elapsed = Date.now() - startTimeRef.current;
        const remain = Math.max(0, minDuration - elapsed);

        const timer = setTimeout(() => {
            onFinish?.();
        }, remain);

        return () => clearTimeout(timer);
    }, [loading, minDuration, onFinish]);

    return (
        <div style={wrapStyle}>
            <div style={videoBoxStyle}>
                <video
                    ref={videoRef}
                    style={videoStyle}
                    src={videoSrc}
                    autoPlay
                    playsInline
                    preload="auto"
                />

                <div style={volumeStyle}>
                    <span>{volume === 0 ? '🔇' : '🔊'}</span>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                    />
                </div>
            </div>
        </div>
    );
}

export default LoadingVideo;