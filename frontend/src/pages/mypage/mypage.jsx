import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authClient } from '../../lib/auth';
import {
    getProfile, getWorks, getRecent, getSentences, getWiki,
    deleteSentence, getAuthorRecords, getAchievements, getStats, getDashboard,
    getTasteProfile, setupTasteProfile,
} from '../../lib/mypageApi';
import TasteOnboarding from './TasteOnboarding';
import { getDailyLetter, determineSituation } from '../../lib/authorLetters';
import './mypage.css';

const WORK_GOAL_CHARS = 30000;

function formatRelativeTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    const hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, '0');
    const period = hh < 12 ? '오전' : '오후';
    const h12 = hh % 12 || 12;
    const timeStr = `${period} ${h12}:${mm}`;
    if (diffDays === 0) return `오늘 ${timeStr}`;
    if (diffDays === 1) return `어제 ${timeStr}`;
    return `${diffDays}일 전`;
}

const NAV = {
    library: [
        { id: '대시보드',     icon: '🏠' },
        { id: '최근 작업',    icon: '🕐' },
        { id: '취향 프로필',  icon: '✨' },
        { id: '설정집',       icon: '🗂️' },
        { id: '문장 보관함',  icon: '💾' },
        { id: 'AI 작가 기록', icon: '🤖' },
        { id: '내 작품',      icon: '📚' },
        { id: '업적',         icon: '🏆' },
    ],
    account: [
        { id: '환경설정', icon: '⚙️' },
        { id: '알림설정', icon: '🔔' },
    ],
};


function MyPage() {
    const navigate = useNavigate();
    const [userId, setUserId] = useState(null);
    const [userInfo, setUserInfo] = useState(null);
    const [active, setActive] = useState('대시보드');

    // 각 탭 데이터 (lazy)
    const [dashboard, setDashboard] = useState(null);
    const [profile, setProfile] = useState(null);
    const [works, setWorks] = useState(null);
    const [recent, setRecent] = useState(null);
    const [sentences, setSentences] = useState(null);
    const [authorRecords, setAuthorRecords] = useState(null);
    const [achievements, setAchievements] = useState(null);
    const [stats, setStats] = useState(null);

    // 취향 프로필
    const [tasteProfile, setTasteProfile] = useState(null);
    const [tasteWorks, setTasteWorks] = useState([]);
    const [showTasteOnboarding, setShowTasteOnboarding] = useState(false);

    // 설정집 선택 상태
    const [wikiWork, setWikiWork] = useState(null);
    const [wiki, setWiki] = useState(null);
    const [wikiTab, setWikiTab] = useState('세계관');

    const [loading, setLoading] = useState(true);

    // 초기 로딩: 유저 확인 + 프로필 + 작품 목록
    useEffect(() => {
        const init = async () => {
            const session = await authClient.getSession();
            const uid = session.data?.user?.id || null;
            if (!uid) { navigate('/login'); return; }
            setUserId(uid);
            setUserInfo(session.data?.user);
            try {
                const [profileData, worksData, dashboardData, statsData, tasteData] = await Promise.all([
                    getProfile(uid),
                    getWorks(uid),
                    getDashboard(uid),
                    getStats(uid),
                    getTasteProfile(uid),
                ]);
                setProfile(profileData);
                setWorks(worksData);
                setDashboard(dashboardData);
                setStats(statsData);
                setTasteProfile(tasteData.taste_profile ?? {});
                setTasteWorks(tasteData.selected_works ?? []);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        init();
    }, [navigate]);

    // 탭 전환 시 lazy fetch
    const handleNav = useCallback(async (tab) => {
        setActive(tab);
        if (!userId) return;
        try {
            if (tab === '최근 작업'    && !recent)        setRecent(await getRecent(userId));
            if (tab === '문장 보관함'  && !sentences)     setSentences(await getSentences(userId));
            if (tab === 'AI 작가 기록' && !authorRecords) setAuthorRecords(await getAuthorRecords(userId));
            if (tab === '업적'         && !achievements)  setAchievements(await getAchievements(userId));
        } catch (e) {
            console.error(e);
        }
    }, [userId, recent, sentences, authorRecords, achievements]);

    async function handleTasteComplete(selectedWorks) {
        try {
            const data = await setupTasteProfile(userId, selectedWorks);
            setTasteProfile(data.taste_profile ?? {});
            setTasteWorks(data.selected_works ?? []);
        } catch (e) { console.error(e); }
        setShowTasteOnboarding(false);
    }

    const handleWikiSelect = async (work) => {
        setWikiWork(work);
        setWiki(null);
        setWikiTab('세계관');
        try { setWiki(await getWiki(userId, work.session_id)); } catch (e) { console.error(e); }
    };

    const handleDeleteSentence = async (id) => {
        if (!window.confirm('삭제할까요?')) return;
        try {
            await deleteSentence(userId, id);
            setSentences(prev => prev.filter(s => s.id !== id));
        } catch (e) { console.error(e); }
    };

    if (loading) return <div className="mp-loading">내 서재 불러오는 중...</div>;

    return (
        <div className="mp">
            {/* 사이드바 */}
            <aside className="mp-sidebar">
                <button className="mp-back" onClick={() => navigate('/')}>← 메인</button>

                {/* 프로필 미니 카드 */}
                {profile && (
                    <div className="mp-sidebar-profile">
                        <div className="mp-sidebar-avatar">
                            {profile.username?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="mp-sidebar-name">{profile.username}</div>
                        <div className="mp-sidebar-stats">
                            <span>{profile.stats.total_works} 작품</span>
                            <span>{profile.stats.total_chars.toLocaleString()}자</span>
                        </div>
                    </div>
                )}

                {/* 내 서재 */}
                <div className="mp-nav-group">
                    <span className="mp-nav-label">내 서재</span>
                    {NAV.library.map(({ id, icon }) => (
                        <button
                            key={id}
                            className={`mp-nav-item ${active === id ? 'mp-nav-item--active' : ''}`}
                            onClick={() => handleNav(id)}
                        >
                            <span className="mp-nav-icon">{icon}</span>{id}
                        </button>
                    ))}
                </div>

                {/* 계정 */}
                <div className="mp-nav-group">
                    <span className="mp-nav-label">계정</span>
                    {NAV.account.map(({ id, icon }) => (
                        <button
                            key={id}
                            className={`mp-nav-item ${active === id ? 'mp-nav-item--active' : ''}`}
                            onClick={() => handleNav(id)}
                        >
                            <span className="mp-nav-icon">{icon}</span>{id}
                        </button>
                    ))}
                </div>
            </aside>

            {/* 메인 콘텐츠 */}
            <main className="mp-main">
                <h2 className="mp-page-title">{active}</h2>

                {/* ── 대시보드 ── */}
                {active === '대시보드' && (
                    <div className="mp-dashboard">
                        {dashboard ? (
                            <>
                                {/* 오늘의 작가 편지 */}
                                {(() => {
                                    const { situation, authorId } = determineSituation(dashboard, profile, works);
                                    const protagonistName = dashboard.resume_work?.protagonist_name ?? null;
                                    const letter = getDailyLetter(situation, authorId, protagonistName);
                                    return (
                                        <div className="mp-letter">
                                            <div className="mp-letter__label">오늘의 작가 편지</div>
                                            <div className="mp-letter__author">{letter.author}</div>
                                            <div className="mp-letter__body">
                                                {letter.paragraphs.map((para, i) => <p key={i}>{para}</p>)}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* 이어쓰기 + 최근 AI 피드백 */}
                                <div className="mp-dash-row">
                                    {dashboard.resume_work ? (
                                        <div className="mp-dash-card mp-resume">
                                            <div className="mp-dash-card__label">이어쓰기</div>
                                            <div className="mp-resume__title">{dashboard.resume_work.title}</div>
                                            <div className="mp-resume__progress">
                                                <div className="mp-resume__bar">
                                                    <div className="mp-resume__fill"
                                                        style={{ width: `${Math.min(100, Math.round(dashboard.resume_work.char_count / WORK_GOAL_CHARS * 100))}%` }}
                                                    />
                                                </div>
                                                <span className="mp-resume__pct">
                                                    {Math.min(100, Math.round(dashboard.resume_work.char_count / WORK_GOAL_CHARS * 100))}%
                                                </span>
                                            </div>
                                            {dashboard.resume_work.last_modified && (
                                                <div className="mp-resume__meta">
                                                    마지막 수정 {formatRelativeTime(dashboard.resume_work.last_modified)}
                                                </div>
                                            )}
                                            <button
                                                className="mp-resume__btn"
                                                onClick={() => navigate('/chat', {
                                                    state: {
                                                        chatId: dashboard.resume_work.session_id,
                                                        authorId: dashboard.resume_work.author_id,
                                                    }
                                                })}
                                            >
                                                이어쓰기 →
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="mp-dash-card">
                                            <div className="mp-dash-card__label">이어쓰기</div>
                                            <p className="mp-empty" style={{ padding: '20px 0' }}>아직 작품이 없어요.</p>
                                        </div>
                                    )}

                                    {dashboard.recent_feedback ? (
                                        <div className="mp-dash-card mp-feedback">
                                            <div className="mp-dash-card__label">최근 AI 피드백</div>
                                            <div className="mp-feedback__author">{dashboard.recent_feedback.author_name}</div>
                                            <p className="mp-feedback__text">"{dashboard.recent_feedback.content}"</p>
                                        </div>
                                    ) : (
                                        <div className="mp-dash-card">
                                            <div className="mp-dash-card__label">최근 AI 피드백</div>
                                            <p className="mp-empty" style={{ padding: '20px 0' }}>피드백 기록이 없어요.</p>
                                        </div>
                                    )}
                                </div>

                                {/* 이번 주 집필 현황 */}
                                <div className="mp-dash-card mp-weekly">
                                    <div className="mp-dash-card__label">이번 주 집필 현황</div>
                                    <div className="mp-weekly__nums">
                                        <span>총 작성 <strong>{dashboard.weekly_chars.toLocaleString()}자</strong></span>
                                        <span>목표 <strong>{dashboard.weekly_goal.toLocaleString()}자</strong></span>
                                        <span className="mp-weekly__pct">
                                            {Math.min(100, Math.round(dashboard.weekly_chars / dashboard.weekly_goal * 100))}%
                                        </span>
                                    </div>
                                    <div className="mp-weekly__bar">
                                        <div className="mp-weekly__fill"
                                            style={{ width: `${Math.min(100, Math.round(dashboard.weekly_chars / dashboard.weekly_goal * 100))}%` }}
                                        />
                                    </div>
                                </div>

                                {/* 함께한 작가 */}
                                {dashboard.author_shares.length > 0 && (
                                    <div className="mp-dash-card mp-dash-authors">
                                        <div className="mp-dash-card__label">함께한 작가</div>
                                        {dashboard.author_shares.map(a => (
                                            <div key={a.author_id} className="mp-dash-author-row">
                                                <span className="mp-dash-author-name">{a.name}</span>
                                                <div className="mp-dash-author-bar">
                                                    <div className="mp-dash-author-fill" style={{ width: `${a.ratio}%` }} />
                                                </div>
                                                <span className="mp-dash-author-pct">{a.ratio}%</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* 창작 수치 */}
                                {profile && (
                                    <div className="mp-dash-numbers">
                                        <div className="mp-dash-num">
                                            <span className="mp-dash-num__val">{profile.stats.total_works}</span>
                                            <span className="mp-dash-num__lbl">총 작품</span>
                                        </div>
                                        <div className="mp-dash-num">
                                            <span className="mp-dash-num__val">{profile.stats.total_chars.toLocaleString()}</span>
                                            <span className="mp-dash-num__lbl">총 글자</span>
                                        </div>
                                        <div className="mp-dash-num">
                                            <span className="mp-dash-num__val">{profile.stats.completed_works}</span>
                                            <span className="mp-dash-num__lbl">완결</span>
                                        </div>
                                        <div className="mp-dash-num">
                                            <span className="mp-dash-num__val">{profile.stats.active_days}일</span>
                                            <span className="mp-dash-num__lbl">집필 일수</span>
                                        </div>
                                        {stats && (
                                            <div className="mp-dash-num">
                                                <span className="mp-dash-num__val">{stats.avg_chars_per_work.toLocaleString()}</span>
                                                <span className="mp-dash-num__lbl">작품당 평균</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="mp-empty">불러오는 중...</p>
                        )}
                    </div>
                )}

                {/* ── 내 작품 (완결) ── */}
                {active === '내 작품' && (() => {
                    const completed = works?.filter(w => w.status === 'completed') ?? [];
                    return (
                        <div className="mp-works">
                            {completed.length === 0 ? (
                                <p className="mp-empty">완결된 작품이 없어요.<br/>집필을 마무리하면 여기에 쌓여요.</p>
                            ) : completed.map(w => (
                                <div
                                    key={w.session_id}
                                    className="mp-work-card mp-work-card--completed"
                                    onClick={() => navigate(`/read/${w.session_id}`)}
                                >
                                    <div className="mp-work-card__top">
                                        <span className="mp-work-card__title">{w.title}</span>
                                        <span className="mp-badge mp-badge--completed">완결</span>
                                    </div>
                                    <div className="mp-work-card__meta">
                                        {w.author_name && <span>작가 : {w.author_name}</span>}
                                        {w.world?.genre && <span>{w.world.genre}</span>}
                                        <span>{w.char_count.toLocaleString()}자</span>
                                        <span>{w.last_modified?.slice(0, 10)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })()}

                {/* ── 최근 작업 ── */}
                {active === '최근 작업' && (
                    <div className="mp-recent">
                        {!recent || recent.length === 0 ? (
                            <p className="mp-empty">최근 작업 기록이 없어요.</p>
                        ) : recent.map(day => (
                            <div key={day.date} className="mp-recent-day">
                                <h3 className="mp-recent-date">{day.date}</h3>
                                {day.activities.map(act => (
                                    <div key={act.session_id} className="mp-recent-item">
                                        <span className="mp-recent-title">{act.title}</span>
                                        <span className="mp-recent-chars">+{act.chars_added.toLocaleString()}자</span>
                                        {act.status !== 'completed' && (
                                            <button
                                                className="mp-recent-continue"
                                                onClick={() => navigate('/chat', {
                                                    state: { chatId: act.session_id, authorId: act.author_id }
                                                })}
                                            >
                                                이어쓰기 →
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}

                {/* ── 취향 프로필 ── */}
                {active === '취향 프로필' && (
                    <div className="mp-taste">
                        <div className="mp-taste__header">
                            <div>
                                <h2 className="mp-taste__title">취향 프로필</h2>
                                <p className="mp-taste__desc">좋아하는 작품을 선택하면 AI가 당신의 취향을 분석해요</p>
                            </div>
                            <button
                                className="mp-taste__setup-btn"
                                onClick={() => setShowTasteOnboarding(true)}
                            >
                                {tasteWorks.length > 0 ? '다시 설정하기' : '취향 설정하기'}
                            </button>
                        </div>

                        {tasteWorks.length > 0 ? (
                            <>
                                {/* 선택한 작품 chips */}
                                <div className="mp-taste__section-label">선택한 작품</div>
                                <div className="mp-taste__chips">
                                    {['book','movie','drama'].map(cat => {
                                        const catWorks = tasteWorks.filter(w => w.category === cat);
                                        if (!catWorks.length) return null;
                                        const catLabel = { book: '책', movie: '영화', drama: '드라마' }[cat];
                                        return (
                                            <div key={cat} className="mp-taste__chip-group">
                                                <span className="mp-taste__chip-cat">{catLabel}</span>
                                                {catWorks.map(w => (
                                                    <span key={w.id} className="mp-taste__chip">{w.title}</span>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* 취향 분석 결과 */}
                                {tasteProfile && (tasteProfile["선호장르"] || tasteProfile["선호키워드"]?.length > 0) && (
                                    <>
                                        <div className="mp-taste__section-label">취향 분석 결과</div>
                                        {tasteProfile["선호장르"] && (
                                            <div className="mp-taste__genre-result">
                                                <span className="mp-taste__genre-label">선호 장르</span>
                                                <span className="mp-taste__genre-value">{tasteProfile["선호장르"]}</span>
                                            </div>
                                        )}
                                        {tasteProfile["선호키워드"]?.length > 0 && (
                                            <div className="mp-taste__keywords-section">
                                                <span className="mp-taste__genre-label">선호 키워드</span>
                                                <div className="mp-taste__keywords">
                                                    {tasteProfile["선호키워드"].map((kw, i) => (
                                                        <span key={i} className="mp-taste__keyword">{kw}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </>
                        ) : (
                            <div className="mp-taste__empty">
                                <p>아직 취향 프로필이 없어요</p>
                                <p>좋아하는 작품을 선택해 AI가 당신의 취향을 분석하도록 해보세요</p>
                                <button
                                    className="mp-taste__setup-btn mp-taste__setup-btn--large"
                                    onClick={() => setShowTasteOnboarding(true)}
                                >취향 설정하기</button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── 설정집 (Phase 3 포함: 관계도, 타임라인) ── */}
                {active === '설정집' && (
                    <div className="mp-wiki-layout">
                        {/* 작품 목록 */}
                        <div className="mp-wiki-list">
                            {!works || works.length === 0 ? (
                                <p className="mp-empty">작품이 없어요.</p>
                            ) : works.map(w => (
                                <button
                                    key={w.session_id}
                                    className={`mp-wiki-item ${wikiWork?.session_id === w.session_id ? 'mp-wiki-item--active' : ''}`}
                                    onClick={() => handleWikiSelect(w)}
                                >
                                    <span className="mp-wiki-item__title">{w.title}</span>
                                    <span className={`mp-badge mp-badge--${w.status} mp-badge--sm`}>
                                        {w.status === 'active' ? '진행중' : '완결'}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* 위키 상세 */}
                        <div className="mp-wiki-detail">
                            {!wikiWork && <p className="mp-empty">좌측에서 작품을 선택해주세요.</p>}
                            {wikiWork && !wiki && <p className="mp-empty">불러오는 중...</p>}
                            {wiki && (
                                <>
                                    <div className="mp-wiki-tabs">
                                        {['세계관', '등장인물', '관계도', '타임라인'].map(t => (
                                            <button
                                                key={t}
                                                className={`mp-wiki-tab ${wikiTab === t ? 'mp-wiki-tab--active' : ''}`}
                                                onClick={() => setWikiTab(t)}
                                            >
                                                {t}
                                            </button>
                                        ))}
                                    </div>

                                    {wikiTab === '세계관' && wiki.world && (
                                        <dl className="mp-dl">
                                            {wiki.world.genre       && <><dt>장르</dt><dd>{wiki.world.genre}</dd></>}
                                            {wiki.world.setting     && <><dt>배경</dt><dd>{wiki.world.setting}</dd></>}
                                            {wiki.world.description && <><dt>설명</dt><dd>{wiki.world.description}</dd></>}
                                            {wiki.world.rules       && <><dt>규칙</dt><dd>{wiki.world.rules}</dd></>}
                                        </dl>
                                    )}

                                    {wikiTab === '등장인물' && (
                                        <div className="mp-char-grid">
                                            {wiki.characters.length === 0
                                                ? <p className="mp-empty">등록된 인물이 없어요.</p>
                                                : wiki.characters.map(c => (
                                                    <div key={c.id} className="mp-char-card">
                                                        <div className="mp-char-card__name">{c.name}</div>
                                                        <div className="mp-char-card__role">{c.role}</div>
                                                        {c.personality && <p className="mp-char-card__desc">{c.personality}</p>}
                                                    </div>
                                                ))
                                            }
                                        </div>
                                    )}

                                    {wikiTab === '관계도' && (
                                        <div className="mp-relation">
                                            {wiki.characters.length === 0
                                                ? <p className="mp-empty">등록된 인물이 없어요.</p>
                                                : (
                                                    <div className="mp-relation-grid">
                                                        {['protagonist', 'supporting', 'villain', 'narrator'].map(role => {
                                                            const chars = wiki.characters.filter(c => c.role === role);
                                                            if (!chars.length) return null;
                                                            const roleLabel = { protagonist: '주인공', supporting: '조연', villain: '빌런', narrator: '화자' }[role];
                                                            return (
                                                                <div key={role} className="mp-relation-group">
                                                                    <div className="mp-relation-group__label">{roleLabel}</div>
                                                                    {chars.map(c => (
                                                                        <div key={c.id} className="mp-relation-node">
                                                                            <span className="mp-relation-node__name">{c.name}</span>
                                                                            {c.personality && <span className="mp-relation-node__desc">{c.personality.slice(0, 30)}{c.personality.length > 30 ? '…' : ''}</span>}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )
                                            }
                                        </div>
                                    )}

                                    {wikiTab === '타임라인' && (
                                        <div className="mp-timeline">
                                            {!wiki.story_summary
                                                ? <p className="mp-empty">아직 줄거리가 없어요. 대화를 이어가면 자동 생성됩니다.</p>
                                                : (
                                                    <>
                                                        <div className="mp-timeline-label">AI가 요약한 줄거리</div>
                                                        {wiki.story_summary.split(/\n|·|•|-\s/).filter(Boolean).map((line, i) => (
                                                            <div key={i} className="mp-timeline-item">
                                                                <div className="mp-timeline-dot" />
                                                                <p className="mp-timeline-text">{line.trim()}</p>
                                                            </div>
                                                        ))}
                                                    </>
                                                )
                                            }
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* ── 문장 보관함 ── */}
                {active === '문장 보관함' && (
                    <div className="mp-sentences">
                        {!sentences || sentences.length === 0 ? (
                            <p className="mp-empty">저장된 문장이 없어요.<br/>AI 피드백 버블의 💾 버튼으로 저장할 수 있어요.</p>
                        ) : sentences.map(s => (
                            <div key={s.id} className="mp-sentence">
                                <div className="mp-sentence__top">
                                    {s.label && <span className="mp-sentence__label">{s.label}</span>}
                                    <button className="mp-sentence__del" onClick={() => handleDeleteSentence(s.id)}>×</button>
                                </div>
                                <p className="mp-sentence__text">"{s.content}"</p>
                                {s.session_title && <span className="mp-sentence__src">— {s.session_title}</span>}
                            </div>
                        ))}
                    </div>
                )}

                {/* ── AI 작가 기록 (Phase 2) ── */}
                {active === 'AI 작가 기록' && (
                    <div className="mp-author-records">
                        {!authorRecords || authorRecords.length === 0 ? (
                            <p className="mp-empty">아직 작가와 협업한 기록이 없어요.</p>
                        ) : (() => {
                            const totalWorks = profile?.stats?.total_works || 0;
                            return authorRecords.map(r => {
                                const pct = totalWorks > 0 ? Math.round(r.work_count / totalWorks * 100) : 0;
                                return (
                                    <div key={r.author_id} className="mp-author-card">
                                        <div className="mp-author-card__name">{r.name}</div>
                                        <div className="mp-author-pct">
                                            <div className="mp-author-pct__bar">
                                                <div className="mp-author-pct__fill" style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="mp-author-pct__label">{pct}%</span>
                                        </div>
                                        <div className="mp-author-card__stats">
                                            <div className="mp-author-card__stat">
                                                <span className="mp-author-card__stat-val">{r.work_count}</span>
                                                <span className="mp-author-card__stat-lbl">함께 쓴 작품</span>
                                            </div>
                                            <div className="mp-author-card__stat">
                                                <span className="mp-author-card__stat-val">{r.dialogue_count}</span>
                                                <span className="mp-author-card__stat-lbl">누적 대화</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                )}

                {/* ── 업적 (Phase 2) ── */}
                {active === '업적' && (
                    <div className="mp-achievements">
                        {!achievements ? (
                            <p className="mp-empty">불러오는 중...</p>
                        ) : (
                            <>
                                <div className="mp-ach-summary">
                                    달성 {achievements.filter(a => a.unlocked).length} / {achievements.length}
                                </div>
                                <div className="mp-ach-grid">
                                    {achievements.map(a => (
                                        <div key={a.id} className={`mp-ach-card ${a.unlocked ? 'mp-ach-card--unlocked' : ''}`}>
                                            <span className="mp-ach-icon">{a.icon}</span>
                                            <span className="mp-ach-title">{a.title}</span>
                                            <span className="mp-ach-desc">{a.desc}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ── 환경설정 ── */}
                {active === '환경설정' && (
                    <div className="mp-placeholder">
                        <p>환경설정은 준비 중이에요.</p>
                    </div>
                )}

                {/* ── 알림설정 ── */}
                {active === '알림설정' && (
                    <div className="mp-placeholder">
                        <p>알림설정은 준비 중이에요.</p>
                    </div>
                )}
            </main>

            {showTasteOnboarding && (
                <TasteOnboarding
                    onComplete={handleTasteComplete}
                    onClose={() => setShowTasteOnboarding(false)}
                />
            )}
        </div>
    );
}

export default MyPage;
