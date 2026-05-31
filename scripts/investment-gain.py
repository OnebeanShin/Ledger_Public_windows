#!/usr/bin/env python3
"""투자 평가손익(미실현) 계산기.

취득원가(KRW) = Σ 각 매수 로트(수량 × USD 단가 × 매수일 환율).
환율 규칙: prices.journal 의 USD/KRW 가격을 사용한다.
  - 매수일에 환율이 있으면 그 값을 사용.
  - 없으면 날짜상 가장 가까운(절대 일수 차 최소) 환율을 사용.
평가손익 = 현재 평가액(--value=now,KRW) − 취득원가(KRW).

실행: 저장소 루트에서  python3 scripts/investment-gain.py
"""
import re
import subprocess
import sys
from datetime import date

JOURNAL = "main.journal"
PRICES = "prices.journal"


def run(args):
    return subprocess.run(
        ["hledger", "-f", JOURNAL] + args,
        capture_output=True, text=True, check=True,
    ).stdout


def load_fx():
    fx = {}
    with open(PRICES, encoding="utf-8") as f:
        for ln in f:
            m = re.match(r"^P\s+(\d{4}-\d{2}-\d{2})\s+[\d:]+\s+USD\s+([\d.]+)\s+KRW", ln)
            if m:
                fx[date.fromisoformat(m.group(1))] = float(m.group(2))
    if not fx:
        raise SystemExit("prices.journal 에서 USD/KRW 환율을 찾지 못했습니다.")
    return fx


def nearest_fx(fx, d):
    dd = date.fromisoformat(d)
    if dd in fx:
        return fx[dd], "exact"
    best = min(fx, key=lambda k: abs((k - dd).days))
    return fx[best], f"nearest {best.isoformat()}"


def parse_lots(text):
    lots, cur = [], None
    for ln in text.splitlines():
        h = re.match(r"^(\d{4}-\d{2}-\d{2})", ln)
        if h:
            cur = h.group(1)
            continue
        m = re.search(r"(assets:investment:\S+)\s+\S+\s+([\d.]+)\s*\{USD\s+([\d.]+)\}", ln)
        if m and cur:
            lots.append((cur, m.group(1), float(m.group(2)), float(m.group(3))))
    return lots


def parse_value(text):
    v = {}
    for ln in text.splitlines():
        m = re.match(r"^([\d.]+)\s+KRW\s+(assets:investment:\S+)", ln)
        if m:
            v[m.group(2)] = float(m.group(1))
    return v


def main():
    # 선택 인자: as-of 종료일(YYYY-MM-DD, hledger -e 와 동일한 배타적 종료).
    # 주면 그 기준 월말 평가(--value=end)와 그 이전 매수 로트만 사용. 없으면 현재가(--value=now).
    asof = next((a for a in sys.argv[1:] if re.match(r"^\d{4}-\d{2}-\d{2}$", a)), None)

    print_args = ["print", "assets:investment"]
    val_args = ["balance", "assets:investment", "--flat", "--no-total"]
    if asof:
        print_args += ["-e", asof]
        val_args += ["--value=end,KRW", "-e", asof]
    else:
        val_args += ["--value=now,KRW"]

    fx = load_fx()
    lots = parse_lots(run(print_args))
    val = parse_value(run(val_args))

    cost = {}
    for d, acct, qty, usd in lots:
        rate, _ = nearest_fx(fx, d)
        cost[acct] = cost.get(acct, 0) + qty * usd * rate

    print(f"{'종목':<32}{'취득원가(KRW)':>18}{'평가액(KRW)':>18}{'평가손익(KRW)':>18}{'수익률':>8}")
    tc = tv = 0.0
    for acct in sorted(set(list(cost) + list(val))):
        c, v = cost.get(acct, 0.0), val.get(acct, 0.0)
        g = v - c
        tc += c
        tv += v
        r = (g / c * 100) if c else 0.0
        print(f"{acct:<32}{c:>18,.0f}{v:>18,.0f}{g:>+18,.0f}{r:>7.1f}%")
    print(f"{'합계':<32}{tc:>18,.0f}{tv:>18,.0f}{tv - tc:>+18,.0f}{((tv - tc) / tc * 100) if tc else 0:>7.1f}%")


if __name__ == "__main__":
    main()
