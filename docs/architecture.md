# Architecture

React/Vite → Node HTTP API → pg connection pool → PostgreSQL/Supabase. 조사/저장/감시 모듈과 분석/카탈로그 모듈은 기존 API 계약을 보존한다. 테스트는 격리된 PostgreSQL 16 서비스와 메모리 픽스처를 사용한다.

AI 개발 자동화: GitHub Issue → 권한/수용조건 확인 → agent/issue-N-run 브랜치 → 설계 패치 → 구현 패치 → 새 러너에서 검증 → 결과 포함 PR → 사람 리뷰. 에이전트와 검증 job은 contents:read, 게시 job만 contents/issues/pull-requests/checks:write를 가진다.

개발 작업 보드는 GitHub Issues와 Pull Requests 공개 API를 서버에서 읽고 60초 캐시한다. 외부 응답에서 선택한 필드만 표시하며 쓰기 작업/키 입력을 UI로 제공하지 않는다. 기본 저장소는 iiii666/ai-prorject-hdfn이다. 공개 API의 속도 제한/오류는 화면에 표시하고 가짜 실제 결과로 대체하지 않는다.
