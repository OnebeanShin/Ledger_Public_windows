#!/usr/bin/env python3
"""시세 갱신 (크로스플랫폼: Windows/macOS/Linux).

기존 update-prices.sh(zsh)의 파이썬 포팅판.
- hledger 로 assets:investment 의 commodity(심볼)를 자동 탐지
- pricehist 로 Yahoo 종가/환율을 가져와 prices.journal 갱신(기존 P줄과 병합·중복제거·정렬)

필요: hledger, pricehist (pip install pricehist).
환경변수:
  LEDGER_FILE            main.journal 경로(기본: 이 스크립트 상위 폴더/main.journal)
  LEDGER_BASE_CURRENCY   기준 통화(기본 KRW) — 환율 심볼 결정에 사용
  PRICEHIST_BIN          pricehist 실행파일 경로(직접 지정 시)
"""
import os
import re
import shutil
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN_FILE = os.environ.get("LEDGER_FILE", str(ROOT / "main.journal"))
OUTPUT_FILE = ROOT / "prices.journal"
BASE_CURRENCY = os.environ.get("LEDGER_BASE_CURRENCY", "KRW")

_P_RE = re.compile(r"^P\s+(\S+)(?:\s+\S+)?\s+(\S+)\s+[\d.]+\s+(\S+)\s*$")


def resolve_pricehist():
    candidates = [
        os.environ.get("PRICEHIST_BIN"),
        str(ROOT / ".venv-pricehist" / "Scripts" / "pricehist.exe"),  # Windows venv
        str(ROOT / ".venv-pricehist" / "bin" / "pricehist"),          # POSIX venv
        shutil.which("pricehist"),
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    return None


def detect_symbols():
    """assets:investment 거래에서 기준통화/USD 가 아닌 commodity 목록(BTC 우선)."""
    import json
    try:
        raw = subprocess.check_output(
            ["hledger", "-f", MAIN_FILE, "print", "assets:investment", "-O", "json"],
            text=True, stderr=subprocess.PIPE,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        sys.stderr.write(f"심볼 탐지 실패(hledger): {exc}\n")
        return []
    symbols = set()
    for txn in json.loads(raw):
        for posting in txn.get("tpostings", []):
            if not posting.get("paccount", "").startswith("assets:investment"):
                continue
            for amount in posting.get("pamount", []):
                c = amount.get("acommodity")
                if c and c not in {BASE_CURRENCY, "USD"}:
                    symbols.add(c)
    return sorted(symbols, key=lambda s: (s != "BTC", s))


def fetch_price(pricehist, symbol, start, end, extra):
    try:
        out = subprocess.run(
            [pricehist, "fetch", "yahoo", symbol, "-t", "close",
             "-s", start, "-e", end, "-o", "ledger", *extra],
            capture_output=True, text=True, timeout=60,
        ).stdout
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"시세 조회 실패({symbol}): {exc}\n")
        return None
    lines = [ln for ln in out.splitlines() if ln.startswith("P ")]
    return lines[-1] if lines else None


def main():
    pricehist = resolve_pricehist()
    if not pricehist:
        sys.stderr.write(
            "pricehist 를 찾지 못했습니다. 'pip install pricehist' 후 다시 시도하거나 "
            "PRICEHIST_BIN 으로 경로를 지정하세요. (시세 갱신 건너뜀)\n"
        )
        return 0

    start = (date.today() - timedelta(days=7)).isoformat()
    end = date.today().isoformat()

    new_lines = []
    symbols = detect_symbols()
    if symbols:
        print(f"투자 commodity 시세 갱신: {', '.join(symbols)}")
    else:
        print(f"투자 commodity 없음({MAIN_FILE}) — 환율만 갱신")
    for sym in symbols:
        if sym == "BTC":
            line = fetch_price(pricehist, "BTC-USD", start, end,
                               ["--fmt-base", "BTC", "--fmt-quote", "USD"])
        else:
            line = fetch_price(pricehist, sym, start, end, [])
        if line:
            new_lines.append(line)

    # 환율(USD/기준통화) — 기준통화가 USD가 아니면 갱신
    if BASE_CURRENCY != "USD":
        fx = fetch_price(pricehist, f"{BASE_CURRENCY}=X", start, end,
                         ["--fmt-base", "USD", "--fmt-quote", BASE_CURRENCY])
        if fx:
            new_lines.append(fx)

    # 기존 P줄 + 신규 병합 → (날짜,심볼,통화) 키로 최신만, 정렬
    merged = {}
    if OUTPUT_FILE.exists():
        for ln in OUTPUT_FILE.read_text(encoding="utf-8").splitlines():
            m = _P_RE.match(ln)
            if m:
                merged[m.groups()] = ln
    for ln in new_lines:
        m = _P_RE.match(ln)
        if m:
            merged[m.groups()] = ln

    body = "\n".join(sorted(merged.values()))
    OUTPUT_FILE.write_text(
        "; Auto-generated market prices.\n; Updated by scripts/update-prices.py\n\n"
        + body + ("\n" if body else ""),
        encoding="utf-8",
    )
    print(f"prices.journal 갱신 완료 ({len(merged)}개 가격).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
