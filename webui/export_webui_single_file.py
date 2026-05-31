"""Export the current Web UI as a single self-contained HTML snapshot."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

import app as webapp


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
TEMPLATE_PATH = ROOT / "templates" / "index.html"

MODULE_ORDER = [
    "formatters.js",
    "ui.js",
    "charts.js",
    "category-breakdown.js",
    "summary.js",
    "transactions.js",
    "reports.js",
    "accounts.js",
    "portfolio.js",
    "main.js",
]


def normalize_api_path(path: str) -> str:
    split = urlsplit(path)
    params = parse_qsl(split.query, keep_blank_values=True)
    params.sort()
    query = urlencode(params)
    return split.path + (f"?{query}" if query else "")


def fetch_json(client, path: str):
    response = client.get(path)
    if response.status_code != 200:
        raise RuntimeError(f"API request failed: {path} -> {response.status_code}")
    return response.get_json()


def collect_snapshot() -> dict[str, object]:
    client = webapp.app.test_client()
    snapshot: dict[str, object] = {}

    def add(path: str):
        snapshot[normalize_api_path(path)] = fetch_json(client, path)

    base_paths = [
        "/api/summary",
        "/api/balance-sheet",
        "/api/accounts",
        "/api/periods",
        "/api/portfolio",
        "/api/transactions",
        "/api/transactions?period=thismonth",
        "/api/transactions?period=lastmonth",
        "/api/transactions?period=thisyear",
    ]
    for path in base_paths:
        add(path)

    periods = snapshot[normalize_api_path("/api/periods")]
    months = periods.get("months", []) if isinstance(periods, dict) else []
    years = periods.get("years", []) if isinstance(periods, dict) else []

    report_periods = ["thismonth", "lastmonth", *months, *years]
    for period in dict.fromkeys(report_periods):
        add(f"/api/income-statement?period={period}")
        add(f"/api/transactions?period={period}&account=expenses")

    accounts_payload = snapshot[normalize_api_path("/api/accounts")]
    account_names: set[str] = set()
    if isinstance(accounts_payload, dict):
        for row in accounts_payload.get("balance", {}).get("rows", []):
            account_names.add(row["account"])
        for row in accounts_payload.get("balance_krw", {}).get("rows", []):
            account_names.add(row["account"])

    all_transactions = snapshot[normalize_api_path("/api/transactions")]
    if isinstance(all_transactions, list):
        for txn in all_transactions:
            acct = txn.get("account")
            if acct:
                account_names.add(acct)

    txn_periods = ["", "thismonth", "lastmonth", "thisyear"]
    for period in txn_periods:
        for account in sorted(account_names):
            params = []
            if period:
                params.append(("period", period))
            params.append(("account", account))
            path = "/api/transactions?" + urlencode(params)
            add(path)

    for account in sorted(account_names):
        encoded = quote(account, safe="")
        add(f"/api/accounts/{encoded}/register")

    return snapshot


def strip_module_syntax(source: str) -> str:
    source = re.sub(r"^import\s+.*?;\n", "", source, flags=re.MULTILINE)
    source = re.sub(r"\bexport\s+(?=(async function|function|const|let|class))", "", source)
    return source.strip()


def build_bundle(snapshot: dict[str, object]) -> str:
    api_stub = f"""
const STATIC_API_DATA = {json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))};

function normalizeStaticApiPath(path) {{
  const url = new URL(path, 'http://static.local');
  const params = [...url.searchParams.entries()].sort((a, b) => {{
    if (a[0] === b[0]) return a[1].localeCompare(b[1]);
    return a[0].localeCompare(b[0]);
  }});
  const query = new URLSearchParams(params).toString();
  return url.pathname + (query ? '?' + query : '');
}}

async function api(path) {{
  const key = normalizeStaticApiPath(path);
  if (!(key in STATIC_API_DATA)) {{
    throw new Error(`정적 스냅샷에 없는 API 요청입니다: ${{key}}`);
  }}
  return JSON.parse(JSON.stringify(STATIC_API_DATA[key]));
}}

const __nativeFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
globalThis.fetch = async function staticFetch(input, init) {{
  const path = typeof input === 'string' ? input : (input?.url || '');
  const key = normalizeStaticApiPath(path);
  if (key === '/api/prices/update') {{
    return new Response(JSON.stringify({{
      success: false,
      error: '정적 HTML에서는 시세 갱신을 지원하지 않습니다.',
    }}), {{
      status: 200,
      headers: {{ 'Content-Type': 'application/json' }},
    }});
  }}
  if (key.startsWith('/api/')) {{
    const data = await api(path);
    return new Response(JSON.stringify(data), {{
      status: 200,
      headers: {{ 'Content-Type': 'application/json' }},
    }});
  }}
  if (__nativeFetch) return __nativeFetch(input, init);
  throw new Error(`지원되지 않는 fetch 요청입니다: ${{path}}`);
}};

window.addEventListener('DOMContentLoaded', () => {{
  const btn = document.getElementById('btn-update-prices');
  if (btn) {{
    btn.disabled = true;
    btn.textContent = '정적 파일';
    btn.title = '정적 HTML에서는 시세 갱신을 지원하지 않습니다.';
  }}
}});
""".strip()

    parts = [api_stub]
    for module_name in MODULE_ORDER:
        source = (STATIC_DIR / module_name).read_text(encoding="utf-8")
        parts.append(f"\n/* --- {module_name} --- */\n")
        parts.append(strip_module_syntax(source))
        parts.append("\n")
    return "".join(parts)


def build_html(snapshot: dict[str, object]) -> str:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    style = (STATIC_DIR / "style.css").read_text(encoding="utf-8")
    bundle = build_bundle(snapshot)

    template = re.sub(r'^\s*<link rel="icon".*$\n?', "", template, flags=re.MULTILINE)
    template = re.sub(r'^\s*<link rel="apple-touch-icon".*$\n?', "", template, flags=re.MULTILINE)
    template = template.replace(
        '<link rel="stylesheet" href="/static/style.css">',
        f"<style>\n{style}\n</style>",
    )
    template = template.replace(
        '<script type="module" src="/static/main.js"></script>',
        f'<script type="module">\n{bundle}\n</script>',
    )
    # 단일파일은 서버가 없어 /static/vendor 상대경로가 동작하지 않으므로 CDN으로 역매핑.
    template = template.replace(
        '/static/vendor/chart.umd.min.js',
        'https://cdn.jsdelivr.net/npm/chart.js@4',
    )
    template = template.replace(
        '/static/vendor/chartjs-chart-treemap.umd.min.js',
        'https://cdn.jsdelivr.net/npm/chartjs-chart-treemap@3',
    )
    return template


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=ROOT / "webui-single-file.html",
        help="Output HTML path",
    )
    args = parser.parse_args()

    snapshot = collect_snapshot()
    html = build_html(snapshot)
    args.output.write_text(html, encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
