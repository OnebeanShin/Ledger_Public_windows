import threading
import time
import unittest

import hledger_api


class HledgerParallelTest(unittest.TestCase):
    def test_run_independent_collects_results_in_input_order(self):
        gate = threading.Event()
        started = []

        def first():
            started.append("first")
            gate.wait(timeout=1)
            return "a"

        def second():
            started.append("second")
            gate.set()
            return "b"

        result = hledger_api.run_independent({
            "first": first,
            "second": second,
        })

        self.assertEqual(result, {"first": "a", "second": "b"})
        self.assertEqual(set(started), {"first", "second"})

    def test_run_independent_propagates_first_error(self):
        def fail():
            raise RuntimeError("boom")

        def slow():
            time.sleep(0.05)
            return "unused"

        with self.assertRaisesRegex(RuntimeError, "boom"):
            hledger_api.run_independent({"fail": fail, "slow": slow})


if __name__ == "__main__":
    unittest.main()
