// 임시 스텁 — @neondatabase/neon-js(로그인 의존성)가 미설치일 때 로그인 모듈을 우회한다.
// vite.config.js의 조건부 alias가 이 파일로 연결한다. 패키지가 설치되면 alias가 꺼져 안 쓰인다.
// → 로그인만 비활성(빈 화면)되고 나머지 앱(채팅·아바타 등)은 정상 동작.
export function NeonAuthUIProvider({ children }) {
  return <>{children}</>;
}

export function AuthView() {
  return null;
}

export function createAuthClient() {
  return {
    async getSession() { return { data: {} }; },
    async signOut() {},
  };
}
