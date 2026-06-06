/* src/pages/worldview/worldview.jsx */
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../../index.css';
import './worldview.css';
import { WriteIcon, ExitIcon, ChevronRight } from '../../components/icons';
import { createWorldview } from '../../lib/worldviewApi';
import { getAuthors, getQuestions } from '../../lib/authorsApi';

function Worldview() {
    const location = useLocation();
    const navigate = useNavigate();

    const authorId = location.state?.authorId;

    const [currentStep, setCurrentStep] = useState(1);
    // 1. 세계관(worlds) 테이블 관련 상태
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [genre, setGenre] = useState('');
    const [setting, setSetting] = useState('');
    const [rules, setRules] = useState('');
    const [questions, setQuestions] = useState([]);

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
    const currentDialogue = questions.find((question) => question.step === currentStep);
    const selectedAuthor = serverAuthors.find((author) => String(author.id) === String(authorId));

    useEffect(() => {
        const fetchData = async () => {
            try {
                const authorsData = await getAuthors();
                setServerAuthors(authorsData);

                const questionsData = await getQuestions(authorId);

                setQuestions(
                    questionsData.dialogues || questionsData || []
                );
            } catch (error) {
                console.error("Error fetching authors:", error);
                alert("작가 정보를 불러오지 못했습니다.");
            } finally {
                setIsLoading(false);
            }
        };

        if (authorId) {
            fetchData();
        }
    }, [authorId]);

    useEffect(() => {
        if (selectedAuthor && !genre) {
            setGenre(selectedAuthor.genre);
        }
    }, [selectedAuthor, genre]);

    // 등장인물 핸들러
    const handleAddCharacter = () => {
        setCharacters((prev) => [...prev, createNewCharacter()]);
    };

    const handleRemoveCharacter = (id) => {
        if (characters.length > 1) {
            setCharacters((prev) => prev.filter((char) => char.id !== id));
        }
    };

    const handleCharacterChange = (id, field, value) => {
        setCharacters((prev) =>
            prev.map((char) =>
                char.id === id ? { ...char, [field]: value } : char
            )
        );
    };

    const validateCurrentStep = () => {
        if (currentStep === 2 && !title.trim()) {
            alert('세계관 제목을 입력해 주세요.');
            return false;
        }

        return true;
    };

    const handleNext = () => {
        if (!validateCurrentStep()) return;

        if (currentStep < questions.length) {
            setCurrentStep((prev) => prev + 1);
        }
    };

    const handlePrev = () => {
        if (currentStep > 1) {
            setCurrentStep((prev) => prev - 1);
        }
    };

    const handleSave = async () => {
        if (!title.trim()) {
            alert("세계관 제목을 입력해 주세요!");
            setCurrentStep(2);
            return;
        }

        const validCharacters = characters
            .filter((char) => char.name.trim())
            .map(({ id, ...charData }) => charData);

        setSaving(true);

        try {
            const worldId = await createWorldview({
                world: { title, description, genre, setting, rules },
                characters: validCharacters,
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

    const renderStepInput = () => {
        switch (currentDialogue?.field) {
            case 'intro':
                return (
                    <div className="form-row">
                        <div className="form-group flex-3">
                            <label className="form-label">안내</label>
                            <div className="intro-guide-box">
                                <p>작가와 대화하듯이 세계관을 하나씩 설정합니다.</p>
                                <p>준비되었다면 아래 버튼을 눌러 시작해주세요.</p>
                            </div>
                        </div>
                    </div>
                );

            case 'title':
                return (
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
                    </div>
                );

            case 'description':
                return (
                    <div className="form-group">
                        <label className="form-label">세계관 요약 설명</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="이 세계관을 관통하는 요약 한 줄을 적어주세요."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>
                );

            case 'setting':
                return (
                    <div className="form-group">
                        <label className="form-label">시대 및 공간 배경</label>
                        <textarea
                            className="form-textarea"
                            placeholder="가상의 역사, 지리적 특징, 시대 분위기 등을 적어주세요."
                            value={setting}
                            onChange={(e) => setSetting(e.target.value)}
                        />
                    </div>
                );

            case 'rules':
                return (
                    <div className="form-group">
                        <label className="form-label">세계관 특별 규칙</label>
                        <textarea
                            className="form-textarea height-sm"
                            placeholder="개념, 마법 법칙, 사회적 제약 사항 등을 적어주세요."
                            value={rules}
                            onChange={(e) => setRules(e.target.value)}
                        />
                    </div>
                );

            case 'characters':
                return (
                    <div className="form-group">
                        <div className="label-header">
                            <label className="form-label">등장인물 설정</label>
                            <button type="button" className="btn-add" onClick={handleAddCharacter}>
                                + 캐릭터 추가
                            </button>
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

                                    <div className="form-row align-end">
                                        <div className="form-group flex-2">
                                            <label className="char-sub-label">이름</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="캐릭터 이름"
                                                value={char.name}
                                                onChange={(e) =>
                                                    handleCharacterChange(char.id, 'name', e.target.value)
                                                }
                                            />
                                        </div>

                                        <div className="form-group flex-2">
                                            <label className="char-sub-label">성격</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                placeholder="예: 냉철함, 츤데레, 다정함"
                                                value={char.personality}
                                                onChange={(e) =>
                                                    handleCharacterChange(char.id, 'personality', e.target.value)
                                                }
                                            />
                                        </div>

                                        <div className="form-group flex-2">
                                            <label className="char-sub-label">역할</label>
                                            <select
                                                className="form-select"
                                                value={char.role}
                                                onChange={(e) =>
                                                    handleCharacterChange(char.id, 'role', e.target.value)
                                                }
                                            >
                                                <option value="protagonist">주인공</option>
                                                <option value="supporting">조연</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="char-sub-label">AI 캐릭터 지시문</label>
                                        <textarea
                                            className="form-textarea height-xs"
                                            placeholder="AI가 이 역할을 연기할 때 지켜야 할 어조나 규칙"
                                            value={char.system_prompt}
                                            onChange={(e) =>
                                                handleCharacterChange(char.id, 'system_prompt', e.target.value)
                                            }
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case 'confirm':
                return (
                    <div className="form-group">
                        <label className="form-label">세계관</label>
                        <div className="summary-box">
                            <p><strong>장르</strong> {genre || '-'}</p>
                            <p><strong>제목</strong> {title || '-'}</p>
                            <p><strong>요약</strong> {description || '-'}</p>
                            <p><strong>배경</strong> {setting || '-'}</p>
                            <p><strong>규칙</strong> {rules || '-'}</p>
                            <p><strong>등장인물</strong> {characters.filter((char) => char.name.trim()).length}명</p>
                        </div>
                    </div>
                );

            default:
                return null;
        }
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

    if (!authorId) {
        return (
            <div className="error-container">
                <p>선택된 작가가 없습니다. 메인 페이지로 돌아갑니다.</p>
                <button onClick={() => navigate('/')}>메인으로 가기</button>
            </div>
        );
    }

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
                    <div className="worldview-step-indicator">
                        {currentStep} / {questions.length}
                    </div>

                    <div className="worldview-chat-layout">
                        <div className="author-side">
                            <img
                                src={currentDialogue?.image || selectedAuthor?.image}
                                alt={selectedAuthor?.name || '작가'}
                                className="worldview-author-image"
                            />
                        </div>

                        <div className="input-side">
                            <div className="author-dialogue-box">
                                {currentDialogue?.text}
                            </div>

                            <div className="step-input-area">
                                {renderStepInput()}
                            </div>

                            <div className="action-buttons">
                                <button
                                    type="button"
                                    className="btn-cancel"
                                    onClick={currentStep === 1 ? handleCancel : handlePrev}
                                >
                                    <ExitIcon /> {currentStep === 1 ? '취소하기' : '이전'}
                                </button>

                                {currentDialogue?.field === 'confirm' ? (
                                    <button
                                        type="button"
                                        className="btn-save"
                                        onClick={handleSave}
                                        disabled={saving}
                                    >
                                        <WriteIcon /> {saving ? '저장 중...' : '세계관 생성'}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="btn-save"
                                        onClick={handleNext}
                                    >
                                        다음 <ChevronRight />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Worldview;