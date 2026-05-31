# hledger 가계부 웹 대시보드 실행기 (Windows PowerShell)
if (-not $env:PORT) { $env:PORT = "5001" }
if (-not $env:WEBUI_HOST) { $env:WEBUI_HOST = "127.0.0.1" }

$webui = Split-Path -Parent $MyInvocation.MyCommand.Path

# (선택) 시세 갱신 - pricehist 설치 시
try { python (Join-Path $webui "..\scripts\update-prices.py") } catch { }

Set-Location $webui
Write-Host "hledger Dashboard: http://127.0.0.1:$($env:PORT)"
Start-Process "http://127.0.0.1:$($env:PORT)"
python app.py
