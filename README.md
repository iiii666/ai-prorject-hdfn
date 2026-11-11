# 현대백화점 DW · MySQL 분석 워크스페이스

React + TypeScript 화면, Node.js API, **Docker Compose의 MySQL 8.4 LTS**로 구성합니다. 실시간 조회와 설정 저장은 MySQL을 사용합니다. 매출·고객·캠페인·앱·예산 분석, 데이터 카탈로그/리니지, OpenAI 커스텀 분석을 제공합니다.

고객·거래는 생성 샘플입니다. 실제 현대백화점 DW와 사용자 인증은 연결하지 않았습니다.

## 내 분석 앱 · 지표 감시 에이전트

왼쪽 **내 분석 앱**에서 대화 또는 직접 설정으로 분석 화면을 만들고 MySQL에 저장합니다. 점포·채널·상품군·일별 차트와 표, 지표 정의, 비교 기간, 버전 이력과 복원을 지원합니다.

저장된 앱에 **지표 감시 에이전트**를 연결하면 한국 시간 기준 매일/매주 조건을 확인합니다. 시험 실행, 활성화/중지, 실행 보고서, 매출 변동의 상품군·채널 추가 조회를 제공합니다. OpenAI 키 없이도 직접 구성과 감시 기능을 사용할 수 있습니다.

설치·설정·판정 규칙·아키텍처·API·운영 한계는 [상세 사용/개발 가이드](docs/my-analysis-apps.md)를 참고하세요. 서버를 재시작하면 새 저장 테이블이 자동 추가됩니다.

## 감시 시연 이력

**내 분석 앱 → 감시 실행 이력 → 시연 이력 준비 / 불러오기**에서 최근 8주와 판단 보류 사례, 총 9건을 준비할 수 있습니다. 실제 샘플 DB를 재조회한 과거 재현 기록으로, 정기·시험 실행과 구분합니다. 상태·에이전트·유형·기록일 필터와 보고서 상세를 제공합니다. 명령으로는 `npm run db:demo`를 실행하세요. [시연 가이드](docs/agent-history-demo.md)

## 기존 프로젝트 업데이트

실행 중인 서버를 `Ctrl+C`로 종료하고 **Docker Desktop**을 설치·실행한 뒤 VS Code 터미널에서 실행하세요. macOS Intel/Apple Silicon 모두 공식 MySQL 멀티 아키텍처 이미지를 사용합니다.

```bash
cd ~/ai-prorject-hdfn
git pull --ff-only
npm ci
npm run db:up
npm run dev
```

브라우저: **http://localhost:5173** (사용 중이면 터미널에 표시된 포트).

기존 `.env`에 OpenAI 키만 있어도 기본 DB 설정으로 실행할 수 있습니다. 기존 SQLite 파일은 자동 삭제하거나 덮어쓰지 않습니다. 기본적으로 새 MySQL DB에는 샘플을 생성합니다. **기존 SQLite 데이터와 설정을 그대로 가져오려면 아래 이관 절차를 최초 MySQL 초기화 전에 확인하세요.**

## 처음 설치

필수: **Node.js 24 이상**, Git, Docker Desktop(Compose v2 포함), VS Code.

```bash
git clone https://github.com/iiii666/ai-prorject-hdfn.git
cd ai-prorject-hdfn
npm ci
cp .env.example .env
npm run db:up
npm run dev
```

VS Code에서 `파일 → 폴더 열기`로 프로젝트를 엽니다. `code .` 명령은 VS Code 셸 명령 등록 후 사용할 수 있습니다.

`npm run db:up`은 MySQL이 정상 상태가 될 때까지 기다립니다. 첫 다운로드와 DB 초기화에는 시간이 걸립니다. `npm run dev`는 MySQL 스키마/샘플을 준비하고 API(3001)가 준비된 다음 Vite를 시작합니다. OpenAI 키 없이 일반 대시보드는 사용할 수 있습니다.

## 구성

```text
브라우저 :5173 → Vite /api 프록시 → Node.js API :3001
                                      ↓ mysql2 연결 풀
                           MySQL 8.4 컨테이너 :3306
                                      ↓
                           mysql_data 영속 볼륨
```

- MySQL은 로컬 `127.0.0.1`에만 포트를 공개합니다.
- `docker compose down`으로 컨테이너를 내렸다가 올려도 볼륨 데이터는 유지됩니다.
- **`docker compose down -v`는 DB 볼륨을 삭제합니다.** 일반 종료에는 `npm run db:down`을 사용하세요.
- 기존 DB가 있으면 재시작 시 샘플을 다시 넣지 않습니다. 샘플은 트랜잭션으로 적재하고 동시 초기화는 MySQL 잠금으로 직렬화합니다.
- 테이블은 InnoDB, 외래 키·제약·인덱스, 문자셋은 utf8mb4입니다. 날짜/시각은 기존 API와 호환되는 ISO 문자열로 보관합니다.
- API는 비동기 쿼리와 연결 풀을 사용하며, 설정 저장은 전용 연결의 트랜잭션으로 처리합니다.
- 카탈로그의 컬럼/기본키/행 수는 `information_schema`와 실제 테이블/뷰에서 조회합니다.

## 환경 설정

프로젝트 `.env` 예시입니다. API 키와 실제 운영 비밀번호는 Git에 올리지 마세요.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=hyundai_dw
DB_USER=dw_app
DB_PASSWORD=dw_local_password
MYSQL_ROOT_PASSWORD=dw_local_root_password
```

기본 비밀번호는 로컬 개발용입니다. DB 포트가 충돌하면 `.env`에서 `DB_PORT=3307`로 변경하고 컨테이너와 앱을 다시 실행하세요. Compose와 Node가 같은 `.env`의 포트를 사용합니다. DB 계정/비밀번호 초기화 환경 변수는 **볼륨이 처음 만들어질 때만 적용**됩니다. 기존 볼륨의 비밀번호는 `.env` 변경만으로 바뀌지 않으며, SQL로 변경하거나 별도 개발 DB를 구성해야 합니다.

DB 접속 정보/키를 변경했으면 서버를 재시작하세요. MySQL이 연결되지 않으면 API는 시작 오류를 표시하며 SQLite로 대체하지 않습니다.

## MySQL 관리

```bash
npm run db:up             # MySQL 컨테이너 시작 및 정상 상태 대기
npm run db:seed           # 스키마/샘플 준비 또는 기존 DB 확인
npm run db:down           # 컨테이너 종료, 데이터 볼륨 보존
docker compose ps
docker compose logs --tail=50 mysql
```

DBeaver / MySQL Workbench 연결: Host `127.0.0.1`, Port `3306`, Database `hyundai_dw`, User `dw_app`, Password는 `.env`의 `DB_PASSWORD`입니다.

컨테이너에서 SQL을 직접 확인하려면:

```bash
docker compose exec mysql mysql -u dw_app -p hyundai_dw
```

설정한 DB 비밀번호를 프롬프트에 입력하세요.

## 기존 SQLite 데이터 이관 (선택)

이관은 **비어 있는 MySQL DB를 처음 준비할 때만** 지원합니다. API/개발 서버를 종료한 상태에서 `.env`에 원본 파일 경로를 추가하세요.

```dotenv
DB_IMPORT_SQLITE=data/hyundai-dw.sqlite
```

그다음 실행하세요.

```bash
npm run db:up
npm run db:seed
npm run dev
```

SQLite 원본은 읽기 전용으로 열고 기존 테이블 데이터를 MySQL에 일괄 적재합니다. 고객/주문/결제/앱/예산/캠페인/설정/메타데이터를 가져오며 원본을 변경하지 않습니다. 기존 원본은 최신 SQLite 버전의 프로젝트에서 과거 이력 보강까지 완료된 DB를 사용하세요. MySQL에는 원본 값 그대로 가져오므로 원본에 없는 과거 이력을 임의 추가하지 않습니다.

이미 MySQL에 `seed_info`가 있으면 기존 DB를 보존하고 재이관하지 않습니다. 이관을 새로 시험하려면 기존 볼륨을 삭제하기보다 **다른 Compose 프로젝트와 DB 포트**로 별도의 볼륨을 준비하세요. 이관 후 `DB_IMPORT_SQLITE` 설정은 제거해도 됩니다.

## 샘플 데이터와 지표

첫 샘플 초기화 시 기준일(KST)까지 최근 210일의 운영 데이터를 만들고, 매출/운영 과거 이력을 기준일의 2년 전 1월 1일까지 보완합니다. 고객 3,600명, 상품 48개, 점포 3개와 약 10만 건의 주문을 생성합니다. 미래 월은 실적으로 생성하지 않습니다.

- **매출**: 완료 주문 결제액 합계. 취소 주문 제외. 상품 수량×단가와 결제액을 맞춥니다.
- **활성 고객**: 조회 기간·점포·채널에서 완료 주문이 있는 고유 고객.
- **누적 고객**: 같은 점포·채널에서 조회 종료일까지 구매 이력이 있는 고객.
- **신규 고객**: 같은 점포·채널의 첫 구매일이 기간 안에 있는 고객.
- **재구매율**: 기간 내 2회 이상 구매 고객 / 기간 내 구매 고객.
- **휴면 위험**: 마지막 구매가 조회 종료일 기준 30일 이상 이전인 고객.
- **캠페인 전환율**: 기간 내 대상 지정 고객 중 같은 기간 귀속 완료 주문이 있는 고객 / 대상 고객. 전체는 대상 수로 가중 집계하고 캠페인 간 중복 포함.
- **앱 퍼널**: 세션 단위 방문 → 상품 조회 → 장바구니 → 완료 주문. 모바일 완료 주문과 구매 세션을 연결합니다.
- **예산**: 기간·점포·채널별 일 배정/집행 합계. CRM 집행과 캠페인 집행 합계를 맞춥니다.
- **전기 비교**: 조회 시작일 직전 동일 길이 기간. 분모가 0인 비율은 `—`, 전기 기준이 0이면 비교 기준 없음.

최근 7/30/90일의 기준은 DB 생성 당시 데이터 종료일입니다. 날짜 직접 지정도 가능하며 최대 365일입니다. CSV는 적용 필터의 통합 KPI를 서버에서 조회해 내보냅니다. 리니지는 SQL 뷰 의존 관계이고, 모든 FK/API 조회 관계를 뜻하지는 않습니다.

## 커스텀 분석 · OpenAI

`.env`의 `OPENAI_API_KEY`에 발급받은 키를 넣고 서버를 재시작하면 왼쪽 **커스텀 분석**을 사용할 수 있습니다. ChatGPT 구독과 OpenAI API 요금은 별도입니다.

질문은 규칙 검사와 모델의 범위 검사를 거칩니다. 개인정보·지침 우회·DB 변경·무관한 요청은 차단합니다. LLM에 SQL 실행 권한/도구나 원본 고객 행을 제공하지 않으며 **질문과 MySQL 집계값만 OpenAI로 전송**합니다. Responses API 구조화 응답과 `store: false`를 사용합니다. 모델명 기본값은 `gpt-4.1-mini`입니다.

점포별 순위/비중/전년 동기, 채널/상품군/고객등급, 월별 추이, 캠페인/예산/앱 근거를 전달합니다. 화면의 검증 표와 차트는 모델 생성 숫자가 아닌 서버 집계입니다. 보유한 점포 데이터를 “미제공”이라고 쓰는 알려진 모순은 한 번 재검토하고, 계속 모순되면 오류 처리합니다. 모든 자연어의 오류나 우회를 완벽하게 검증하는 장치는 아닙니다.

예측은 기준 연도 월별 일평균에 완전히 보유한 월의 전년 대비 성장률(±20% 제한)을 적용합니다. 미보유 월은 전년 동월 또는 보유 기간 평균으로 대체하며, 부분 월과 보유 일수를 표시합니다. 보수/낙관은 ±15% 가정이고 신뢰구간이 아닙니다. 이벤트 증가율 0~20%는 사용자가 정한 가정이지 실제 인과 효과 추정이 아닙니다.

서버당 동시 1건, 분당 6건, 외부 호출당 45초 제한입니다. 범위 검사·보고서·필요 시 정정으로 최대 세 번 호출할 수 있습니다. 키가 없으면 실제 LLM 호출을 하지 않습니다. 공용 서비스로 공개할 때는 사용자 인증과 사용자별 사용량 제어를 추가해야 합니다.

## 개발 및 검증

```bash
npm run dev             # MySQL 준비 → API + Vite
npm run build           # TypeScript 검사 + 프론트엔드 빌드
npm start               # API + 빌드 화면: http://localhost:3001
npm test                # 격리된 메모리 테스트 픽스처의 로직/정합성 검사
npm run test:mysql      # 실행 중인 실제 MySQL의 쿼리/API/제약/집계 검사
```

`npm test`의 격리 픽스처와 최초 샘플 생성기는 기존 생성 로직을 재사용하기 위해 Node 내장 SQLite를 **메모리에서만** 사용합니다. 웹 서비스의 저장/조회에는 SQLite를 사용하지 않습니다. `test:mysql`은 실제 MySQL 없이는 성공하지 않으며 DB 데이터를 삭제하지 않습니다. 설정 변경 테스트는 원래 값을 복구하고 FK 오류 테스트는 롤백합니다. 모델 응답 테스트는 대역을 사용하므로 OpenAI 비용이 발생하지 않습니다.

프로덕션 빌드 검증과 실제 MySQL 통합 검사를 GitHub Actions에서도 실행합니다.

```text
compose.yaml              # MySQL 8.4 + healthcheck + 영속 볼륨
server/db.mjs             # mysql2 연결 풀, 비동기 SQL, 초기화/일괄 적재
server/schema.sql         # MySQL InnoDB 테이블/FK/인덱스/뷰
server/config.mjs         # 서버 환경 파일 로딩
server/fixtures/          # 격리된 샘플 생성기/선택적 SQLite 읽기 전용 이관
server/analytics.mjs      # 분석 SQL
server/evidence.mjs       # LLM에 전달하는 집계 근거
server/custom.mjs         # 질문 제한, 예측, OpenAI 분석
src/                      # React 화면
```

주요 API: `/api/health`, `/api/bootstrap`, `/api/analytics`, `/api/orders`, `/api/catalog`, `/api/export`, `PATCH /api/settings`, `/api/custom/status`, `POST /api/custom/analyze`.
