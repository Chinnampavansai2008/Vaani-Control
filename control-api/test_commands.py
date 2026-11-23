"""Run: python -m unittest discover -s control-api -p test_commands.py -v"""
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import main
import gemini_parser as parser


class Commands(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.products = [{"id": 1, "name": "Black Hoodie", "price": 1299, "stock": 20},
                         {"id": 2, "name": "White T-Shirt", "price": 499, "stock": 40}]
        self.patches = [patch.object(main, "history", []), patch.object(main, "pending", {}),
                        patch.object(main, "path", Path(self.temp.name)/"history.json"),
                        patch.object(main, "store", side_effect=self.store),
                        patch.dict(os.environ, {"GEMINI_API_KEY": "", "GEMINI_MODEL": ""})]
        for p in self.patches: p.start()
        self.addCleanup(self.temp.cleanup)
        for p in self.patches: self.addCleanup(p.stop)

    def store(self, route, method="GET", data=None):
        if method == "GET": return copy.deepcopy(self.products)
        product = next(p for p in self.products if p["id"] == int(route.rsplit("/", 1)[1]))
        if product[data["field"]] != data["expected"]: raise main.HTTPException(409, "Conflict")
        product[data["field"]] = data["value"]

    def preview(self, text): return main.preview(main.Command(text=text))

    def test_exact_confirm_history_undo(self):
        with patch.object(main, "interpret", side_effect=AssertionError("Exact commands must not call Gemini")):
            action = self.preview("Change black hoodie price to 899.")
        self.assertEqual(self.products[0]["price"], 1299)
        main.confirm(action["id"])
        self.assertEqual(self.products[0]["price"], 899)
        self.assertEqual(main.get_history()[0]["status"], "applied")
        main.undo(action["id"])
        self.assertEqual(self.products[0]["price"], 1299)
        self.assertEqual(main.get_history()[0]["status"], "undone")
        with self.assertRaises(main.HTTPException): main.confirm(action["id"])

    def test_conflicting_confirm_and_undo(self):
        a = self.preview("Set black hoodie price to 899")
        self.products[0]["price"] = 1000
        with self.assertRaises(main.HTTPException) as error: main.confirm(a["id"])
        self.assertEqual(error.exception.status_code, 409)
        self.products[0]["price"] = 1299
        main.confirm(a["id"])
        self.products[0]["price"] = 1200
        with self.assertRaises(main.HTTPException) as error: main.undo(a["id"])
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(a["status"], "applied")

    def test_missing_key(self):
        with self.assertRaises(main.HTTPException) as e: self.preview("Make the black hoodie cost 999 rupees")
        self.assertEqual(e.exception.status_code, 503)
        self.assertEqual(main.pending, {})

    def mock_client(self, data):
        client = MagicMock()
        client.__enter__.return_value = client
        client.models.list.return_value = [SimpleNamespace(name="models/test-flash", supported_actions=["generateContent"])]
        client.models.get.return_value = SimpleNamespace(name="models/configured-model", supported_actions=["generateContent"])
        client.models.generate_content.return_value = SimpleNamespace(text=json.dumps(data))
        return client

    def test_gemini_mock_price_and_stock(self):
        from google import genai
        for text, pid, field, value in [("Make the black hoodie cost 999 rupees", 1, "price", 999),
                                        ("Please give white t-shirt stock a value of 30", 2, "stock", 30)]:
            with self.subTest(text=text):
                client = self.mock_client({"product_id": pid, "field": field, "value": value, "clarification": None})
                with patch.dict(os.environ, {"GEMINI_API_KEY": "test-placeholder"}), patch.object(genai, "Client", return_value=client) as factory:
                    action = self.preview(text)
                self.assertEqual(action["value"], value)
                self.assertEqual(action["product_id"], pid)
                self.assertEqual(factory.call_args.kwargs["http_options"].timeout, 15000)
                self.assertEqual(factory.call_args.kwargs["http_options"].retry_options.attempts, 1)
                self.assertEqual(self.products[pid-1][field], 1299 if field == "price" else 40)

    def test_invalid_output_and_ambiguity(self):
        for bad in [None, [], {"clarification": "Which product?"},
                    {"product_id": 99, "field": "price", "value": 1},
                    {"product_id": 1, "field": "delete", "value": 1},
                    {"product_id": True, "field": "price", "value": 1},
                    *[{"product_id": 1, "field": "price", "value": v} for v in [True, -1, 1.5, "999"]]]:
            with self.subTest(data=bad), self.assertRaises(main.HTTPException):
                parser.validate_proposal(bad, self.products)

    def test_provider_failures_and_configured_model(self):
        from google import genai
        client = self.mock_client(None)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-placeholder", "GEMINI_MODEL": "configured-model"}), patch.object(genai, "Client", return_value=client):
            client.models.generate_content.side_effect = TimeoutError("sensitive-detail")
            with self.assertRaises(main.HTTPException) as e: self.preview("Make the black hoodie cost 999")
        self.assertEqual(e.exception.status_code, 502)
        self.assertNotIn("sensitive-detail", e.exception.detail)
        client.models.get.assert_called_once_with(model="configured-model")
        client.models.list.assert_not_called()
        for code in [400, 401, 403, 404, 429]:
            self.assertEqual(parser.provider_error(SimpleNamespace(code=code)).status_code, 503)

    def test_malformed_json_and_no_available_model(self):
        from google import genai
        client = self.mock_client(None)
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-placeholder"}), patch.object(genai, "Client", return_value=client):
            client.models.generate_content.return_value.text = "not JSON"
            with self.assertRaises(main.HTTPException) as e: self.preview("Make the black hoodie cost 999")
            self.assertEqual(e.exception.status_code, 422)
            client.models.list.return_value = []
            with self.assertRaises(main.HTTPException) as e: self.preview("Make the black hoodie cost 999")
            self.assertEqual(e.exception.status_code, 503)

    def test_discovery_prefers_newer_lite_version(self):
        from google import genai
        client = self.mock_client({"product_id": 1, "field": "price", "value": 999, "clarification": None})
        client.models.list.return_value = [SimpleNamespace(name="models/"+name, supported_actions=["generateContent"])
                                          for name in ["gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.8-flash"]]
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-placeholder"}), patch.object(genai, "Client", return_value=client):
            self.preview("Make the black hoodie cost 999")
        self.assertEqual(client.models.generate_content.call_args.kwargs["model"], "models/gemini-3.5-flash-lite")


if __name__ == "__main__": unittest.main()
