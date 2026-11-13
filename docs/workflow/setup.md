# AI coding workflow 설치 및 사용

연결 Issue: #4. 자동화 코드는 이 PR이 main에 병합되어야 Issue 이벤트를 받을 수 있습니다. 설치 전 생성한 Issue는 자동 처리되지 않으며 설치 후 ai-ready를 지정합니다.

## 1. 코드 설치

이 bootstrap PR을 팀원이 리뷰하고 main에 병합합니다. API 키가 없어도 `개발 워크플로우` 메뉴의 GitHub 조회와 명시적 시연 보드는 볼 수 있습니다. 시연은 실제 실행 성과가 아닙니다.

## 2. 저장소 관리자 설정 (최초 1회)

1. Settings → Secrets and variables → Actions → New repository secret → 이름 `OPENAI_API_KEY`. 실제 OpenAI API 키를 입력합니다. 로컬 .env와 Actions Secret은 별개입니다. 키를 Issue/PR/문서에 넣지 않습니다.
2. Settings → Actions → General → Workflow permissions에서 **Allow GitHub Actions to create and approve pull requests**를 허용합니다. 이 workflow는 승인/병합을 자동으로 수행하지 않지만 GitHub가 PR 생성에 이 옵션을 요구합니다. 필요한 job별 permissions는 YAML에 명시했습니다. 조직 정책으로 막혀 있으면 조직 관리자 설정이 필요합니다.
3. Actions → **Setup AI workflow labels** → Run workflow. ai-ready / agent:running / agent:review / agent:blocked / agent:done 라벨을 준비합니다.
4. Settings → Rules → Rulesets 또는 Branches에서 main 보호: **PR 필수, 승인 최소 1명, 새 커밋 시 기존 승인 해제, 필수 체크 `AI workflow verification`, 최신 main 반영 요구, force-push 금지**. 가능한 경우 관리자 우회도 제한합니다. 체크가 선택 목록에 없다면 첫 성공 실행 후 선택합니다. 설정은 코드만 추가해도 자동 적용되는 것이 아니며 관리자가 확인해야 합니다.

GitHub plan/조직 정책에 따라 보호 규칙 지원 여부가 다릅니다. 보호가 적용됐다고 가정하지 말고 시연에서 설정과 실제 병합 차단을 확인하세요. 에이전트는 merge API를 호출하지 않습니다.

## 3. 작업 등록 → 자동 실행

Issues → New issue → Feature/Bug 양식을 사용해 Problem / Acceptance criteria / Design / Tests를 작성합니다. 모든 작업을 Issue로 등록합니다. 모호한 작업은 먼저 설계를 보완하고 **쓰기 권한을 가진 팀원**이 ai-ready를 붙입니다.

- 열린 ai-ready Issue가 생성되거나 라벨이 붙으면 자동 실행됩니다. 수동 복구는 Actions → Issue to AI PR → Run workflow에서 Issue 번호를 지정합니다(역시 열린 ai-ready가 필요).
- prepare: actor 쓰기 권한/필수 항목/키 설정/열린 중복 PR을 확인하고 Issue별 브랜치를 만듭니다.
- design: 별도 Codex 실행이 docs/changes/issue-N.md만 수정합니다. 검증하고 설계 커밋을 만든 뒤 다음 job으로 전달합니다.
- agent: 새 러너에서 승인 설계를 적용한 다음 Codex가 구현·테스트합니다. `drop-sudo`는 러너당 한 번만 실행하도록 설계/구현 job을 분리했습니다. 임시 Codex config는 workspace-write와 테스트용 네트워크 접근을 허용합니다.
- verify: 모델/운영 키가 없는 새 PostgreSQL 환경에서 패치 정책, Unit, PostgreSQL, Build, E2E를 실행합니다.
- publish: 쓰기 토큰이 있는 별도 job이 설계/구현 두 커밋을 게시하고 검증한 트리와 일치하는 PR을 만듭니다. 이 job에서는 패치 코드를 실행하거나 의존성을 설치하지 않습니다.

에이전트 job에는 게시 토큰/실제 Supabase 접속 정보를 제공하지 않습니다. OPENAI_API_KEY는 공식 Codex Action 프록시에만 입력합니다. Issue 텍스트는 쉘에 삽입하지 않고 JSON 파일로 읽습니다. Action은 commit SHA에 고정했습니다.

## 4. 성공·실패와 리뷰

- 모든 독립 검증 성공 → 일반 PR + 성공 체크 + 사람 리뷰 대기.
- 테스트 실패/누락 → 실패 결과 포함 Draft PR. 로그/종료 코드를 확인하세요.
- 모델 실행 실패/설계 검증 실패/금지 파일 변경 → Issue에 확인 필요 상태와 실행 링크. 검증되지 않은 코드는 게시하지 않습니다.
- 유효한 패치가 없는 실행에 PR을 꾸며서 만들지 않습니다.
- 열린 agent PR이 있으면 같은 Issue를 중복 처리하지 않습니다. 실패한 Draft는 사람이 수정해 push하거나 별도의 후속 Issue를 작성합니다. 무제한 자동 재시도/재귀 루프는 이 버전에 없습니다.
- PR 리뷰 승인 이후 사람이 병합합니다. 병합 후 연결 Issue가 종료되고 완료 라벨이 붙습니다.

## 5. GITHUB_TOKEN과 CI

GitHub가 GITHUB_TOKEN으로 생성한 PR 이벤트에서 일반 PR workflow를 생략할 수 있으므로 성공했다고 가정하지 않습니다. 이 실행은 독립 검증한 **동일한 tree와 PR HEAD**에 `AI workflow verification` 체크를 명시적으로 게시합니다. 사람의 후속 push로 Build가 실행되면 신뢰된 main 코드의 workflow_run 작업이 현재 PR HEAD와 일치하는 경우 체크를 갱신합니다. 외부 fork 코드나 아티팩트를 쓰기 권한 job에서 실행하지 않습니다.

원본 검증 로그는 Actions의 `agent-verification` 아티팩트에 있고, PR의 JSON/표는 그 결과를 요약합니다. Branch protection은 이 체크와 사람 승인을 모두 요구해야 합니다. PR이 main에서 뒤처지면 사람이 최신 main을 반영하고 Build 성공을 확인합니다. Draft 해제도 사람이 확인합니다.

## 6. 작업 보드

DW의 **개발 워크플로우** 메뉴 또는 `/#workflow`.

- GitHub Issue/PR을 읽는 조회 전용 보드(별도 GitHub Projects 생성 권한 불필요).
- 대기 / AI 작업 중 / 사람 리뷰 / 확인 필요 / 완료.
- Issue, 브랜치, PR, 테스트 보고서와 Actions 링크.
- 60초 자동 조회 및 서버 캐시. 공개 API 한도/오류를 숨기지 않습니다.
- 최근 100개 Issue/PR까지 표시하고 한도 도달 시 안내합니다. 전체 이력은 GitHub를 사용합니다.
- 실제 데이터와 `발표용 시연`은 별도 모드입니다. 시연 카드는 고정 예시이며 실제 자동화 지표에 포함하지 않습니다.
- Issue→PR 시간은 대기를 포함한 경과 시간이며 순수 에이전트 실행 시간이 아닙니다. 비용/최초 통과율을 측정한 것처럼 표시하지 않습니다.

## 7. 자동 변경 범위

설계 phase는 해당 docs/changes/issue-N.md만 허용합니다. 구현은 src/server/tests/docs/README 범위에서, 승인 설계와 기준 문서는 변경할 수 없습니다. workflows, 자동화 스크립트, AGENTS.md, package/lock, .env, symlink/submodule은 자동 패치에서 차단합니다. 의존성/자동화 변경은 별도 사람이 담당하는 Issue로 진행하세요. 전체 패치는 2MB 제한입니다.

이 정책은 승인 범위를 좁히는 장치이지 생성 코드의 모든 악성 행동을 증명하는 샌드박스가 아닙니다. 코드/테스트 실행은 격리된 러너에서, 최종 승인은 사람이 담당합니다.

## 8. 검증과 알려진 설치 경계

- npm run test:workflow: 정책·실제 git 패치 순서·실패 로그 수집·보드 상태·보고서 검증.
- npm test: 기존 회귀 포함.
- npm run test:pg: 공용 Supabase가 아닌 별도 PostgreSQL에서 실행.
- npm run test:e2e: 기존 조사/이력 + 작업 보드 Playwright.
- E2E 작업 보드는 통제된 GitHub 응답으로 검증하므로 실제 Codex 성공 이력으로 해석하지 않습니다.
- Actions Secret/PR 생성 권한/main 설치 전에는 end-to-end Codex 호출을 완료했다고 주장하지 않습니다. 설치 후 작은 실제 Issue 1개로 최종 확인해야 합니다.

활성화 관리 작업은 별도 Issue에서 진행하고, 시연용 기능 Issue는 설정을 완료한 뒤 ai-ready를 지정하세요. 로컬 `.env`의 모델 설정과 Codex Action의 기본 코딩 모델은 별개입니다. Actions에 등록한 OpenAI 프로젝트에서 Codex가 사용하는 모델의 접근 및 과금이 가능해야 합니다.
