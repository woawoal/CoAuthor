/* src/pages/worldview/worldview.jsx */
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../../index.css';
import './worldview.css';
import { WriteIcon, ExitIcon } from '../../components/icons';
import { createWorldview } from '../../lib/worldviewApi';
import { getAuthors } from '../../lib/authorsApi';

function Worldview() {
    const location = useLocation();
    const navigate = useNavigate();

    const authorId = location.state?.authorId;

    // 1. 세계관(worlds) 테이블 관련 상태
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [genre, setGenre] = useState('');
    const [setting, setSetting] = useState('');
    const [rules, setRules] = useState('');

    // 2. 등장인물(characters) 테이블 스키마에 맞춘 초기 구조 정의
    const createNewCharacter = () => ({
        id: Date.now() + Math.random(), // 임시 고유 키
        name: '',
        role: 'supporting', // 기본값 조연        
        personality: '',
        system_prompt: ''
    });

    const [characters, setCharacters] = useState([createNewCharacter()]);
    const [serverAuthors, setServerAuthors] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchAuthorsData = async () => {
            try {
                const data = await getAuthors();
                setServerAuthors(data);
            } catch (error) {
                console.error("Error fetching authors:", error);
                alert("작가 정보를 불러오지 못했습니다.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchAuthorsData();
    }, []);

    const selectedAuthor = serverAuthors.find((author) => String(author.id) === String(authorId));

    useEffect(() => {
        if (selectedAuthor && !genre) {
            setGenre(selectedAuthor.genre);
        }
    }, [selectedAuthor, genre]);

    if (isLoading) {
        return (
            <div className="app-container">
                <div className="app-wrapper flex-center">
                    <p style={{ color: 'white' }}>작가 목록을 불러오는 중입니다...</p>
                </div>
            </div>
        );
    }

    if (!authorId) {
        return (
            <div className="error-container">
                <p>선택된 작가가 없습니다. 메인 페이지로 돌아갑니다.</p>
                <button onClick={() => navigate('/')}>메인으로 가기</button>
            </div>
        );
    }

    // 등장인물 핸들러
    const handleAddCharacter = () => {
        setCharacters([...characters, createNewCharacter()]);
    };

    const handleRemoveCharacter = (id) => {
        if (characters.length > 1) {
            setCharacters(characters.filter(char => char.id !== id));
        }
    };

    const handleCharacterChange = (id, field, value) => {
        setCharacters(characters.map(char =>
            char.id === id ? { ...char, [field]: value } : char
        ));
    };

    const handleSave = async () => {
        if (!title.trim()) {
            alert("세계관 제목을 입력해 주세요!");
            return;
        }
        setSaving(true);
        try {
            const worldId = await createWorldview({
                world: { title, description, genre, setting, rules },
                characters: characters.map(({ id, ...charData }) => charData),
            });
            navigate('/chat', { state: { worldId, authorId } });
        } catch (err) {
            alert(`저장 실패: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        if (window.confirm("작성 중인 내용이 저장되지 않습니다. 뒤로 가시겠습니까?")) {
            navigate(-1);
        }
    };

    return (
        <div className="app-container">
            <div className="app-wrapper">
                <header className="header">
                    <img src="/assets/logo.png" alt="NodeVelture Logo" className="header-image" />
                    <h1 className="logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
                        NodeVelture
                    </h1>
                </header>

                {selectedAuthor && (
                    <div className="selected-author-banner">
                        <img src={selectedAuthor.image} alt={selectedAuthor.name} className="banner-avatar" />
                        <div className="banner-info">
                            <span className="banner-genre">{selectedAuthor.genre}</span>
                            <h3 className="banner-name">{selectedAuthor.name} 작가와 세계관 설계</h3>
                        </div>
                    </div>
                )}

                <div className="worldview-content">

                    {/* [WORLDS] 제목 및 장르 */}
                    <div className="form-row">
                        <div className="form-group flex-3">
                            <label className="form-label">세계관 제목</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="예: 무림외전, 네오 서울 2026"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                            />
                        </div>
                        <div className="form-group flex-1">
                            <label className="form-label">장르</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="예: 호러 / 미스터리"
                                value={genre}
                                readOnly
                            />
                        </div>
                    </div>

                    {/* [WORLDS] 설명 */}
                    <div className="form-group">
                        <label className="form-label">세계관 요약 설명 (Description)</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="이 세계관을 관통하는 요약 한 줄을 적어주세요."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    {/* [WORLDS] 배경 */}
                    <div className="form-group">
                        <label className="form-label">시대 및 공간 배경 (Setting)</label>
                        <textarea
                            className="form-textarea"
                            placeholder="가상의 역사, 지리적 특징 등을 상세히 적어주세요."
                            value={setting}
                            onChange={(e) => setSetting(e.target.value)}
                        />
                    </div>

                    {/* [WORLDS] 규칙 */}
                    <div className="form-group">
                        <label className="form-label">세계관 특별 규칙 (Rules)</label>
                        <textarea
                            className="form-textarea height-sm"
                            placeholder="개념, 마법 법칙, 사회적 제약 사항 (예: 연금술의 등가교환 법칙)"
                            value={rules}
                            onChange={(e) => setRules(e.target.value)}
                        />
                    </div>

                    {/* 등장인물 섹션 */}
                    <div className="form-group">
                        <div className="label-header">
                            <label className="form-label">등장인물 설정 (Characters)</label>
                            <button type="button" className="btn-add" onClick={handleAddCharacter}>+ 캐릭터 추가</button>
                        </div>

                        <div className="character-card-list">
                            {characters.map((char, index) => (
                                <div key={char.id} className="character-card">
                                    <div className="char-card-header">
                                        <span className="char-index"># {index + 1}번째 인물</span>
                                        <button
                                            type="button"
                                            className="btn-card-remove"
                                            onClick={() => handleRemoveCharacter(char.id)}
                                            disabled={characters.length === 1}
                                        >
                                            삭제
                                        </button>
                                    </div>

                                    {/* 이름 / 역할 / AI 제어 여부 */}
                                    <div className="form-row align-end">
                                        <div className="form-group flex-3">
                                            <label className="char-sub-label">이름</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="캐릭터 이름"
                                                value={char.name}
                                                onChange={(e) => handleCharacterChange(char.id, 'name', e.target.value)}
                                            />
                                        </div>

                                        <div className="form-group flex-3">
                                            <label className="char-sub-label">역할</label>
                                            <div className="char-role-ai-inline">
                                                <select
                                                    className="form-select"
                                                    value={char.role}
                                                    onChange={(e) => handleCharacterChange(char.id, 'role', e.target.value)}
                                                >
                                                    <option value="protagonist">주인공 (protagonist)</option>
                                                    <option value="supporting">조연 (supporting)</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 성격 / 외모 / 배경스토리 */}
                                    <div className="form-row">
                                        <div className="form-group flex-1">
                                            <label className="char-sub-label">성격 (Personality)</label>
                                            <textarea
                                                className="form-textarea height-xs"
                                                placeholder="예: 냉철함, 츤데레"
                                                value={char.personality}
                                                onChange={(e) => handleCharacterChange(char.id, 'personality', e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="char-sub-label">AI 캐릭터 지시문 (System Prompt)</label>
                                        <textarea
                                            className="form-textarea height-xs"
                                            placeholder="AI가 이 역할을 연기할 때 지켜야 할 어조나 규칙"
                                            value={char.system_prompt}
                                            onChange={(e) => handleCharacterChange(char.id, 'system_prompt', e.target.value)}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="action-buttons">
                        <button type="button" className="btn-save" onClick={handleSave} disabled={saving}>
                            <WriteIcon /> {saving ? '저장 중...' : '세계관 생성'}
                        </button>
                        <button type="button" className="btn-cancel" onClick={handleCancel}>
                            <ExitIcon /> 취소하기
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}

export default Worldview;