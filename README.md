# Ledger (Windows) — hledger 가계부 + 웹 대시보드 + AI 회계사

자연어로 기록하고, 웹에서 보는 개인 가계부 배포판 (Windows용).

- **hledger**(플레인 텍스트 복식부기 회계)로 데이터를 저장하고,
- **웹 대시보드(webui)** 로 요약·거래·분석·투자·결산을 시각적으로 조회하며,
- **`AGENTS.md`** 를 AI 도구에 물려 *"어제 점심 9천 원 썼어"* 같은 **자연어를 회계 거래로** 자동 기록한다.

> 데이터는 전부 **내 컴퓨터의 텍스트 파일**(`*.journal`)에 저장됩니다. 외부 전송 없음.

## 요구사항
- **Windows 10/11** + **Python 3.10+** (python.org 설치 시 *"Add Python to PATH"* 체크)
- **hledger** 1.30 이상 — `-O json` 지원 필요
- **Flask** (Python 패키지)
- (선택) **pricehist** — 주식/코인 시세 자동 갱신용

## 설치
```bat
REM 1) hledger 설치 (택1)
REM   - scoop:  scoop install hledger
REM   - choco:  choco install hledger
REM   - 또는 공식 Windows 바이너리(hledger.org)를 PATH에 추가

REM 2) 웹 대시보드 의존성 설치
cd webui
python -m pip install -r requirements.txt

REM 3) (선택) 시세 자동 갱신 도구
python -m pip install pricehist
```
> `python` 명령이 없으면 `py` 를 사용하세요(예: `py -m pip install ...`).

## 빠른 시작
- **`webui\run.bat`** 를 더블클릭 (또는 명령창에서 실행)
- 또는 PowerShell: `webui\run.ps1`

자동으로 브라우저에서 **http://127.0.0.1:5001** 가 열립니다. (포트 변경: `set PORT=5002` 후 실행)

## 가계부 쓰는 법
### 방법 A — 직접 편집
`2026.journal`(올해 파일)에 거래를 추가한다. 형식은 파일 안 예시 참고. 새 연도는 `YYYY.journal`을 만들고
`main.journal`에 `include YYYY.journal` 한 줄 추가.

### 방법 B — 자연어(AI 회계사) ★추천
이 폴더(특히 `AGENTS.md`)를 **파일 접근이 되는 AI 도구**(Claude Code/Codex/Kiro 등)에 컨텍스트로 준 뒤
자연어로 말하면 된다.
- "어제 마트에서 3만 2천 원 장 봤어" → `expenses:food:grocery` 거래로 기록
- "월급 250 들어왔어" → `income:salary` 거래로 기록
AI는 `AGENTS.md` 규칙대로 복식부기로 기록하고 `hledger check`로 검증한다.

## 투자 시세 (선택)
주식/코인을 `{USD 190.00}` 처럼 매수 단가와 함께 기록했다면:
```bat
python scripts\update-prices.py       REM prices.journal 자동 갱신(pricehist 필요)
python scripts\investment-gain.py     REM 평가손익(매수일 환율 기준)
```

## 폴더 구조
```
Ledger_windows\
├── AGENTS.md            AI 회계사 운영 매뉴얼(자연어 기록 규칙)
├── README.md            이 문서
├── main.journal         시작 파일(연도/시세 파일 include)
├── 2026.journal         올해 거래 (예시 데이터 → 본인 것으로 교체)
├── prices.journal       자동 생성 시세
├── scripts\
│   ├── update-prices.py     시세 갱신(Yahoo Finance, pricehist · 크로스플랫폼)
│   └── investment-gain.py   평가손익 계산
└── webui\               웹 대시보드 (Flask + 정적 모듈)
    ├── run.bat / run.ps1    Windows 실행기
    └── README.md            대시보드 상세 문서
```

## 결산 탭 (선택)
대시보드의 **결산** 탭은 `webui\report\<YYYY-MM>\` 폴더에 넣어둔 월별 리포트(`*.html`)를 보여줍니다.
리포트가 없으면 빈 상태로 표시되며(정상), HTML 리포트를 만들어 해당 경로에 두면 자동으로 목록에 나타납니다.

## 보안
- 웹 서버는 기본적으로 **로컬(127.0.0.1)** 만 허용하도록 실행기가 `WEBUI_HOST=127.0.0.1` 로 띄웁니다.
- 같은 네트워크의 다른 기기에서 접근하려면 `set WEBUI_HOST=0.0.0.0` + `set WEBUI_ALLOWED_CLIENT_NETWORKS=...`(허용 대역)을 직접 지정하세요(주의).
- 가계부 데이터는 로컬 텍스트 파일에만 저장되며 어디로도 전송되지 않는다.

## 자동 시작 (선택, Windows)
부팅 시 자동 실행이 필요하면 **작업 스케줄러(Task Scheduler)** 에 "로그온 시 `webui\run.bat` 실행" 작업을 추가하세요.
(또는 시작프로그램 폴더 `shell:startup` 에 `run.bat` 바로가기를 둠)

## 처음 시작 시
1. `2026.journal`의 **예시 거래를 지우고** 본인 기초 잔액·거래로 시작.
2. 기준 통화가 KRW가 아니면 거래·`AGENTS.md`의 통화를 바꾸고, **대시보드 기준통화**도 지정:
   ```bat
   set LEDGER_BASE_CURRENCY=USD
   webui\run.bat
   ```
   (기본값 KRW. 요약·대차대조표·예금잔액이 이 통화 기준으로 집계됩니다.)
3. 계정 분류는 `AGENTS.md`의 예시를 참고해 본인에 맞게 확장.

## 참고
- 이 배포판에는 **개인 금융 데이터가 포함되어 있지 않습니다**(샘플 예시만 제공).
- 웹 대시보드 UI는 한국어입니다. Chart.js는 동봉(오프라인 동작).
- 앱·시세 스크립트는 순수 파이썬이라 macOS/Linux에서도 동일하게 동작합니다(실행기만 OS별로 다름).
