import copy
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import httpx

import main
import product_queries as queries

PRODUCTS = [{'id': 1, 'name': 'Black Hoodie', 'price': 1299, 'stock': 20},
            {'id': 2, 'name': 'White T-Shirt', 'price': 499, 'stock': 40}]


def client_with(data):
    client = MagicMock()
    client.__enter__.return_value = client
    client.models.get.return_value = SimpleNamespace(name='models/test-model', supported_actions=['generateContent'])
    client.models.generate_content.return_value = SimpleNamespace(text=json.dumps(data))
    return client


class ProductQueries(unittest.TestCase):
    def setUp(self):
        self.products = copy.deepcopy(PRODUCTS)
        patches = [patch.dict(os.environ, {'GEMINI_API_KEY': 'test-placeholder', 'GEMINI_MODEL': 'test-model'}),
                   patch.object(main, 'store', side_effect=self.store), patch.object(main, 'save'),
                   patch.object(main, 'history', []), patch.object(main, 'pending', {})]
        for p in patches:
            p.start(); self.addCleanup(p.stop)
        self.calls = []

    def store(self, path, method='GET', data=None):
        self.calls.append((path, method, data))
        if method != 'GET' or path != '/api/products':
            raise AssertionError('A query attempted a store mutation')
        return copy.deepcopy(self.products)

    def ask(self, data, text='What is the black hoodie price?'):
        from google import genai
        client = client_with(data)
        with patch.object(genai, 'Client', return_value=client):
            result = main.query(main.Command(text=text))
        return result, client

    def assert_read_only(self):
        self.assertEqual(main.pending, {})
        self.assertEqual(main.history, [])
        self.assertEqual(self.products, PRODUCTS)
        main.save.assert_not_called()
        self.assertTrue(all(call[1] == 'GET' for call in self.calls))

    def test_price_answer_comes_from_catalog_not_model(self):
        answer, client = self.ask({'product_id': 1, 'field': 'price', 'clarification': None, 'value': 1, 'product': 'invented name'})
        self.assertEqual(answer.model_dump(), {'product_id': 1, 'product': 'Black Hoodie', 'field': 'price', 'value': 1299, 'read_only': True})
        self.assertEqual(self.calls, [('/api/products', 'GET', None)])
        payload = json.loads(client.models.generate_content.call_args.kwargs['contents'])
        self.assertEqual(set(payload['catalog'][0]), {'id', 'name'})
        self.assert_read_only()

    def test_stock_answer_and_zero_values(self):
        answer, _ = self.ask({'product_id': 2, 'field': 'stock', 'clarification': None})
        self.assertEqual(answer.value, 40)
        self.assert_read_only()
        self.products[1]['stock'] = 0
        answer, _ = self.ask({'product_id': 2, 'field': 'stock', 'clarification': None})
        self.assertEqual(answer.value, 0)

    def test_unknown_product_field_and_ambiguity_leave_state_unchanged(self):
        for data in [None, [], {'product_id': 99, 'field': 'price'}, {'product_id': True, 'field': 'price'},
                     {'product_id': '1', 'field': 'price'}, {'product_id': 1, 'field': 'orders'},
                     {'product_id': 1, 'field': ['price', 'stock']}, {'clarification': 'Which product?'}]:
            with self.subTest(data=data), self.assertRaises(main.HTTPException) as error:
                self.ask(data)
            self.assertEqual(error.exception.status_code, 422)
            self.assert_read_only()

    def test_invalid_catalog_prevents_model_requests(self):
        for data in [None, {}, [None], [{**PRODUCTS[0], 'id': 'black-hoodie'}], [PRODUCTS[0], PRODUCTS[0]]]:
            with self.subTest(data=data), patch.object(queries, 'request_json') as model:
                with self.assertRaises(main.HTTPException) as error: queries.answer_query('price?', data)
                self.assertEqual(error.exception.status_code, 502)
                model.assert_not_called()

    def test_empty_catalog_requires_clarification(self):
        with patch.object(queries, 'request_json') as model:
            with self.assertRaises(main.HTTPException) as error: queries.answer_query('price?', [])
            self.assertEqual(error.exception.status_code, 422)
            model.assert_not_called()

    def test_invalid_catalog_values_are_not_returned(self):
        for value in [True, -1, '999', 1.5, None]:
            with self.subTest(value=value), self.assertRaises(main.HTTPException) as error:
                queries.validate_selection({'product_id': 1, 'field': 'price'}, [{**PRODUCTS[0], 'price': value}])
            self.assertEqual(error.exception.status_code, 502)

    def test_question_length_validation_does_not_read_catalog(self):
        for text in ['   ', 'x'*2001]:
            with self.assertRaises(main.HTTPException) as error: main.query(main.Command(text=text))
            self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(self.calls, [])
        self.assert_read_only()

    def test_provider_failure_is_safe_and_read_only(self):
        from google import genai
        client = client_with(None)
        client.models.generate_content.side_effect = TimeoutError('private-provider-detail')
        with patch.object(genai, 'Client', return_value=client), self.assertRaises(main.HTTPException) as error:
            main.query(main.Command(text='What is the hoodie price?'))
        self.assertEqual(error.exception.status_code, 502)
        self.assertNotIn('private-provider-detail', error.exception.detail)
        self.assert_read_only()

    def test_missing_key_keeps_query_read_only(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}), self.assertRaises(main.HTTPException) as error:
            main.query(main.Command(text='What is the hoodie price?'))
        self.assertEqual(error.exception.status_code, 503)
        self.assert_read_only()

    def test_store_errors_do_not_echo_private_details(self):
        with patch.object(main, 'store', side_effect=main.HTTPException(403, 'private-store-detail')), self.assertRaises(main.HTTPException) as error:
            main.query(main.Command(text='What is the hoodie price?'))
        self.assertEqual(error.exception.status_code, 502)
        self.assertNotIn('private-store-detail', error.exception.detail)
        self.assert_read_only()


class QueryRoute(unittest.IsolatedAsyncioTestCase):
    async def test_http_response_never_creates_actions_or_calls_patch(self):
        from google import genai
        before_history, before_pending = copy.deepcopy(main.history), copy.deepcopy(main.pending)
        client = client_with({'product_id': 2, 'field': 'stock', 'clarification': None})
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-placeholder', 'GEMINI_MODEL': 'test-model'}), patch.object(genai, 'Client', return_value=client), patch.object(main, 'store', return_value=PRODUCTS) as fetch, patch.object(main, 'save') as save:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as api:
                response = await api.post('/api/query', json={'text': 'How many white T-shirts are in stock?'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {'product_id': 2, 'product': 'White T-Shirt', 'field': 'stock', 'value': 40, 'read_only': True})
            fetch.assert_called_once_with('/api/products')
            save.assert_not_called()
        self.assertEqual(main.history, before_history)
        self.assertEqual(main.pending, before_pending)
