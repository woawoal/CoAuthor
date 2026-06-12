const TMDB = 'https://image.tmdb.org/t/p/w342';

export const TAG_EMOJI = {
  fantasy: '🗡️', romance: '💕', action: '⚡', sf: '🚀',
  mystery: '🔍', horror: '👻', growth: '🌱', slice_of_life: '☕',
  thriller: '🎭', social: '🌐', dark: '🌑', history: '📜',
  comedy: '😄', politics: '⚔️', philosophy: '💭',
};

export const TASTE_DATA = {
  book: [
    { id: 'nahollo',      title: '나 혼자만 레벨업', tags: ['fantasy','action','growth'],       img: `${TMDB}/oNG8BVXX9THCZH2m18uyHoJ5fL5.jpg`, color: '#3E2723' },
    { id: 'omniscient',   title: '전지적 독자 시점', tags: ['fantasy','sf','action'],            img: '',                                         color: '#1A237E' },
    { id: 'hwasan',       title: '화산귀환',          tags: ['action','growth'],                 img: '',                                         color: '#B71C1C' },
    { id: 'harrypotter',  title: '해리포터',           tags: ['fantasy','growth'],               img: `${TMDB}/wuMc08IPKEatf9rnMNXvIDxqP4W.jpg`, color: '#1A237E' },
    { id: 'lotr',         title: '반지의 제왕',        tags: ['fantasy','action'],               img: `${TMDB}/6oom5QYQ2yQTMJIbnvbkBL9cHo6.jpg`, color: '#4E342E' },
    { id: 'demon_slayer', title: '귀멸의 칼날',        tags: ['fantasy','action','growth'],      img: `${TMDB}/xUfRZu2mi8jH6SzQEJGBoGi64TU.jpg`, color: '#880E4F' },
    { id: 'almond',       title: '아몬드',             tags: ['slice_of_life','growth'],         img: '',                                         color: '#37474F' },
    { id: 'little_prince',title: '어린왕자',           tags: ['slice_of_life','philosophy'],     img: '',                                         color: '#1565C0' },
  ],
  movie: [
    { id: 'interstellar', title: '인터스텔라',           tags: ['sf','action'],                  img: `${TMDB}/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg`, color: '#0D47A1' },
    { id: 'parasite',     title: '기생충',               tags: ['thriller','politics','social'], img: `${TMDB}/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg`, color: '#212121' },
    { id: 'avengers',     title: '어벤져스: 엔드게임',   tags: ['action','fantasy'],             img: `${TMDB}/or06FN3Dka5tukK1e9sl16pB3iy.jpg`, color: '#B71C1C' },
    { id: 'dune',         title: '듄',                   tags: ['sf','politics','action'],       img: `${TMDB}/d5NXSklXo0qyIYkgV48Wbl4aKwX.jpg`, color: '#E65100' },
    { id: 'spiderman',    title: '스파이더맨: 노 웨이 홈', tags: ['action','fantasy','growth'],  img: `${TMDB}/1g0dhYtq4irTY1GPXvft6k4YLjm.jpg`, color: '#B71C1C' },
    { id: 'your_name',    title: '너의 이름은',           tags: ['romance','fantasy','sf'],      img: `${TMDB}/q719jXXEzOoYaps6babgKnONONX.jpg`, color: '#1565C0' },
    { id: 'oppenheimer',  title: '오펜하이머',            tags: ['history','politics'],          img: `${TMDB}/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg`, color: '#212121' },
    { id: 'oldboy',       title: '올드보이',              tags: ['thriller','mystery'],          img: `${TMDB}/pgWZXYG0gTKkwRH9pTxoscFmFTD.jpg`, color: '#4A148C' },
  ],
  drama: [
    { id: 'squid_game',    title: '오징어 게임',          tags: ['thriller','social','politics'], img: `${TMDB}/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg`, color: '#880E4F' },
    { id: 'kingdom',       title: '킹덤',                 tags: ['horror','action','politics'],  img: `${TMDB}/jLe9VcR7SA2LQCkEMEGMqtjzSbE.jpg`, color: '#1B5E20' },
    { id: 'crash_landing', title: '사랑의 불시착',         tags: ['romance','action'],            img: `${TMDB}/3CxmxUMYzTBGkWmxhsJJzA1ZHvB.jpg`, color: '#01579B' },
    { id: 'woo',           title: '이상한 변호사 우영우',  tags: ['slice_of_life','romance'],     img: `${TMDB}/9cnMPBNJxm9ERnEAKb9aQQCkfT.jpg`,  color: '#0277BD' },
    { id: 'vincenzo',      title: '빈센조',               tags: ['action','comedy','thriller'],  img: `${TMDB}/uyTJ5JBZ8LXsMpg5TFiOrNzXVmH.jpg`, color: '#37474F' },
    { id: 'dp',            title: 'D.P.',                 tags: ['drama','social','dark'],       img: `${TMDB}/pJmVbFumzjrwQHNfbbHxNXHn47J.jpg`, color: '#263238' },
    { id: 'reply_1988',    title: '응답하라 1988',         tags: ['romance','slice_of_life'],     img: `${TMDB}/gKQjLkHqeExD9WQp0Nzd8s0ZHKC.jpg`, color: '#827717' },
    { id: 'goblin',        title: '도깨비',               tags: ['romance','fantasy'],            img: `${TMDB}/oBf7RLMcCkIOEjOsIFf1Y1VOwx7.jpg`, color: '#4527A0' },
  ],
};

export const TASTE_GENRE_LABELS = {
  fantasy: '판타지', growth: '성장', romance: '로맨스', action: '액션',
  sf: 'SF', mystery: '미스터리', horror: '호러', politics: '정치',
  slice_of_life: '일상', thriller: '스릴러', social: '사회',
  dark: '다크', history: '역사', comedy: '코미디', philosophy: '철학',
};

export const CATEGORY_LABELS = { book: '책', movie: '영화', drama: '드라마' };
