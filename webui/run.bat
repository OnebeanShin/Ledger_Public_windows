@echo off
REM hledger 가계부 웹 대시보드 실행기 (Windows)
setlocal
if "%PORT%"=="" set "PORT=5001"
if "%WEBUI_HOST%"=="" set "WEBUI_HOST=127.0.0.1"

REM (선택) 시세 갱신 - pricehist 설치 시. 없으면 조용히 건너뜀.
python "%~dp0..\scripts\update-prices.py" 2>nul

cd /d "%~dp0"
echo hledger Dashboard: http://127.0.0.1:%PORT%
start "" "http://127.0.0.1:%PORT%"
python app.py
