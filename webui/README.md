# hledger Web Dashboard

로컬 hledger 원장 데이터를 브라우저에서 조회하는 읽기 전용 대시보드.

## 요구사항

- Python 3.10 이상
- hledger 1.30 이상 (`-O json` 지원 필요)
- Flask (`pip3 install flask`)

## 빠른 시작

```bat
REM 의존성 설치 (최초 1회)
python -m pip install -r requirements.txt

REM 서버 실행 + 브라우저 열기 (시세 갱신 포함)
run.bat
```
또는 PowerShell: `.\run.ps1` · 수동: `python app.py` 후 브라우저에서 http://127.0.0.1:5001 접속.

## 다른 위치에서 실행하기

`webui\` 폴더는 원장 파일과 같은 디렉토리에 있지 않아도 된다.
환경변수로 원장 경로를 지정하면 어디서든 실행 가능하다.

```bat
REM 원장 파일 경로만 지정하면 prices.journal, scripts\는 자동으로 같은 디렉토리에서 찾음
set LEDGER_FILE=C:\Users\사용자명\Documents\Ledger_windows\main.journal
run.bat
```

| 환경변수 | 설명 | 기본값 |
|----------|------|--------|
| `LEDGER_FILE` | main.journal 경로 | `../main.journal` (상대 경로) |
| `LEDGER_PRICES_FILE` | prices.journal 경로 | `LEDGER_FILE`과 같은 디렉토리 |
| `LEDGER_SCRIPTS_DIR` | scripts/ 디렉토리 경로 | `LEDGER_FILE`과 같은 디렉토리 |

## 기능

### 요약 탭

전체 재정 상태를 한눈에 보여준다.

- 예금 잔액
  전월 동기 또는 전월 말 대비 증감 표시
- 이달 수입 / 지출 (전월 동기 대비 지출 증감 표시)
- 투자 수익률
- 자산 구성 도넛 차트 (현금 / BTC / 보유 투자 종목 자동 반영)
- 부채 · 부채비율 · 순자산 요약
- 수입/지출 카테고리별 내역 (비율 막대)
- 최근 거래 10건

### 거래 탭

모든 거래 내역을 조회한다.

- 기간 필터: 전체, 이번 달, 지난 달, 올해
- 계정 필터: 드롭다운으로 특정 계정 선택
- 텍스트 검색: 설명 또는 계정명으로 필터링
- 각 거래의 금액과 누적 잔액(예금+현금) 표시
- 복식부기 토글: 모든 포스팅을 원본 그대로 확인 가능

### 분석 탭

네 가지 하위 보고서를 제공한다. (탭 이름은 "분석")

**손익계산서**: 수입과 지출 항목별 요약 + 카테고리별 막대 차트.
기간 선택 가능 — 이번 달, 지난 달, 특정 월(2026-03 등), 특정 연도(2026 등).

**대차대조표**: 자산, 부채, 순자산을 KRW 환산 기준으로 표시.

**지출 분석**: 카테고리별 비율 도넛 차트 + 일별 지출 추이 바 차트.
손익계산서와 동일한 기간 선택 가능.

**계정** : 계정(account) 체계를 트리 형태로 탐색한다.
- 계정 노드 펼치기/접기 토글
- 각 계정의 원본 통화 잔액 표시
- KRW가 아닌 계정은 환산 금액도 병렬 표시
- 계정을 클릭하면 오른쪽 패널에 해당 계정의 거래 내역 표시

### 결산 탭

`webui/report/<YYYY-MM>/`에 생성된 월간 결산 리포트(HTML)를 webui 안에서 열람한다.

- **연도 / 월 토글 버튼**으로 월을 선택하면 해당 리포트가 표시된다 (진입 시 최신 연도·월 자동 표시).
- 리포트는 자체 디자인을 가진 단독 HTML이라 **iframe**으로 격리 표시하며, 화면을 꽉 채운다.
- 우측에 **따라다니는 목차(TOC)** — 리포트의 h2/h3에서 자동 생성, 클릭 시 해당 섹션으로 스크롤 이동 + 현재 섹션 하이라이트(scrollspy).
- webui 기본 배경을 리포트와 동일한 `#f5f4ed`로 맞춰 이음새 없이 통합된다.

### 투자 탭

`prices.journal`의 시세 데이터를 기반으로 투자 자산을 분석한다.
자산 표시 순서: BTC 우선, 그 외 보유 투자 commodity는 알파벳순.

- 총 투자원금 / 현재 평가액 / 수익률 요약 카드
- 자산별 상세 테이블: 보유 수량, 취득단가(USD), 현재가(USD), 취득원가(KRW), 평가액(KRW), 손익, 수익률
- 자산 배분 도넛 차트
- 시세 추이 라인 차트 (종목 선택 가능: BTC, 보유 투자 commodity, USD/KRW, 총 평가액)
- 최신 시세 정보 + **시세 갱신** 버튼 (`scripts/update-prices.py` 실행; 스크립트가 `assets:investment` 거래에서 투자 commodity를 자동 탐지)
  갱신 성공 시 hledger 캐시를 즉시 비워 최신 시세가 반영되도록 한다.

## 아키텍처

### 데이터 흐름

```
브라우저 (SPA)
    ↕ fetch() / JSON
Flask 백엔드 (app.py)
    ↕ subprocess (캐시 · 병렬 실행)
hledger CLI → main.journal (+ prices.journal)
```

- 모든 데이터는 hledger CLI의 `-O json` 출력을 파싱해서 사용한다.
- 투자 수익률 계산만 `prices.journal`을 직접 파싱한다.
- 원장 파일을 수정하는 기능은 없다. 유일한 쓰기 동작은 시세 갱신 버튼뿐이다.

### 백엔드 성능

- **hledger 캐시**: 저널 파일 mtime 기반 `lru_cache`. 파일이 변경되지 않으면 동일 쿼리를 subprocess 없이 즉시 반환한다.
- **병렬 실행**: `/api/summary` 엔드포인트는 독립적인 hledger 호출 7건을 `ThreadPoolExecutor`로 동시 실행한다 (`run_independent`).

### 보안

- **입력 검증**: 계정명, 기간, 날짜 파라미터를 정규표현식으로 사전 검증하여 쉘 인젝션을 차단한다 (`_validate_account`, `_validate_period`, `_validate_date`).
- **XSS 방어**: 모든 innerHTML 템플릿에서 사용자 데이터(거래 설명, 계정명, 날짜 등)를 `escapeHtml()`로 escape 처리한다.
- **에러 처리**: Flask 전역 에러 핸들러가 모든 예외를 포착한다. `ValueError`(400), `RuntimeError`(500)은 에러 메시지를 반환하고, 미처리 예외는 서버 로그에만 상세를 기록하고 클라이언트에는 일반 메시지만 반환한다.
- **Toast 알림**: 프론트엔드에서 API 오류 발생 시 사용자에게 토스트 알림으로 안내한다.

### 프론트엔드 구조

빌드 도구 없이 ES module(`import`/`export`)로 구성된다.

- `main.js` — 탭 전환, View Transitions 애니메이션, 각 탭 로더 호출
- `api.js` — `fetch()` 래퍼 (JSON 파싱, 에러 처리)
- `ui.js` — Toast 알림, 탭 에러 렌더링 등 공통 UI 유틸리티
- `formatters.js` — KRW 포맷, 퍼센트, 금액 표시, HTML escape 등 순수 포맷터
- `summary.js` — 요약 탭 렌더링 + 자산 배분 차트
- `transactions.js` — 거래 탭 렌더링 (포스팅 통합/복식부기 모드)
- `reports.js` — 분석 탭 (손익계산서, 대차대조표, 지출 분석 + 차트)
- `accounts.js` — 계정 트리 렌더링 + 계정 상세 패널
- `portfolio.js` — 투자 탭 렌더링 + 시세 차트/갱신
- `settlement.js` — 결산 탭 (월별 리포트 iframe 뷰어, 연도/월 토글, 우측 목차/scrollspy)
- `charts.js` — Chart.js 설정, 도넛 외부 라벨 플러그인, 색상 상수
- `category-breakdown.js` — 카테고리 그룹핑/정렬/툴팁 유틸리티

## 파일 구조

```
webui/
├── app.py                  Flask 서버 진입점 (라우팅, 에러 핸들링, 병렬 실행)
├── hledger_api.py          hledger CLI JSON 래퍼 (캐시, 입력 검증, 데이터 변환)
├── investment.py           투자 수익률 계산 (prices.journal 파싱)
├── requirements.txt        Python 의존성
├── run.bat                 Windows 실행기 (시세 갱신 + 서버 + 브라우저)
├── run.ps1                 Windows PowerShell 실행기
├── static/
│   ├── style.css               레트로 스타일 + View Transitions 애니메이션
│   ├── main.js                 ES module 진입점 (탭 전환)
│   ├── api.js                  fetch 기반 API 클라이언트
│   ├── ui.js                   Toast 알림, 에러 렌더링 공통 UI
│   ├── formatters.js           포맷터 + escapeHtml
│   ├── summary.js              요약 탭
│   ├── transactions.js         거래 탭
│   ├── reports.js              분석 탭
│   ├── accounts.js             계정 탭
│   ├── portfolio.js            투자 탭
│   ├── settlement.js           결산 탭 (월별 리포트 뷰어 + 목차)
│   ├── charts.js               Chart.js 설정 + 플러그인
│   ├── category-breakdown.js   카테고리 그룹핑 유틸리티
│   ├── favicon.svg             파비콘 (SVG)
│   ├── favicon-32x32.png       파비콘 (32px)
│   ├── favicon-192x192.png     파비콘 (192px)
│   ├── apple-touch-icon.png    iOS 홈화면 아이콘
│   └── logo.svg                헤더 로고
├── templates/
│   └── index.html              단일 페이지 HTML 셸
├── report/                     월별 결산 리포트 (YYYY-MM/*.html) + plan/ (지시서·계획)
└── tests/
    ├── test_hledger_cache.py       hledger 캐시 동작 테스트
    ├── test_hledger_parallel.py    병렬 실행 동등성 테스트
    └── test_static_modules.py      JS 모듈 구문 검사
```

## API 엔드포인트

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/` | GET | 메인 HTML 페이지 |
| `/api/summary` | GET | 대시보드 요약 (대차대조표 + 손익 + 포트폴리오, 병렬 처리) |
| `/api/transactions?period=&account=` | GET | 거래 내역 (예금 잔액 + 누적 잔액 첨부) |
| `/api/income-statement?period=&monthly=true` | GET | 손익계산서 |
| `/api/balance-sheet` | GET | 대차대조표 (KRW 환산) |
| `/api/accounts` | GET | 계정 트리 + 원본/KRW 잔액 |
| `/api/accounts/<name>/register` | GET | 특정 계정 거래 내역 |
| `/api/periods` | GET | 거래가 존재하는 월/연도 목록 |
| `/api/portfolio` | GET | 투자 포트폴리오 (수익률 계산 포함) |
| `/api/prices` | GET | prices.journal 시계열 데이터 |
| `/api/prices/update` | POST | 시세 갱신 스크립트 실행 (성공 시 캐시 무효화) |
| `/api/reports` | GET | 결산 리포트 목록 (`webui/report/<YYYY-MM>/` 스캔, 최신순) |
| `/report/<month>/<filename>` | GET | 결산 리포트 HTML 서빙 (month 정규식 검증 + 경로탈출 방지) |

`period` 파라미터는 hledger 기간 표현을 그대로 사용한다: `thismonth`, `lastmonth`, `thisyear`, `2026-03`, `2026` 등.

## 테스트

```bash
cd webui
python3 -m pytest tests/ -v
```

| 테스트 | 검증 내용 |
|--------|----------|
| `test_hledger_cache.py` | mtime 기반 캐시 적중/무효화, `clear_hledger_cache()` |
| `test_hledger_parallel.py` | `run_independent` 병렬 결과와 순차 결과 동등성 |
| `test_static_modules.py` | `node --check`로 모든 JS 모듈 구문 검사 |
| `test_access_control.py` | 로컬 PC/Tailscale 허용 및 같은 Wi‑Fi의 다른 기기 차단 |

## 참고

- 서버는 `127.0.0.1`, 이 Mac의 자체 LAN IP, Tailscale 대역만 허용한다. 같은 Wi‑Fi의 다른 기기는 앱 입구에서 `403`으로 차단된다. (결산 리포트 서빙 라우트도 동일하게 적용)
- 결산 탭의 리포트는 `webui/report/<YYYY-MM>/`의 HTML이며, 월간 리포트 생성 지시서는 `webui/report/plan/MONTHLY-REPORT-INSTRUCTIONS.md`에 있다.
- webui 기본 배경은 결산 리포트와 동일한 `#f5f4ed`로 통일되어 있다.
- Chart.js·treemap 플러그인은 `static/vendor/`에 동봉되어 있어 **오프라인에서도 차트가 정상 표시**된다(CDN 의존 없음).
- `run.bat`/`run.ps1`은 시세 갱신 실패를 무시하고 서버를 실행한다 (pricehist가 없어도 동작).
