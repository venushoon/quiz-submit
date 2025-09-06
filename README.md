# quiz-submit (퀴즈 문제 제출 프로그램)

- Vite + React + TypeScript + Tailwind
- Firebase Realtime Database 연동
- 관리자/학생 화면 분리 (#student)
- **QR 링크/코드** 제공, **결과 공개 제어(항상/숨김/마감 후 공개)**
- 중복 방지: **기기당 1회** / **실명당 1회**
- JSON/CSV 내보내기/불러오기
- 제출 마감: 인원 수 도달 시 자동 마감 + 수동 마감/재개

## 개발
```bash
npm install
cp .env.example .env  # 로컬 개발 시
npm run dev
```

## 배포 (GitHub Pages)
- `.github/workflows/deploy.yml` 포함 → main 푸시 시 자동 빌드/배포
- `vite.config.ts`의 base는 '/quiz-submit/' (레포명 변경 시 수정)
