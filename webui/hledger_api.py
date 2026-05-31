"""Wrapper around the hledger CLI that returns parsed JSON."""

import copy
import glob
import json
import os
import re
import shlex
import subprocess
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

_DEFAULT_JOURNAL = str(Path(__file__).resolve().parent.parent / "main.journal")
JOURNAL_FILE = os.environ.get("LEDGER_FILE", _DEFAULT_JOURNAL)
BASE_CURRENCY = os.environ.get("LEDGER_BASE_CURRENCY", "KRW")

# ── Input validation ──────────────────────────────────────

# hledger 계정명 허용 패턴: 영문자, 숫자, 콜론(:), 하이픈(-), 언더스코어(_),
# 한글, 점(.) 허용. 플래그(-로 시작)는 명시적으로 차단.
_ACCOUNT_PATTERN = re.compile(
    r"^[\w가-힣:][\w가-힣:.\-]*$",
    re.UNICODE,
)

# hledger period 허용 패턴: 영문 키워드(thismonth, lastmonth, thisyear 등),
# YYYY-MM-DD..YYYY-MM-DD 형태의 날짜 범위, YYYY-MM, YYYY 연도만.
_PERIOD_PATTERN = re.compile(
    r"^"
    r"(?:"
    r"thismonth|lastmonth|thisweek|lastweek|thisyear|lastyear|today|yesterday|"
    r"\d{4}(?:-\d{2}(?:-\d{2})?)?"
    r"(?:\.\.[\d-]*)?"
    r")"
    r"$"
)

# 날짜(end 파라미터): YYYY-MM-DD 또는 YYYY-MM 형식만 허용
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}(?:-\d{2})?$")


def _validate_account(account: str | None) -> None:
    """계정명이 안전한 값인지 검증한다.

    None이면 통과 (선택적 인자). 그 외에는 허용된 문자셋과 패턴을 확인한다.
    검증 실패 시 ValueError를 발생시킨다.
    """
    if account is None:
        return
    if not isinstance(account, str) or len(account) > 200:
        raise ValueError(f"유효하지 않은 계정명입니다: {account!r}")
    # 빈 문자열은 통과 (계정 미지정)
    if account == "":
        return
    if not _ACCOUNT_PATTERN.match(account):
        raise ValueError(f"유효하지 않은 계정명입니다 (허용되지 않는 문자 포함): {account!r}")


def _validate_period(period: str | None) -> None:
    """기간 문자열이 안전한 값인지 검증한다.

    None이면 통과. 그 외에는 허용된 형식인지 확인한다.
    검증 실패 시 ValueError를 발생시킨다.
    """
    if period is None or period == "":
        return
    if not isinstance(period, str) or len(period) > 40:
        raise ValueError(f"유효하지 않은 기간 형식입니다: {period!r}")
    if not _PERIOD_PATTERN.match(period):
        raise ValueError(f"유효하지 않은 기간 형식입니다: {period!r}")


def _validate_date(end: str | None) -> None:
    """날짜 문자열(end 파라미터)이 안전한 값인지 검증한다.

    None이면 통과. 그 외에는 YYYY-MM-DD 또는 YYYY-MM 형식인지 확인한다.
    검증 실패 시 ValueError를 발생시킨다.
    """
    if end is None or end == "":
        return
    if not isinstance(end, str) or not _DATE_PATTERN.match(end):
        raise ValueError(f"유효하지 않은 날짜 형식입니다: {end!r}")


def _journal_paths_from_includes(path: Path, seen: set[Path] | None = None) -> list[Path]:
    """Return the journal file plus recursively included files, preserving discovery order."""
    resolved = path.expanduser().resolve(strict=False)
    if seen is None:
        seen = set()
    if resolved in seen:
        return []
    seen.add(resolved)

    paths = [resolved]
    try:
        lines = resolved.read_text(encoding="utf-8").splitlines()
    except OSError:
        return paths

    for line in lines:
        # hledger journal comments start with ';'. Includes are file-system paths, so
        # treat inline comments conservatively and ignore malformed directives.
        body = line.split(";", 1)[0].strip()
        if not body.startswith("include"):
            continue
        try:
            tokens = shlex.split(body)
        except ValueError:
            continue
        if len(tokens) < 2 or tokens[0] != "include":
            continue

        include_pattern = Path(tokens[1]).expanduser()
        if not include_pattern.is_absolute():
            include_pattern = resolved.parent / include_pattern
        matches = [Path(match) for match in glob.glob(str(include_pattern))]
        include_paths = matches or [include_pattern]
        for include_path in include_paths:
            paths.extend(_journal_paths_from_includes(include_path, seen))
    return paths


def get_journal_mtime_signature(journal_file: str | None = None) -> tuple[tuple[str, int | None, int | None], ...]:
    """Build a cache signature from main journal and recursively included file mtimes."""
    journal = Path(journal_file or JOURNAL_FILE)
    signature = []
    for path in _journal_paths_from_includes(journal):
        try:
            stat = path.stat()
            signature.append((str(path), stat.st_mtime_ns, stat.st_size))
        except OSError:
            signature.append((str(path), None, None))
    return tuple(signature)


@lru_cache(maxsize=128)
def _run_cached(
    args: tuple[str, ...],
    json_output: bool,
    journal_file: str,
    signature: tuple[tuple[str, int | None, int | None], ...],
) -> dict | list | str:
    del signature  # part of the lru_cache key only
    cmd = ["hledger", "-f", journal_file, *args]
    if json_output:
        cmd += ["-O", "json"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"hledger error: {result.stderr.strip()}")
    if json_output:
        return json.loads(result.stdout)
    return result.stdout


def clear_hledger_cache() -> None:
    """Clear cached hledger subprocess responses; useful for tests and manual invalidation."""
    _run_cached.cache_clear()


def _run(args: list[str], *, json_output: bool = True) -> dict | list | str:
    signature = get_journal_mtime_signature(JOURNAL_FILE)
    result = _run_cached(tuple(args), json_output, JOURNAL_FILE, signature)
    if json_output:
        return copy.deepcopy(result)
    return result


def run_independent(
    tasks: dict[str, Callable[[], Any]],
    *,
    max_workers: int | None = None,
) -> dict[str, Any]:
    """Run independent hledger-backed callables concurrently.

    hledger calls are subprocess-based and read-only here, so they can run in
    parallel without sharing mutable parser state. Each task still goes through
    the common _run cache/timeout/error path, and results are collected in the
    input dict order so the first observed failure remains deterministic.
    """
    if not tasks:
        return {}

    from concurrent.futures import ThreadPoolExecutor

    executor = ThreadPoolExecutor(max_workers=max_workers or len(tasks))
    futures = {name: executor.submit(task) for name, task in tasks.items()}
    try:
        return {name: futures[name].result() for name in tasks}
    except Exception:
        for future in futures.values():
            future.cancel()
        raise
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def _amount_value(amt: dict) -> float:
    q = amt.get("aquantity", {})
    return q.get("floatingPoint", 0)


def _amount_commodity(amt: dict) -> str:
    return amt.get("acommodity", "")


def _extract_cost_usd(amt: dict) -> float | None:
    cb = amt.get("acostbasis")
    if cb and isinstance(cb, dict):
        cost = cb.get("cbCost")
        if cost and _amount_commodity(cost) == "USD":
            return _amount_value(cost)
    cost_field = amt.get("acost")
    if cost_field and isinstance(cost_field, dict):
        if _amount_commodity(cost_field) == "USD":
            return _amount_value(cost_field)
    return None


_CASH_ACCOUNT_PREFIXES = ("assets:bank", "assets:cash", "assets:savings")
_BANK_ACCOUNT_PREFIXES = ("assets:bank",)


def _is_cash_like_account(account: str) -> bool:
    return account.startswith(_CASH_ACCOUNT_PREFIXES)


def _is_bank_account(account: str) -> bool:
    return account.startswith(_BANK_ACCOUNT_PREFIXES)


def _sum_krw_amounts(amounts: list[dict]) -> float:
    return sum(
        amount.get("quantity", 0)
        for amount in amounts
        if amount.get("commodity") == BASE_CURRENCY
    )


def _merge_amount_totals(
    amounts: list[dict],
    merged: dict[str, float],
    order: list[str],
    *,
    skip_krw: bool = False,
) -> None:
    for amount in amounts:
        commodity = amount.get("commodity", "")
        if not commodity or (skip_krw and commodity == BASE_CURRENCY):
            continue
        if commodity not in merged:
            merged[commodity] = 0
            order.append(commodity)
        merged[commodity] += amount.get("quantity", 0)


def _opening_non_cash_holdings(end: str | None) -> tuple[list[str], dict[str, float]]:
    holdings: dict[str, float] = {}
    order: list[str] = []
    rows = get_balance("assets", end=end)["rows"]
    for row in rows:
        account = row.get("account", "")
        if not account.startswith("assets:") or _is_cash_like_account(account):
            continue
        _merge_amount_totals(row.get("amounts", []), holdings, order, skip_krw=True)
    return order, holdings


def _build_cumulative_snapshot(
    deposit_balance: float,
    holding_order: list[str],
    holdings: dict[str, float],
) -> list[dict]:
    snapshot = [{
        "kind": "deposit",
        "label": "예금",
        "commodity": BASE_CURRENCY,
        "quantity": deposit_balance,
    }]
    seen = set()
    for commodity in holding_order:
        quantity = holdings.get(commodity, 0)
        if quantity:
            snapshot.append({
                "kind": "holding",
                "commodity": commodity,
                "quantity": quantity,
            })
            seen.add(commodity)
    for commodity, quantity in holdings.items():
        if commodity not in seen and quantity:
            snapshot.append({
                "kind": "holding",
                "commodity": commodity,
                "quantity": quantity,
            })
    return snapshot


def _merge_posting_amounts(postings: list[dict], *, sign: int = 1) -> list[dict]:
    merged: dict[str, float] = {}
    order: list[str] = []
    for posting in postings:
        for amount in posting.get("amounts", []):
            commodity = amount.get("commodity", "")
            if commodity not in merged:
                merged[commodity] = 0
                order.append(commodity)
            merged[commodity] += amount.get("quantity", 0) * sign
    return [
        {"commodity": commodity, "quantity": merged[commodity]}
        for commodity in order
        if merged[commodity]
    ]


def _pick_display_posting(group: list[dict]) -> tuple[str, list[dict]]:
    expenses = [p for p in group if p["account"].startswith("expenses:")]
    if expenses:
        return expenses[0]["account"], _merge_posting_amounts(expenses, sign=-1)

    income = [p for p in group if p["account"].startswith("income:")]
    if income:
        return income[0]["account"], _merge_posting_amounts(income, sign=-1)

    non_cash_assets = [
        p for p in group
        if p["account"].startswith("assets:") and not _is_cash_like_account(p["account"])
    ]
    if non_cash_assets:
        return non_cash_assets[0]["account"], _merge_posting_amounts(non_cash_assets)

    liabilities = [p for p in group if p["account"].startswith("liabilities:")]
    if liabilities:
        return liabilities[0]["account"], _merge_posting_amounts(liabilities)

    cash_like = [p for p in group if _is_cash_like_account(p["account"])]
    if cash_like:
        return cash_like[0]["account"], _merge_posting_amounts(cash_like)

    first = group[0]
    return first["account"], _merge_posting_amounts([first])


# ── public helpers ──────────────────────────────────────────────


def get_balance(
    *accounts: str,
    cost: bool = False,
    market_value: bool = False,
    convert_to: str | None = None,
    tree: bool = False,
    period: str | None = None,
    end: str | None = None,
    depth: int | None = None,
) -> list:
    for acct in accounts:
        _validate_account(acct)
    _validate_period(period)
    _validate_date(end)
    args = ["balance"]
    if cost:
        args.append("--cost")
    if market_value:
        args.append("-V")
    if convert_to:
        args += ["-X", convert_to]
    if tree:
        args.append("--tree")
    if period:
        args += ["-p", period]
    if end:
        args += ["-e", end]
    if depth is not None:
        args += ["--depth", str(depth)]
    args += list(accounts)
    raw = _run(args)
    rows, totals = raw
    result = []
    for row in rows:
        full_name, display_name, indent, amounts = row
        parsed_amounts = []
        for a in amounts:
            parsed_amounts.append({
                "commodity": _amount_commodity(a),
                "quantity": _amount_value(a),
                "cost_usd": _extract_cost_usd(a),
            })
        result.append({
            "account": full_name,
            "display": display_name,
            "indent": indent,
            "amounts": parsed_amounts,
        })
    total_amounts = []
    for a in totals:
        total_amounts.append({
            "commodity": _amount_commodity(a),
            "quantity": _amount_value(a),
        })
    return {"rows": result, "totals": total_amounts}


def get_register(
    *accounts: str,
    period: str | None = None,
    daily: bool = False,
) -> list:
    for acct in accounts:
        _validate_account(acct)
    _validate_period(period)
    args = ["register"]
    if period:
        args += ["-p", period]
    if daily:
        args.append("-D")
    args += list(accounts)
    raw = _run(args)
    txns = []
    last_date = ""
    last_desc = ""
    for entry in raw:
        date, date2, description, posting, running_total = entry
        is_first = date is not None
        if date is not None:
            last_date = date
        if description is not None:
            last_desc = description
        amounts = []
        for a in posting.get("pamount", []):
            amounts.append({
                "commodity": _amount_commodity(a),
                "quantity": _amount_value(a),
            })
        running = []
        for a in running_total:
            running.append({
                "commodity": _amount_commodity(a),
                "quantity": _amount_value(a),
            })
        txns.append({
            "date": date or last_date,
            "description": description or last_desc,
            "account": posting.get("paccount", ""),
            "amounts": amounts,
            "running_total": running,
            "is_first": is_first,
            "transaction_id": posting.get("ptransaction_", ""),
        })
    return txns


def attach_deposit_balances(txns: list) -> list:
    """Attach deposit balance and asset holding snapshot after each transaction group."""

    if not txns:
        return txns

    first_date = next((txn.get("date") for txn in txns if txn.get("date")), None)
    opening_balance = 0
    holding_order: list[str] = []
    holdings: dict[str, float] = {}
    if first_date:
        opening_balance = _sum_krw_amounts(
            get_balance("assets:bank", convert_to=BASE_CURRENCY, end=first_date)["totals"]
        )
        holding_order, holdings = _opening_non_cash_holdings(first_date)

    current_balance = opening_balance
    group: list[dict] = []

    def flush_group(group_items: list[dict]) -> None:
        nonlocal current_balance
        if not group_items:
            return
        delta = sum(
            _sum_krw_amounts(item.get("amounts", []))
            for item in group_items
            if _is_bank_account(item.get("account", ""))
        )
        current_balance += delta
        for item in group_items:
            account = item.get("account", "")
            if account.startswith("assets:") and not _is_cash_like_account(account):
                _merge_amount_totals(
                    item.get("amounts", []),
                    holdings,
                    holding_order,
                    skip_krw=True,
                )
        snapshot = _build_cumulative_snapshot(current_balance, holding_order, holdings)
        for item in group_items:
            item["deposit_balance"] = current_balance
            item["cumulative"] = [entry.copy() for entry in snapshot]

    for txn in txns:
        if txn.get("is_first") and group:
            flush_group(group)
            group = []
        group.append(txn)
    flush_group(group)
    return txns


def consolidate_register_postings(txns: list) -> list:
    """원장 포스팅 줄을 거래(분개) 단위로 합친다. static/app.js 의 consolidateTransactions 와 동일 규칙."""

    def flush_group(group: list, out: list) -> None:
        if not group:
            return
        display_account, display_amounts = _pick_display_posting(group)
        out.append({
            "date": group[0]["date"],
            "description": group[0]["description"],
            "account": display_account,
            "amounts": display_amounts,
            "running_total": group[-1]["running_total"],
            "deposit_balance": group[-1].get("deposit_balance"),
            "cumulative": group[-1].get("cumulative", []),
        })

    result: list = []
    group: list = []
    for t in txns:
        if t.get("is_first") and group:
            flush_group(group, result)
            group = []
        group.append(t)
    flush_group(group, result)
    return result


def _parse_compound_report(raw: dict) -> dict:
    """Parse incomestatement / balancesheet JSON."""
    result = {"subreports": [], "dates": []}
    for d_pair in raw.get("cbrDates", []):
        start = d_pair[0].get("contents", "") if d_pair else ""
        end = d_pair[1].get("contents", "") if len(d_pair) > 1 else ""
        result["dates"].append({"start": start, "end": end})

    for sr_entry in raw.get("cbrSubreports", []):
        sr_name, sr_data = sr_entry[0], sr_entry[1]
        rows = []
        for r in sr_data.get("prRows", []):
            row_amounts = []
            for period_amts in r.get("prrAmounts", []):
                period_vals = []
                for a in period_amts:
                    period_vals.append({
                        "commodity": _amount_commodity(a),
                        "quantity": _amount_value(a),
                    })
                row_amounts.append(period_vals)
            row_totals = []
            for a in r.get("prrTotal", []):
                row_totals.append({
                    "commodity": _amount_commodity(a),
                    "quantity": _amount_value(a),
                })
            rows.append({
                "account": r.get("prrName", ""),
                "amounts": row_amounts,
                "total": row_totals,
            })
        sr_totals = []
        for a in sr_data.get("prTotals", {}).get("prrTotal", []):
            sr_totals.append({
                "commodity": _amount_commodity(a),
                "quantity": _amount_value(a),
            })
        rows_sorted = sorted(rows, key=lambda r: abs(sum(
            a["quantity"] for a in r["total"]
        )), reverse=True)
        result["subreports"].append({
            "name": sr_name,
            "rows": rows_sorted,
            "totals": sr_totals,
        })

    net = []
    totals_data = raw.get("cbrTotals", {})
    if isinstance(totals_data, dict):
        for a in totals_data.get("prrTotal", []):
            net.append({
                "commodity": _amount_commodity(a),
                "quantity": _amount_value(a),
            })
    elif isinstance(totals_data, list):
        for a in totals_data:
            net.append({
                "commodity": _amount_commodity(a),
                "quantity": _amount_value(a),
            })
    result["net"] = net
    return result


def get_income_statement(
    period: str | None = None,
    monthly: bool = False,
) -> dict:
    _validate_period(period)
    args = ["incomestatement"]
    if period:
        args += ["-p", period]
    if monthly:
        args.append("-M")
    return _parse_compound_report(_run(args))


def get_balance_sheet(convert_to: str = BASE_CURRENCY) -> dict:
    args = ["balancesheet"]
    if convert_to:
        args += ["-X", convert_to]
    return _parse_compound_report(_run(args))


def get_accounts() -> list[str]:
    raw = _run(["accounts", "--tree"], json_output=False)
    return [line for line in raw.strip().splitlines() if line.strip()]


def get_available_periods() -> dict:
    """Return months and years that have transactions."""
    raw = _run(["activity", "-M"], json_output=False)
    months = set()
    for line in raw.strip().splitlines():
        parts = line.split()
        if parts and len(parts[0]) >= 7:
            months.add(parts[0][:7])
    months_sorted = sorted(months, reverse=True)
    years_sorted = sorted({m[:4] for m in months_sorted}, reverse=True)
    return {"months": months_sorted, "years": years_sorted}
