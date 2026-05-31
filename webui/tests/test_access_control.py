import unittest
from unittest.mock import patch

from app import app


class WebuiAccessControlTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_localhost_is_allowed(self):
        resp = self.client.get("/", environ_base={"REMOTE_ADDR": "127.0.0.1"})
        self.assertEqual(resp.status_code, 200)

    def test_tailscale_client_is_allowed(self):
        resp = self.client.get("/", environ_base={"REMOTE_ADDR": "100.64.0.1"})
        self.assertEqual(resp.status_code, 200)

    def test_same_wifi_lan_client_is_blocked_by_default(self):
        resp = self.client.get("/", environ_base={"REMOTE_ADDR": "192.168.0.10"})
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Tailscale", resp.get_json()["error"])

    def test_this_macs_lan_ip_can_be_allowed_without_opening_subnet(self):
        networks = "127.0.0.0/8,::1/128,100.64.0.0/10,192.168.0.10/32"
        with patch.dict("os.environ", {"WEBUI_ALLOWED_CLIENT_NETWORKS": networks}):
            own_lan_resp = self.client.get("/", environ_base={"REMOTE_ADDR": "192.168.0.10"})
            neighbor_resp = self.client.get("/", environ_base={"REMOTE_ADDR": "192.168.0.11"})

        self.assertEqual(own_lan_resp.status_code, 200)
        self.assertEqual(neighbor_resp.status_code, 403)


if __name__ == "__main__":
    unittest.main()
