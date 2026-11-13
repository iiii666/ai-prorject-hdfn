# 현대백화점 DW · PostgreSQL(Supabase) 분석 워크스페이스

React + TypeScript 화면, Node.js API, **PostgreSQL**로 구성합니다. 기본 구성은 **Supabase 프로젝트 하나를 여러 PC가 함께 사용**하는 방식이며, 같은 설정으로 로컬 PostgreSQL도 쓸 수 있습니다. 실시간 조회와 설정 저장은 PostgreSQL을 사용합니다. 매출·고객·캠페인·앱·예산 분석, 데이터 카탈로그/리니지, OpenAI 커스텀 분석을 제공합니다.

고객·거래는 생성 샘플입니다. 실제 현대백화점 DW와 사용자 인증은 연결하지 않았습니다.

## AI 조사 에이전트

왼쪽 **AI 조사 에이전트**에서 “지난주 매출이 감소한 점포를 조사해줘”로 시작하고 “모바일 쪽만 더 봐줘”, “이 결과를 저장하고 매주 확인해줘”로 조사를 이어갑니다. 모델이 조회 결과를 보고 다음 읽기 도구를 선택하며, 수행 단계와 실제 DB 근거를 함께 보여줍니다. 저장·감시 초안은 사용자 확인 후 함께 저장합니다.

기본 메뉴는 **AI에게 조사하기 / 맡긴 업무**입니다. 저장한 분석은 조사 화면의 보관함에서, 설정과 활동 기록은 각 업무 상세에서 확인합니다. 맡긴 업무는 조건을 평가한 뒤 실제 AI 또는 명시적 시연 방식으로 최대 3개 그룹을 추가 조사하고, 이전 같은 기준의 실행과 비교해 새로 발견·지속 중·회복·판단 보류를 추적합니다. **근거 확인·후속 질문**에서 같은 조사 대화를 이어갑니다. 기존 감시는 기본적으로 규칙 점검을 유지하며 업무 설정에서 조사 방식을 선택할 수 있습니다. OpenAI 키가 없으면 별도로 표시한 **샘플 시연 · 규칙 기반 도구 선택** 모드를 사용할 수 있습니다. [사용법·모드·API·검증 가이드](docs/investigation-agent.md)

시연 이력 9건은 **맡긴 업무 → 전체 활동 기록 찾아보기 → 시연 이력 준비 / 불러오기**, 또는 `npm run db:demo`로 준비합니다. [과거 재현 이력 안내](docs/agent-history-demo.md)

## 기존 프로젝트 업데이트 (MySQL/Docker에서 이전)

실행 중인 서버를 `Ctrl+C`로 종료한 뒤 VS Code 터미널에서 실행하세요. Docker와 `npm run db:up`은 더 이상 필요하지 않습니다.

```bash
git pull --ff-only
npm install            # mysql2 대신 pg 설치
# .env에 DATABASE_URL 추가 (아래 "Supabase 설정")
npm run dev
```

브라우저: **http://localhost:5173** (사용 중이면 터미널에 표시된 포트).

기존 MySQL 컨테이너의 데이터는 자동으로 옮겨지지 않습니다. 새 PostgreSQL DB가 비어 있으면 서버가 첫 실행에서 샘플을 생성합니다. 기존 SQLite 파일은 자동 삭제하거나 덮어쓰지 않으며, **기존 SQLite 데이터와 설정을 가져오려면 아래 이관 절차를 최초 초기화 전에 확인하세요.**

## 처음 설치

필수: **Node.js 24 이상**, Git, VS Code, Supabase 프로젝트(또는 PostgreSQL 15 이상).

```bash
git clone https://github.com/iiii666/ai-prorject-hdfn.git
cd ai-prorject-hdfn
npm ci
cp .env.example .env   # DATABASE_URL과 OPENAI_API_KEY 입력
npm run dev
```

VS Code에서 `파일 → 폴더 열기`로 프로젝트를 엽니다. `code .` 명령은 VS Code 셸 명령 등록 후 사용할 수 있습니다.

`npm run dev`는 DB 스키마/샘플을 준비하고 API(3001)가 준비된 다음 Vite를 시작합니다. OpenAI 키 없이 일반 대시보드는 사용할 수 있습니다.

## Supabase 설정

1. Supabase에서 프로젝트를 만들고 DB 비밀번호를 정합니다. 리전은 서울(`ap-northeast-2`)을 권장합니다.
2. 대시보드 **Connect**에서 **Session pooler** 연결 문자열(`…pooler.supabase.com:5432`)을 복사합니다. 직접 연결(`db.<ref>.supabase.co`)은 IPv6 전용이라 사내망에서 막힐 수 있습니다.
3. `.env`의 `DATABASE_URL`에 넣습니다. 비밀번호의 특수문자는 URL 인코딩(`@`→`%40`)해야 합니다.
4. 팀원은 같은 `DATABASE_URL`을 각자 `.env`에 넣으면 같은 DB를 봅니다. 비밀번호는 메신저/메일 본문이 아닌 비밀번호 관리 도구로 공유하세요.

- 첫 서버 실행에서 스키마와 샘플이 생성됩니다. 이후 실행하는 PC는 기존 데이터를 그대로 사용합니다.
- 서버가 모든 테이블에 **행 수준 보안(RLS)을 정책 없이 켜고**, 뷰는 `security_invoker`로 만듭니다. Supabase의 REST API(anon 키)로는 이 데이터를 읽을 수 없고, 서버의 직접 DB 연결만 사용할 수 있습니다.
- 실제 현대백화점 데이터를 넣기 전에는 사내 보안 정책(외부 클라우드 반출 가능 여부)을 먼저 확인하세요. 현재 데이터는 생성 샘플입니다.

## 구성

```text
브라우저 :5173 → Vite /api 프록시 → Node.js API :3001 (각 PC)
                                      ↓ pg 연결 풀 (SSL)
                              Supabase PostgreSQL (공용)
```

- 모든 PC가 같은 DB를 공유합니다. 한 PC에서 저장한 분석 앱·감시·설정은 다른 PC에서도 보입니다.
- 기존 DB가 있으면 재시작 시 샘플을 다시 넣지 않습니다. 초기화는 **하나의 트랜잭션**으로 처리하고, 동시에 시작한 PC는 PostgreSQL advisory lock으로 직렬화합니다. 도중에 실패하면 반쯤 적재된 DB가 남지 않습니다.
- 테이블은 외래 키·CHECK 제약·인덱스를 가지며, 날짜/시각은 기존 API와 호환되는 ISO 문자열로 보관합니다. `COUNT`/`SUM`의 BIGINT·NUMERIC 결과는 JS 숫자로 변환합니다.
- 카탈로그의 컬럼/기본키/행 수는 `pg_catalog`와 실제 테이블/뷰에서 조회합니다.
- **여러 PC 공유 시 유의점**: 감시 스케줄러는 각 PC의 서버에서 실행되고 `(agent_id, slot)` 고유 제약으로 같은 예정 시각의 중복 실행을 막습니다. 다만 서버를 시작할 때 `running` 상태의 감시 실행을 모두 중단 처리하므로, 다른 PC에서 실행 중인 감시가 있으면 오류로 표시될 수 있습니다.

## 환경 설정

프로젝트 `.env` 예시입니다. API 키와 DB 비밀번호는 Git에 올리지 마세요. `.env`는 `.gitignore`에 포함되어 있지만 **`.env.example`은 추적 대상이므로 실제 키를 넣으면 안 됩니다.**

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

로컬 PostgreSQL을 쓰려면 `DATABASE_URL` 대신 `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`를 설정합니다.

SSL: 원격 호스트는 기본적으로 암호화 연결을 사용하지만 인증서 체인은 검증하지 않습니다(`DB_SSL=require`와 같음). 로컬(`127.0.0.1`, `localhost`)은 기본 SSL 없음이며 `DB_SSL=false|require`로 바꿀 수 있습니다. 서버 인증서를 검증하려면 Supabase 대시보드(Database Settings → SSL Configuration)에서 CA 인증서를 받아 `DB_SSL_CA`에 경로를 지정하세요.

DB 접속 정보/키를 변경했으면 서버를 재시작하세요. DB에 연결되지 않으면 API는 시작 오류를 표시하며 SQLite로 대체하지 않습니다.

## DB 관리

```bash
npm run db:seed           # 스키마/샘플 준비 또는 기존 DB 확인
```

DBeaver 등 클라이언트는 Supabase **Connect**의 Session pooler 값(Host, Port 5432, Database `postgres`, User `postgres.<project-ref>`, Password)으로 연결합니다. `psql`을 쓸 수 있으면 `psql "$DATABASE_URL"`로 직접 확인할 수 있습니다.

DB를 처음 상태로 되돌리려면 이 앱이 만든 테이블과 뷰만 삭제한 뒤 서버를 다시 시작하세요. Supabase의 `public` 스키마 전체를 삭제하지 마세요.

## 기존 SQLite 데이터 이관 (선택)

이관은 **비어 있는 PostgreSQL DB를 처음 준비할 때만** 지원합니다. API/개발 서버를 종료한 상태에서 `.env`에 원본 파일 경로를 추가하세요.

```dotenv
DB_IMPORT_SQLITE=data/hyundai-dw.sqlite
```

그다음 실행하세요.

```bash
npm run db:seed
npm run dev
```

SQLite 원본은 읽기 전용으로 열고 기존 테이블 데이터를 PostgreSQL에 일괄 적재합니다. 고객/주문/결제/앱/예산/캠페인/설정/메타데이터를 가져오며 원본을 변경하지 않습니다. 기존 원본은 최신 SQLite 버전의 프로젝트에서 과거 이력 보강까지 완료된 DB를 사용하세요. 원본 값 그대로 가져오므로 원본에 없는 과거 이력을 임의 추가하지 않습니다.

이미 DB에 `seed_info`가 있으면 기존 DB를 보존하고 재이관하지 않습니다. 이관을 새로 시험하려면 기존 DB를 삭제하기보다 **별도의 빈 DB(다른 Supabase 프로젝트 또는 로컬 DB)**를 준비하세요. 이관 후 `DB_IMPORT_SQLITE` 설정은 제거해도 됩니다.

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

질문은 규칙 검사와 모델의 범위 검사를 거칩니다. 개인정보·지침 우회·DB 변경·무관한 요청은 차단합니다. LLM에 SQL 실행 권한/도구나 원본 고객 행을 제공하지 않으며 **질문과 PostgreSQL 집계값만 OpenAI로 전송**합니다. Responses API 구조화 응답과 `store: false`를 사용합니다. 모델명 기본값은 `gpt-4.1-mini`입니다.

점포별 순위/비중/전년 동기, 채널/상품군/고객등급, 월별 추이, 캠페인/예산/앱 근거를 전달합니다. 화면의 검증 표와 차트는 모델 생성 숫자가 아닌 서버 집계입니다. 보유한 점포 데이터를 “미제공”이라고 쓰는 알려진 모순은 한 번 재검토하고, 계속 모순되면 오류 처리합니다. 모든 자연어의 오류나 우회를 완벽하게 검증하는 장치는 아닙니다.

예측은 기준 연도 월별 일평균에 완전히 보유한 월의 전년 대비 성장률(±20% 제한)을 적용합니다. 미보유 월은 전년 동월 또는 보유 기간 평균으로 대체하며, 부분 월과 보유 일수를 표시합니다. 보수/낙관은 ±15% 가정이고 신뢰구간이 아닙니다. 이벤트 증가율 0~20%는 사용자가 정한 가정이지 실제 인과 효과 추정이 아닙니다.

서버당 동시 1건, 분당 6건, 외부 호출당 45초 제한입니다. 범위 검사·보고서·필요 시 정정으로 최대 세 번 호출할 수 있습니다. 키가 없으면 실제 LLM 호출을 하지 않습니다. 공용 서비스로 공개할 때는 사용자 인증과 사용자별 사용량 제어를 추가해야 합니다.

## 개발 및 검증

```bash
npm run dev             # DB 준비 → API + Vite
npm run build           # TypeScript 검사 + 프론트엔드 빌드
npm start               # API + 빌드 화면: http://localhost:3001
npm test                # 격리된 메모리 테스트 픽스처의 로직/정합성 검사
npm run test:pg         # 실제 PostgreSQL의 쿼리/API/제약/RLS/집계 검사
```

`npm test`의 격리 픽스처와 최초 샘플 생성기는 기존 생성 로직을 재사용하기 위해 Node 내장 SQLite를 **메모리에서만** 사용합니다. 웹 서비스의 저장/조회에는 SQLite를 사용하지 않습니다. `test:pg`는 실제 PostgreSQL 없이는 성공하지 않으며 DB 데이터를 삭제하지 않지만, 분석 앱·감시 같은 테스트 데이터를 만들고 정리하므로 **팀이 함께 쓰는 Supabase DB가 아닌 로컬 PostgreSQL이나 별도 프로젝트**에서 실행하세요(`DB_*` 환경 변수로 지정). 설정 변경 테스트는 원래 값을 복구하고 FK 오류 테스트는 롤백합니다. 모델 응답 테스트는 대역을 사용하므로 OpenAI 비용이 발생하지 않습니다.

프로덕션 빌드 검증과 실제 PostgreSQL(서비스 컨테이너) 통합 검사를 GitHub Actions에서도 실행합니다.

```text
server/db.mjs             # pg 연결 풀, 비동기 SQL, 초기화/일괄 적재
server/schema.sql         # PostgreSQL 테이블/FK/인덱스/뷰
server/config.mjs         # 서버 환경 파일 로딩
server/fixtures/          # 격리된 샘플 생성기/선택적 SQLite 읽기 전용 이관
server/analytics.mjs      # 분석 SQL
server/evidence.mjs       # LLM에 전달하는 집계 근거
server/custom.mjs         # 질문 제한, 예측, OpenAI 분석
src/                      # React 화면
```

주요 API: `/api/health`, `/api/bootstrap`, `/api/analytics`, `/api/orders`, `/api/catalog`, `/api/export`, `PATCH /api/settings`, `/api/custom/status`, `POST /api/custom/analyze`.
