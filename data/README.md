# 데이터 디렉터리

## 구조

```
data/
├── raw/          # 수집 원본 (공유 마당, Project Gutenberg)
├── processed/    # 전처리 완료 (장르별 분류, 정제)
└── few_shot/     # 페르소나 few-shot 예시 (수작업 큐레이션)
    ├── baegil.json
    ├── charoi.json
    ├── haseorim.json
    └── kimdaha.json
```

## 데이터 출처

- **공유 마당** (https://gongu.copyright.or.kr): 저작권 만료 한국 소설
- **Project Gutenberg** (https://gutenberg.org): 저작권 만료 영문 소설

## 수집 원칙

- 저작권 만료 작품만 사용
- 장르 레이블 수동 검수
- few-shot 예시는 팀 내 수작업 작성 (AI 생성 금지)
