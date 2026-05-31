"""Flask backend for hledger Web UI."""

import calendar
import gzip
import ipaddress
import logging
import os
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import HTTPException

import hledger_api
import investment

app = Flask(__name__)
# 개발(FLASK_DEBUG=1) 시 정적 캐시 끔(코드 변경 즉시 반영), 운영 시 1시간 캐시.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0 if os.environ.get("FLASK_DEBUG") == "1" else 3600
logger = logging.getLogger(__name__)

_GZIP_TYPES = (
    "application/json", "text/css", "text/html",
    "application/javascript", "text/javascript",
)


@app.after_request
def _gzip_response(resp):
    """텍스트 응답을 gzip 압축(외부 의존성 없이 내장 모듈)."""
    accept = request.headers.get("Accept-Encoding", "")
    ctype = (resp.content_type or "").split(";")[0].strip()
    if (
        "gzip" in accept
        and ctype in _GZIP_TYPES
        and resp.direct_passthrough is False
        and "Content-Encoding" not in resp.headers
        and resp.status_code < 300
    ):
        data = resp.get_data()
        if len(data) >= 1024:
            resp.set_data(gzip.compress(data))
            resp.headers["Content-Encoding"] = "gzip"
            resp.headers["Content-Length"] = str(len(resp.get_data()))
    resp.headers.setdefault("Vary", "Accept-Encoding")
    return resp

_DEFAULT_SCRIPTS = str(Path(__file__).resolve().parent.parent / "scripts")
SCRIPTS_DIR = Path(os.environ.get("LEDGER_SCRIPTS_DIR", _DEFAULT_SCRIPTS))
REPORT_DIR = Path(__file__).resolve().parent / "report"
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_DEFAULT_ALLOWED_CLIENT_NETWORKS = ("127.0.0.0/8", "::1/128", "100.64.0.0/10")


def _allowed_client_networks():
    raw_networks = os.environ.get(
        "WEBUI_ALLOWED_CLIENT_NETWORKS",
        ",".join(_DEFAULT_ALLOWED_CLIENT_NETWORKS),
    )
    return tuple(
        ipaddress.ip_network(raw.strip(), strict=False)
        for raw in raw_networks.split(",")
        if raw.strip()
    )


def _is_allowed_client(remote_addr: str | None) -> bool:
    if not remote_addr:
        return False
    try:
        client_ip = ipaddress.ip_address(remote_addr)
    except ValueError:
        return False
    return any(client_ip in network for network in _allowed_client_networks())


@app.before_request
def restrict_lan_clients():
    if _is_allowed_client(request.remote_addr):
        return None
    logger.warning("Blocked webui access from disallowed client: %s", request.remote_addr)
    return jsonify({"error": "이 Web UI는 로컬 PC 또는 Tailscale 접속만 허용합니다."}), 403


@app.errorhandler(ValueError)
def handle_value_error(exc: ValueError):
    """파라미터 검증 실패(ValueError) → 400 JSON."""
    return jsonify({"error": str(exc)}), 400


@app.errorhandler(RuntimeError)
def handle_runtime_error(exc: RuntimeError):
    """hledger CLI 실행 실패(RuntimeError) → 500 JSON."""
    return jsonify({"error": str(exc)}), 500


@app.errorhandler(Exception)
def handle_generic_error(exc: Exception):
    """예상치 못한 에러 → 500 JSON. 내부 상세는 서버 로그에만 기록."""
    if isinstance(exc, HTTPException):
        return exc
    logger.exception("Unhandled exception in request: %s %s", request.method, request.path)
    return jsonify({"error": "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."}), 500


def _sum_krw(amounts):
    total = 0
    for amount in amounts:
        if amount.get("commodity") == "KRW":
            total += amount.get("quantity", 0)
    return total


def _previous_month_compare_date(today: date) -> tuple[date, str]:
    if today.month == 1:
        year, month = today.year - 1, 12
    else:
        year, month = today.year, today.month - 1
    last_day = calendar.monthrange(year, month)[1]
    compare_day = min(today.day, last_day)
    basis = "month_end" if today.day > last_day else "same_day"
    return date(year, month, compare_day), basis


def _expense_total(statement: dict) -> float:
    for sr in statement.get("subreports", []):
        if sr.get("name") == "Expenses":
            return _sum_krw(sr.get("totals", []))
    return 0


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/summary")
def api_summary():
    today = date.today()
    compare_date, compare_basis = _previous_month_compare_date(today)
    compare_period = (
        f"{compare_date.replace(day=1).isoformat()}.."
        f"{(compare_date + timedelta(days=1)).isoformat()}"
    )

    summary_data = hledger_api.run_independent({
        "balance_sheet": lambda: hledger_api.get_balance_sheet(convert_to="KRW"),
        "income_statement": lambda: hledger_api.get_income_statement(period="thismonth"),
        "recent_register": hledger_api.get_register,
        "portfolio": investment.calculate_portfolio,
        "previous_income_statement": (
            lambda: hledger_api.get_income_statement(period=compare_period)
        ),
        "deposit_balance": lambda: hledger_api.get_balance(
            "assets:bank",
            convert_to="KRW",
        ),
        "previous_deposit_balance": lambda: hledger_api.get_balance(
            "assets:bank",
            convert_to="KRW",
            end=compare_date.isoformat(),
        ),
    })

    bs = summary_data["balance_sheet"]
    is_data = summary_data["income_statement"]
    recent = summary_data["recent_register"]
    consolidated = hledger_api.consolidate_register_postings(recent)
    recent_txns = consolidated[-9:][::-1] if consolidated else []

    portfolio = summary_data["portfolio"]
    previous_period_expenses = _expense_total(
        summary_data["previous_income_statement"]
    )
    deposit_balance = _sum_krw(summary_data["deposit_balance"]["totals"])
    previous_deposit_balance = _sum_krw(
        summary_data["previous_deposit_balance"]["totals"]
    )

    cash_balance = 0
    for sr in bs.get("subreports", []):
        if sr["name"] == "Assets":
            for row in sr["rows"]:
                acct = row["account"]
                if any(k in acct for k in ("bank:", "cash", "savings")):
                    for a in row["total"]:
                        if a["commodity"] == "KRW":
                            cash_balance += a["quantity"]

    return jsonify({
        "balance_sheet": bs,
        "income_statement": is_data,
        "recent_transactions": recent_txns,
        "portfolio_summary": portfolio["summary"],
        "portfolio_holdings": portfolio["holdings"],
        "cash_balance": cash_balance,
        "deposit_balance": deposit_balance,
        "deposit_balance_change": deposit_balance - previous_deposit_balance,
        "deposit_compare_date": compare_date.isoformat(),
        "deposit_compare_basis": compare_basis,
        "expense_compare_date": compare_date.isoformat(),
        "expense_compare_basis": compare_basis,
        "previous_period_expenses": previous_period_expenses,
    })


@app.route("/api/transactions")
def api_transactions():
    period = request.args.get("period")
    account = request.args.get("account")
    full_register = hledger_api.attach_deposit_balances(
        hledger_api.get_register(period=period)
    )
    if not account:
        return jsonify(full_register)

    filtered_register = hledger_api.get_register(account, period=period)
    deposit_balance_by_txn_id = {}
    cumulative_by_txn_id = {}
    for txn in full_register:
        txn_id = txn.get("transaction_id")
        if not txn_id:
            continue
        deposit_balance_by_txn_id[txn_id] = txn.get("deposit_balance")
        cumulative_by_txn_id[txn_id] = txn.get("cumulative", [])
    for txn in filtered_register:
        txn["deposit_balance"] = deposit_balance_by_txn_id.get(txn.get("transaction_id"))
        txn["cumulative"] = cumulative_by_txn_id.get(txn.get("transaction_id"), [])
    return jsonify(filtered_register)


@app.route("/api/income-statement")
def api_income_statement():
    period = request.args.get("period")
    monthly = request.args.get("monthly") == "true"
    return jsonify(hledger_api.get_income_statement(period=period, monthly=monthly))


@app.route("/api/balance-sheet")
def api_balance_sheet():
    return jsonify(hledger_api.get_balance_sheet(convert_to="KRW"))


@app.route("/api/accounts")
def api_accounts():
    accounts = hledger_api.get_accounts()
    balance = hledger_api.get_balance(tree=True)
    balance_krw = hledger_api.get_balance(convert_to="KRW", tree=True)
    return jsonify({
        "accounts": accounts,
        "balance": balance,
        "balance_krw": balance_krw,
    })


@app.route("/api/accounts/<path:name>/register")
def api_account_register(name):
    period = request.args.get("period")
    return jsonify(hledger_api.get_register(name, period=period))


@app.route("/api/periods")
def api_periods():
    return jsonify(hledger_api.get_available_periods())


@app.route("/api/portfolio")
def api_portfolio():
    return jsonify(investment.calculate_portfolio())


@app.route("/api/prices")
def api_prices():
    return jsonify(investment.parse_prices_journal())


@app.route("/api/prices/update", methods=["POST"])
def api_prices_update():
    script = SCRIPTS_DIR / "update-prices.py"
    if not script.exists():
        return jsonify({"error": "update-prices.py not found"}), 404
    try:
        result = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
            timeout=180,
            cwd=str(SCRIPTS_DIR.parent),
        )
        success = result.returncode == 0
        if success:
            # prices.journal이 갱신됐으므로 캐시를 즉시 비워
            # 다음 API 요청이 최신 시세를 바탕으로 평가액을 반환하도록 한다.
            hledger_api.clear_hledger_cache()
        return jsonify({
            "success": success,
            "stdout": result.stdout,
            "stderr": result.stderr,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reports")
def api_reports():
    """webui/report/<YYYY-MM>/ 아래 결산 리포트 목록(최신순)."""
    items = []
    if REPORT_DIR.is_dir():
        for d in sorted(REPORT_DIR.iterdir(), reverse=True):
            if not (d.is_dir() and _MONTH_RE.match(d.name)):
                continue
            files = [
                {"name": f.name, "title": _html_title(f) or f.stem}
                for f in sorted(d.glob("*.html"))
            ]
            if files:
                items.append({"month": d.name, "files": files})
    return jsonify(items)


@app.route("/report/<month>/<path:filename>")
def serve_report(month, filename):
    """결산 리포트 HTML 서빙. month 형식 검증 + 경로 탈출 방지."""
    if not _MONTH_RE.match(month):
        abort(404)
    resp = send_from_directory(REPORT_DIR / month, filename)
    # 리포트는 자주 갱신되므로 장기 캐시 금지(ETag로 304 재검증).
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def _html_title(path):
    try:
        head = path.read_text(encoding="utf-8")[:4096]
        m = re.search(r"<title>(.*?)</title>", head, re.S | re.I)
        return m.group(1).strip() if m else None
    except OSError:
        return None


if __name__ == "__main__":
    host = os.environ.get("WEBUI_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5001"))
    debug = os.environ.get("FLASK_DEBUG") == "1"
    app.run(host=host, port=port, debug=debug, use_reloader=False)
