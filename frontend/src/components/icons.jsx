// src/components/icons.jsx
import React from 'react';

// 로그아웃 아이콘
export const ExitIcon = ({ size = 24, color = "#FFFFFF", className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}    >
        <path d="M13 4H7C5.89543 4 5 4.89543 5 6V18C5 19.1046 5.89543 20 7 20H13" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <path d="M10 12H21M21 12L17 8M21 12L17 16" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);