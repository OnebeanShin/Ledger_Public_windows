"""Investment portfolio analysis using prices.journal and hledger data."""

import json
import os
import re
from pathlib import Path
from datetime import datetime

import hledger_api

_DEFAULT_PRICES = str(Path(__file__).resolve().parent.parent / "prices.journal")
PRICES_FILE = os.environ.get("LEDGER_PRICES_FILE", _DEFAULT_PRICES)

ASSET_LABELS = {
    "GOOGL": "Alphabet (GOOGL)",
    "MSTR": "MicroStrategy (MSTR)",
    "MSFT": "Microsoft (MSFT)",
    "BTC": "Bitcoin (BTC)",
}

_PRICE_RE = re.compile(
    r"^P\s+(\d{4}-\d{2}-\d{2})\s+\S+\s+(\S+)\s+([\d.]+)\s+(\S+)$"
)


def parse_prices_journal(path: str | None = None) -> dict:
    path = path or PRICES_FILE
    data: dict[str, list] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = _PRICE_RE.match(line.strip())
            if not m:
                continue
            date_str, symbol, price_str, currency = m.groups()
            data.setdefault(symbol, []).append({
                "date": date_str,
                "price": float(price_str),
                "currency": currency,
            })
    for entries in data.values():
        entries.sort(key=lambda e: e["date"])
    return data


def get_latest_prices(prices_data: dict | None = None) -> dict:
    if prices_data is None:
        prices_data = parse_prices_journal()
    latest = {}
    for symbol, entries in prices_data.items():
        if entries:
            e = entries[-1]
            latest[symbol] = {
                "price": e["price"],
                "currency": e["currency"],
                "date": e["date"],
            }
    return latest


def get_prices_file_mtime(path: str | None = None) -> str | None:
    path = path or PRICES_FILE
    try:
        return datetime.fromtimestamp(Path(path).stat().st_mtime).astimezone().isoformat(timespec="seconds")
    except OSError:
        return None


def _is_tracked_asset_account(account: str) -> bool:
    return account.startswith("assets:investment")


def _get_raw_holdings() -> list[dict]:
    """Get asset lots from postings before hledger aggregates away cost basis."""
    raw = hledger_api._run(
        ["print", "assets:investment", "-O", "json"],
        json_output=False,
    )
    transactions = json.loads(raw)

    results = []
    for transaction in transactions:
        for posting in transaction.get("tpostings", []):
            account = posting.get("paccount", "")
            if not _is_tracked_asset_account(account):
                continue
            for amount in posting.get("pamount", []):
                commodity = hledger_api._amount_commodity(amount)
                quantity = hledger_api._amount_value(amount)
                if commodity in ("KRW", "USD") or not quantity:
                    continue
                cost_per_unit_usd = hledger_api._extract_cost_usd(amount)
                total_cost_usd = (cost_per_unit_usd * quantity) if cost_per_unit_usd else 0.0
                results.append({
                    "account": account,
                    "symbol": commodity,
                    "quantity": quantity,
                    "cost_per_unit_usd": cost_per_unit_usd or 0.0,
                    "total_cost_usd": total_cost_usd,
                })
    return results


def _extract_running_holdings(running_total: list[dict]) -> dict[str, float]:
    holdings: dict[str, float] = {}
    for amount in running_total:
        commodity = amount.get("commodity")
        if commodity in ("KRW", "USD", None):
            continue
        quantity = amount.get("quantity", 0.0)
        if quantity:
            holdings[commodity] = quantity
    return holdings


def _build_holding_snapshots() -> list[dict]:
    register_rows = hledger_api.get_register("assets:investment")
    snapshots_by_date: dict[str, dict[str, float]] = {}
    for row in register_rows:
        date = row.get("date")
        if not date:
            continue
        snapshots_by_date[date] = _extract_running_holdings(
            row.get("running_total", [])
        )
    return [
        {"date": date, "holdings": snapshots_by_date[date]}
        for date in sorted(snapshots_by_date)
    ]


def _latest_price_on_or_before(entries: list[dict], target_date: str) -> dict | None:
    latest = None
    for entry in entries:
        if entry["date"] > target_date:
            break
        latest = entry
    return latest


def _build_total_market_history(
    prices_data: dict[str, list],
    tracked_symbols: list[str],
) -> list[dict]:
    snapshots = _build_holding_snapshots()
    if not snapshots:
        return []

    start_date = snapshots[0]["date"]
    relevant_dates = sorted({
        entry["date"]
        for symbol in (*tracked_symbols, "USD")
        for entry in prices_data.get(symbol, [])
        if entry["date"] >= start_date
    })
    if not relevant_dates:
        return []

    total_history = []
    snapshot_index = 0
    active_holdings: dict[str, float] = {}

    for date in relevant_dates:
        while snapshot_index < len(snapshots) and snapshots[snapshot_index]["date"] <= date:
            active_holdings = snapshots[snapshot_index]["holdings"]
            snapshot_index += 1

        usd_krw_entry = _latest_price_on_or_before(prices_data.get("USD", []), date)
        if not usd_krw_entry:
            continue

        total_market_krw = 0.0
        for symbol in tracked_symbols:
            quantity = active_holdings.get(symbol, 0.0)
            if not quantity:
                continue
            price_entry = _latest_price_on_or_before(prices_data.get(symbol, []), date)
            if not price_entry:
                continue
            total_market_krw += quantity * price_entry["price"] * usd_krw_entry["price"]

        total_history.append({
            "date": date,
            "value": round(total_market_krw),
        })

    return total_history


def calculate_portfolio() -> dict:
    holdings = _get_raw_holdings()
    prices_data = parse_prices_journal()
    latest = get_latest_prices(prices_data)

    cash_balance = 0
    try:
        bs = hledger_api.get_balance_sheet(convert_to="KRW")
        for sr in bs.get("subreports", []):
            if sr["name"] == "Assets":
                for row in sr["rows"]:
                    acct = row["account"]
                    if any(k in acct for k in ("bank:", "cash", "savings")):
                        for a in row["total"]:
                            if a["commodity"] == "KRW":
                                cash_balance += a["quantity"]
    except Exception:
        pass

    usd_krw_info = latest.get("USD", {})
    usd_krw = usd_krw_info.get("price", 1.0)
    usd_krw_date = usd_krw_info.get("date", "")

    symbol_map: dict[str, dict] = {}
    for h in holdings:
        sym = h["symbol"]
        if sym not in symbol_map:
            symbol_map[sym] = {
                "symbol": sym,
                "label": ASSET_LABELS.get(sym, sym),
                "quantity": 0.0,
                "total_cost_usd": 0.0,
            }
        symbol_map[sym]["quantity"] += h["quantity"]
        if h.get("total_cost_usd") is not None:
            symbol_map[sym]["total_cost_usd"] += h["total_cost_usd"]

    result_holdings = []
    total_cost_krw = 0.0
    total_market_krw = 0.0

    def _symbol_sort_key(item: tuple[str, dict]) -> tuple[int, str]:
        symbol = item[0]
        # Keep Bitcoin first, then show every other investment commodity alphabetically.
        # This lets the dashboard pick up newly added stock symbols without code changes.
        return (0 if symbol == "BTC" else 1, symbol)

    for sym, info in sorted(symbol_map.items(), key=_symbol_sort_key):
        price_info = latest.get(sym, {})
        current_price_usd = price_info.get("price", 0.0)
        price_date = price_info.get("date", "")
        qty = info["quantity"]
        if abs(qty) < 1e-12:
            continue
        cost_total_usd = info["total_cost_usd"]
        cost_per_unit_usd = cost_total_usd / qty if qty else 0.0
        market_total_usd = qty * current_price_usd
        cost_total_krw = cost_total_usd * usd_krw
        market_total_krw = market_total_usd * usd_krw
        pnl_krw = market_total_krw - cost_total_krw
        return_pct = (pnl_krw / cost_total_krw * 100) if cost_total_krw else 0.0

        total_cost_krw += cost_total_krw
        total_market_krw += market_total_krw

        result_holdings.append({
            "symbol": sym,
            "label": info["label"],
            "quantity": qty,
            "cost_per_unit_usd": round(cost_per_unit_usd, 2),
            "current_price_usd": round(current_price_usd, 2),
            "cost_total_usd": round(cost_total_usd, 2),
            "market_total_usd": round(market_total_usd, 2),
            "cost_total_krw": round(cost_total_krw),
            "market_total_krw": round(market_total_krw),
            "pnl_krw": round(pnl_krw),
            "return_pct": round(return_pct, 2),
            "price_date": price_date,
        })

    total_pnl_krw = total_market_krw - total_cost_krw
    total_return_pct = (
        (total_pnl_krw / total_cost_krw * 100) if total_cost_krw else 0.0
    )
    total_market_history = _build_total_market_history(
        prices_data,
        [item["symbol"] for item in result_holdings],
    )

    return {
        "summary": {
            "total_cost_krw": round(total_cost_krw),
            "total_market_krw": round(total_market_krw),
            "total_pnl_krw": round(total_pnl_krw),
            "total_return_pct": round(total_return_pct, 2),
        },
        "holdings": result_holdings,
        "cash_balance": round(cash_balance),
        "exchange_rate": {
            "usd_krw": usd_krw,
            "date": usd_krw_date,
        },
        "prices_history": prices_data,
        "total_market_history": total_market_history,
        "prices_file_mtime": get_prices_file_mtime(),
        "last_updated": datetime.now().isoformat(timespec="seconds"),
    }
