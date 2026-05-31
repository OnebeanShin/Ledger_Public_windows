import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
INDEX = ROOT / "templates" / "index.html"


class StaticModuleSplitTest(unittest.TestCase):
    def test_index_bootstraps_es_module_main(self):
        html = INDEX.read_text(encoding="utf-8")
        self.assertIn('<script type="module" src="/static/main.js"></script>', html)
        self.assertNotIn('<script src="/static/app.js"></script>', html)

    def test_app_is_split_into_focused_es_modules(self):
        expected_modules = {
            "main.js",
            "api.js",
            "formatters.js",
            "category-breakdown.js",
            "charts.js",
            "ui.js",
            "summary.js",
            "transactions.js",
            "reports.js",
            "accounts.js",
            "portfolio.js",
        }
        for module_name in expected_modules:
            module_path = STATIC / module_name
            self.assertTrue(module_path.exists(), f"missing {module_name}")
            source = module_path.read_text(encoding="utf-8")
            self.assertRegex(source, r"\bexport\b|\bimport\b", f"{module_name} is not an ES module")

    def test_legacy_app_is_no_longer_the_monolithic_entrypoint(self):
        app_path = STATIC / "app.js"
        self.assertFalse(app_path.exists(), "static/app.js should be retired after the split")

    def test_main_wires_tab_loaders_by_import(self):
        main = (STATIC / "main.js").read_text(encoding="utf-8")
        imported_loaders = re.findall(r"import \{ (load\w+) \} from './(\w+)\.js';", main)
        self.assertGreaterEqual(len(imported_loaders), 5)
        self.assertIn("summary: loadSummary", main)
        self.assertIn("transactions: loadTransactions", main)
        self.assertIn("reports: loadReports", main)
        self.assertIn("'reports:accounts': loadAccounts", main)
        self.assertIn("portfolio: loadPortfolio", main)

    def test_accounts_moved_under_reports_subtab(self):
        html = INDEX.read_text(encoding="utf-8")
        self.assertNotIn('data-tab="accounts"', html)
        self.assertIn('data-sub="accounts"', html)
        self.assertIn('id="sub-accounts"', html)

    def test_page_modules_do_not_reach_into_main_tab_loader_state(self):
        for module_path in STATIC.glob("*.js"):
            if module_path.name == "main.js":
                continue
            self.assertNotIn(
                "tabLoaders",
                module_path.read_text(encoding="utf-8"),
                f"{module_path.name} should not depend on main.js module-local state",
            )


if __name__ == "__main__":
    unittest.main()
