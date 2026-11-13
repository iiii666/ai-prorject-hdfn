# DW service specification

## Purpose

생성 샘플 데이터를 사용하는 현대백화점 DW 분석 워크스페이스. React UI, Node API, PostgreSQL/Supabase를 사용한다.

## Existing capabilities

통합/고객/매출/캠페인/앱/예산 조회, 데이터 카탈로그 및 SQL 뷰 리니지, 커스텀 분석과 AI 조사 에이전트, 저장 분석·정기 감시·실행 이력을 제공한다. 자세한 동작은 docs/investigation-agent.md, docs/my-analysis-apps.md, docs/agent-history-demo.md를 따른다.

## Invariants

- 금액·차트·순위는 서버 집계/계산 결과다. 생성형 모델에 임의 SQL 쓰기 권한을 제공하지 않는다.
- 실적과 예측 및 데이터 보유 기간을 구분한다. 없는 데이터는 만들어 실적으로 표시하지 않는다.
- 공용 DB가 아닌 격리된 PostgreSQL에서 자동 테스트한다. 로컬 .env 값은 저장소에 포함하지 않는다.
- 기능/버그/테스트/문서 작업을 Issue에 등록하고 수용 조건을 명시한다.

## Change procedure

각 Issue는 docs/changes/issue-N.md로 설계를 먼저 기록한 다음 구현한다. 에이전트의 코드와 테스트는 사람 리뷰 및 필수 CI 통과 후 main에 병합한다. 이 문서는 현재 저장소를 기준으로 초기 기준선을 정리한 것이며 과거 개발이 이 흐름으로 수행됐다고 주장하지 않는다.
