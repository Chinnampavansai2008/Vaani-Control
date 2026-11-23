import copy
import json
import os
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

import main
import gemini_parser as parser
from percentage_price import percentage_price

class PercentageCommands(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.products = [{"id": 1, "name": "Black Hoodie", "price": 1299, "stock": 20},
                         {"id": 2, "name": "White T-Shirt", "price": 499, "stock": 40}]
        self.patches = [
            patch.object(main, "history", []),
            patch.object(main, "pending", {}),
            patch.object(main, "path", Path(self.temp.name) / "history.json"),
            patch.object(main, "store", side_effect=self.store),
            patch.dict(os.environ, {"GEMINI_API_KEY": "test", "GEMINI_MODEL": ""})
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(self.temp.cleanup)
        for p in self.patches:
            self.addCleanup(p.stop)

    def store(self, route, method="GET", data=None):
        if method == "GET":
            return copy.deepcopy(self.products)
        product = next(p for p in self.products if p["id"] == int(route.rsplit("/", 1)[1]))
        if product[data["field"]] != data["expected"]:
            raise main.HTTPException(409, "Conflict")
        product[data["field"]] = data["value"]

    def preview(self, text):
        return main.preview(main.Command(text=text))

    def mock_client(self, data):
        client = MagicMock()
        client.__enter__.return_value = client
        client.models.list.return_value = [
            type("M", (), {"name": "models/test-flash", "supported_actions": ["generateContent"]})()
        ]
        client.models.get.return_value = type("M", (), {"name": "models/configured-model", "supported_actions": ["generateContent"]})()
        client.models.generate_content.return_value = type("R", (), {"text": json.dumps(data)})()
        return client

    def test_decrease_percentage(self):
        from google import genai
        data = {"product_id": 1, "field": "price", "percentage": 10, "operation": "decrease", "value": None, "clarification": None}
        client = self.mock_client(data)
        with patch.object(genai, "Client", return_value=client):
            action = self.preview("Reduce the black hoodie price by 10 percent")
        self.assertEqual(action["value"], 1169)  # 1299 * 0.9 = 1169.1 -> 1169
        self.assertEqual(action["product_id"], 1)

    def test_increase_percentage(self):
        from google import genai
        data = {"product_id": 2, "field": "price", "percentage": 5, "operation": "increase", "value": None, "clarification": None}
        client = self.mock_client(data)
        with patch.object(genai, "Client", return_value=client):
            action = self.preview("Increase the white t-shirt price by 5 percent")
        self.assertEqual(action["value"], 524)  # 499 * 1.05 = 523.95 -> 524
        self.assertEqual(action["product_id"], 2)

    def test_invalid_percentage(self):
        from google import genai
        data = {"product_id": 1, "field": "price", "percentage": 0, "operation": "decrease", "value": None, "clarification": None}
        client = self.mock_client(data)
        with patch.object(genai, "Client", return_value=client):
            with self.assertRaises(main.HTTPException) as ctx:
                self.preview("Reduce the black hoodie price by 0 percent")
        self.assertEqual(ctx.exception.status_code, 422)

    def test_unchanged_rounding(self):
        from google import genai
        # price 100, 0.4% decrease -> 99.6 rounds to 100
        self.products[0]["price"] = 100
        data = {"product_id": 1, "field": "price", "percentage": 0.4, "operation": "decrease", "value": None, "clarification": None}
        client = self.mock_client(data)
        with patch.object(genai, "Client", return_value=client):
            with self.assertRaises(main.HTTPException) as ctx:
                self.preview("Reduce the black hoodie price by 0.4 percent")
        self.assertEqual(ctx.exception.status_code, 422)

    def test_percentage_confirm_history_and_exact_undo(self):
        from google import genai
        data = {"product_id": 1, "field": "price", "percentage": 10, "operation": "decrease", "value": None, "clarification": None}
        client = self.mock_client(data)
        with patch.object(genai, 'Client', return_value=client):
            action = self.preview('Reduce the black hoodie price by 10 percent')
        self.assertEqual(self.products[0]['price'], 1299)
        self.assertEqual(main.history, [])
        self.assertEqual((action['previous'], action['value']), (1299, 1169))
        main.confirm(action['id'])
        self.assertEqual(self.products[0]['price'], 1169)
        self.assertEqual(main.get_history()[0]['value'], 1169)
        main.undo(action['id'])
        self.assertEqual(self.products[0]['price'], 1299)
        self.assertEqual(main.get_history()[0]['status'], 'undone')

    def test_percentage_uses_existing_conflict_protection(self):
        from google import genai
        client = self.mock_client({"product_id": 1, "field": "price", "percentage": 10, "operation": "decrease", "value": None, "clarification": None})
        with patch.object(genai, 'Client', return_value=client):
            action = self.preview('Reduce the black hoodie price by 10 percent')
        self.products[0]['price'] = 1500
        with self.assertRaises(main.HTTPException) as error: main.confirm(action['id'])
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(main.history, [])
        self.products[0]['price'] = 1299
        main.confirm(action['id'])
        self.products[0]['price'] = 1200
        with self.assertRaises(main.HTTPException) as error: main.undo(action['id'])
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(action['status'], 'applied')

    def test_unsupported_or_ambiguous_proposals_never_create_actions(self):
        from google import genai
        base = {"product_id": 1, "field": "price", "percentage": 10, "operation": "decrease", "value": None, "clarification": None}
        invalid = [{**base, 'field': 'stock'}, {**base, 'operation': None},
                   {**base, 'percentage': None}, {**base, 'operation': 'multiply'},
                   {**base, 'value': 999}, {**base, 'product_id': True},
                   {**base, 'product_id': [1, 2]}, {**base, 'clarification': 'Which percentage?'}]
        for data in invalid:
            with self.subTest(data=data), patch.object(genai, 'Client', return_value=self.mock_client(data)):
                with self.assertRaises(main.HTTPException) as error: self.preview('Change the price')
                self.assertEqual(error.exception.status_code, 422)
                self.assertEqual(main.pending, {})
                self.assertEqual(main.history, [])
                self.assertEqual(self.products[0]['price'], 1299)

    def test_absolute_commands_remain_compatible(self):
        for field, value in [('price', 999), ('stock', 30)]:
            for extras in [{}, {'percentage': None, 'operation': None}]:
                product, actual_field, actual_value = parser.validate_proposal({
                    'product_id': 1, 'field': field, 'value': value, 'clarification': None, **extras,
                }, self.products)
                self.assertEqual((product['id'], actual_field, actual_value), (1, field, value))
        with self.assertRaises(main.HTTPException):
            parser.validate_proposal({'product_id': 1, 'field': 'price', 'value': True}, self.products)


class PercentageCalculation(unittest.TestCase):
    def test_price_examples_and_boundary_percentages(self):
        self.assertEqual(percentage_price(1299, 'decrease', 10), 1169)
        self.assertEqual(percentage_price(499, 'increase', 5), 524)
        self.assertEqual(percentage_price(100, 'decrease', 100), 0)
        self.assertEqual(percentage_price(100, 'increase', 100), 200)

    def test_fractional_percentages_use_decimal_arithmetic(self):
        self.assertEqual(percentage_price(1000, 'increase', 1.25), 1013)
        self.assertEqual(percentage_price(10000, 'decrease', Decimal('1.25')), 9875)

    def test_half_rupees_round_up_in_both_directions(self):
        self.assertEqual(percentage_price(10, 'increase', 5), 11)
        self.assertEqual(percentage_price(101, 'decrease', 50), 51)
        self.assertEqual(percentage_price(100, 'decrease', 99.5), 1)

    def test_invalid_percentages_are_rejected_instead_of_silently_rounded(self):
        invalid = [0, -1, 100.01, 1.234, '10', True, False, None,
                   float('nan'), float('inf'), float('-inf'), Decimal('NaN'), Decimal('Infinity')]
        for percentage in invalid:
            with self.subTest(percentage=str(percentage)), self.assertRaises(main.HTTPException) as error:
                percentage_price(1299, 'increase', percentage)
            self.assertEqual(error.exception.status_code, 422)

    def test_invalid_prices_and_operations_are_rejected(self):
        for price in [-1, 1.5, True, '100', None]:
            with self.assertRaises(main.HTTPException): percentage_price(price, 'increase', 10)
        for operation in [None, 'multiply', 'stock', True]:
            with self.assertRaises(main.HTTPException): percentage_price(1299, operation, 10)

    def test_unchanged_result_requires_clarification(self):
        for price, operation, percentage in [(100, 'decrease', 0.4), (0, 'increase', 50), (1, 'increase', 1)]:
            with self.assertRaises(main.HTTPException) as error: percentage_price(price, operation, percentage)
            self.assertIn('unchanged', error.exception.detail)

if __name__ == "__main__":
    unittest.main()
