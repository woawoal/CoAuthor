/* src/pages/worldview/worldview.jsx */
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import logoImg from '../../assets/logo.png';
import author1Img from '../../assets/author/author1.png';
import author2Img from '../../assets/author/author2.png';
import author3Img from '../../assets/author/author3.png';
import author4Img from '../../assets/author/author4.png';
import '../../index.css';
import './worldview.css';
import { WriteIcon, ExitIcon } from '../../components/icons';

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

    if (!authorId) {
        return (
            <div className="error-container">
                <p>선택된 작가가 없습니다. 메인 페이지로 돌아갑니다.</p>
                <button onClick={() => navigate('/')}>메인으로 가기</button>
            </div>
        );
    }

    const authors = [
        { id: 1, name: "백야 (白夜)", genre: "호러 / 미스터리", quote: '"공포는 보여주는 게 아니라 안 보여주는 것이다"', image: author1Img },
        { id: 2, name: "차로운", genre: "본격 추리", quote: '"독자는 항상 작가보다 영리하다고 가정해라"', image: author2Img },
        { id: 3, name: "한여름", genre: "로맨스", quote: '"심장이 두근거려야 페이지를 넘긴다"', image: author3Img },
        { id: 4, name: "김도현", genre: "일상 / 에세이", quote: '"특별한 하루보다 평범한 순간이 더 문학적이다"', image: author4Img }
    ];

    const selectedAuthor = authors.find((author) => author.id === authorId);

    useEffect(() => {
        if (selectedAuthor && !genre) {
            setGenre(selectedAuthor.genre);
        }
    }, [selectedAuthor]);

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

    // 저장 처리
    const handleSave = () => {
        if (!title.trim()) {
            alert("세계관 제목을 입력해 주세요!");
            return;
        }

        // DB에 그대로 들어갈 최종 데이터 포맷 구조화
        const payload = {
            world: {
                title,
                description,
                genre,
                setting,
                rules
            },
            // characters 테이블 레코드 배열 (임시 id는 전송 시 제외하거나 UUID 변환용으로 사용)
            characters: characters.map(({ id, ...charData }) => charData)
        };

        console.log("DB 전송 최종 Payload:", payload);
        alert(`[${title}] 세계관 및 ${characters.length}명의 등장인물 설정이 완료되었습니다!`);
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
                    <img src={logoImg} alt="NodeVelture Logo" className="header-image" />
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
                        <button type="button" className="btn-save" onClick={handleSave}>
                            <WriteIcon /> 세계관 생성
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