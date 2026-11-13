# Issue #4 — AI coding project workflow

## Problem

최종 DW 프로젝트의 요구사항·설계·구현·테스트·리뷰를 GitHub에 연결하고 발표할 실행 증거를 남긴다.

## Acceptance criteria

- ai-ready가 지정된 열린 Issue를 권한 확인 후 자동 처리한다.
- Issue별 브랜치, 설계 선행 커밋과 구현 커밋을 분리한다.
- 코딩 에이전트가 테스트를 실행하고 독립 CI가 다시 검증한다.
- PR에 실제 검증 결과를 포함한다. 실패 결과는 Draft, 사람 승인과 필수 체크 이후 병합한다.
- 실제 GitHub 상태를 읽는 작업 보드를 제공한다. 데모 데이터와 실제 데이터를 혼합하지 않는다.

## Design

준비 → 에이전트(설계·구현) → 독립 검증 → 권한을 분리한 게시 작업으로 나눈다. 에이전트와 테스트 작업에는 게시 토큰/공용 Supabase 접속 정보를 제공하지 않는다. PostgreSQL 서비스 컨테이너만 테스트에 사용한다. PR의 자동 CI 생성을 GITHUB_TOKEN 이벤트에 의존하지 않고 동일 실행의 검증 체크를 정확한 PR HEAD에 게시한다.

## Tests

정책·입력·상태·보고서 단위 테스트, 테스트 실패 결과 수집, 기존 Unit/PostgreSQL/E2E 회귀, 작업 보드 Playwright. 실제 Codex 실행은 유효한 Actions Secret과 main에 설치된 workflow가 필요하므로 설치 전에는 미실행이라고 표시한다.

## Non-goals

자동 main 병합, 운영 DB 변경, GitHub Projects 권한을 요구하는 조직 설정 자동 변경, 무제한 자기 수정 루프는 포함하지 않는다. 작업 보드는 GitHub Issues/PR/Actions를 읽는다.
