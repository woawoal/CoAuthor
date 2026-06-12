// src/lib/videoVolume.js
export const VIDEO_VOLUME_KEY = 'global_video_volume';
export const VIDEO_VOLUME_EVENT = 'video-volume-changed';

export const getGlobalVideoVolume = () => {
    const saved = localStorage.getItem(VIDEO_VOLUME_KEY);
    return saved !== null ? Number(saved) : 0.3;
};

export const setGlobalVideoVolume = (volume) => {
    localStorage.setItem(VIDEO_VOLUME_KEY, String(volume));
    window.dispatchEvent(new Event(VIDEO_VOLUME_EVENT));
};

export const applyGlobalVideoVolume = (video) => {
    if (!video) return;

    const volume = getGlobalVideoVolume();

    video.volume = volume;
    video.muted = volume === 0;
};