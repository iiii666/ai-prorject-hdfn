# Testing contract

- Unit/fixtures: npm test (workflow 정책/보드/보고서 및 기존 테스트 포함).
- Integration: npm run test:pg (격리 PostgreSQL 16만 사용).
- Build: npm run build.
- E2E: npm run test:e2e (Python Playwright; DW_PYTHON, CHROME_BINARY 설정 가능).
- 독립 검증기: node scripts/automation/verify.mjs. 명령별 종료 코드/기간/로그를 work/agent-verification에 남긴다. 하나가 실패해도 나머지 결과를 수집하며 최종 종료는 실패다.
- 에이전트 자체 실행 로그와 독립 CI 결과를 구분한다. 모델 API는 일반 테스트에서 호출하지 않는다.
- 테스트 실패/중단/패치 정책 위반은 성공으로 표시하지 않는다. main 병합 필수 체크는 AI workflow verification이며 PR HEAD와 검증 트리가 일치해야 한다.
