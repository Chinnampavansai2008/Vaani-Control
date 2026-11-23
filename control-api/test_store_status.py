import copy
import json
import os
import unittest
from unittest.mock import Mock, patch

import httpx
from fastapi import HTTPException

import main
from store_status import inspect_store, public_host

PRODUCTS = [{'id': 1, 'name': 'Black Hoodie', 'price': 1299, 'stock': 20},
            {'id': 2, 'name': 'White T-Shirt', 'price': 499, 'stock': 40}]
ADDRESS = 'https://user:private-password@example.test:8443/private-path?token=private-token#fragment'


class CatalogStatus(unittest.TestCase):
    def test_compatible_catalog_read_only(self):
        data = copy.deepcopy(PRODUCTS)
        fetch = Mock(return_value=data)
        result = inspect_store(fetch, ADDRESS)
        self.assertEqual(result.status, 'ok')
        self.assertEqual(result.product_count, 2)
        self.assertEqual(result.host, 'example.test:8443')
        self.assertFalse(result.update_permissions_checked)
        fetch.assert_called_once_with('/api/products')
        self.assertEqual(data, PRODUCTS)
        serialized = result.model_dump_json()
        for secret in ['user:', 'private-password', 'private-path', 'private-token', 'fragment']:
            self.assertNotIn(secret, serialized)

    def test_empty_catalog_is_compatible(self):
        result = inspect_store(lambda route: [], 'http://127.0.0.1:8001')
        self.assertEqual(result.status, 'ok')
        self.assertEqual(result.product_count, 0)
        self.assertIn('No products', result.message)

    def test_non_list_and_non_object_products(self):
        for data in [None, {}, 'private-response', 5, [None], ['product']]:
            with self.subTest(data=data):
                result = inspect_store(lambda route: data, ADDRESS)
                self.assertEqual(result.status, 'incompatible')
                self.assertIsNone(result.product_count)

    def test_product_ids_are_unique_integers(self):
        for data in [[PRODUCTS[0], PRODUCTS[0]], [{**PRODUCTS[0], 'id': True}],
                     [{**PRODUCTS[0], 'id': 'black-hoodie'}], [{**PRODUCTS[0], 'id': None}]]:
            result = inspect_store(lambda route: data, ADDRESS)
            self.assertEqual(result.status, 'incompatible')

    def test_names_prices_and_stock(self):
        for field, value in [('name', ''), ('name', '  '), ('name', 5), ('price', -1),
                             ('price', 1.5), ('price', '999'), ('price', True),
                             ('stock', -1), ('stock', False), ('stock', 1.5), ('stock', None)]:
            with self.subTest(field=field, value=value):
                product = {**PRODUCTS[0], field: value}
                result = inspect_store(lambda route: [product], ADDRESS)
                self.assertEqual(result.status, 'incompatible')
                self.assertIsNone(result.product_count)

    def test_zero_price_and_stock_are_valid(self):
        result = inspect_store(lambda route: [{**PRODUCTS[0], 'price': 0, 'stock': 0}], ADDRESS)
        self.assertEqual(result.status, 'ok')

    def test_upstream_failures_never_echo_details(self):
        for error in [TimeoutError('private-error'), OSError('private-error'),
                      HTTPException(401, 'private-error'), HTTPException(403, 'private-error'),
                      HTTPException(404, 'private-error'), HTTPException(502, 'private-error')]:
            with self.subTest(error=type(error).__name__):
                result = inspect_store(Mock(side_effect=error), ADDRESS)
                self.assertEqual(result.status, 'unavailable')
                self.assertIsNone(result.product_count)
                self.assertNotIn('private-error', result.model_dump_json())

    def test_invalid_json_is_incompatible(self):
        result = inspect_store(Mock(side_effect=ValueError('private-error')), ADDRESS)
        self.assertEqual(result.status, 'incompatible')
        self.assertNotIn('private-error', result.message)

    def test_bad_configuration_does_not_make_a_request(self):
        for url in ['', 'not-a-url', 'file:///private', 'https://example.test:invalid', 'https://example.test:99999']:
            fetch = Mock()
            result = inspect_store(fetch, url)
            self.assertEqual(result.status, 'unavailable')
            self.assertIsNone(result.host)
            fetch.assert_not_called()

    def test_host_redacts_paths_credentials_and_query(self):
        self.assertEqual(public_host(ADDRESS), 'example.test:8443')
        self.assertEqual(public_host('https://example.test/path'), 'example.test:443')
        self.assertEqual(public_host('http://example.test'), 'example.test:80')
        self.assertEqual(public_host('http://[::1]:8001/path'), '[::1]:8001')


class StatusRoute(unittest.IsolatedAsyncioTestCase):
    async def test_route_uses_only_configured_store_and_leaves_actions_untouched(self):
        history, pending = copy.deepcopy(main.history), copy.deepcopy(main.pending)
        with patch.object(main, 'store', return_value=PRODUCTS) as fetch, patch.dict(os.environ, {'STORE_API_URL': ADDRESS}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                response = await client.get('/api/store/status?url=http://other.invalid')
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data['host'], 'example.test:8443')
            self.assertEqual(data['product_count'], 2)
            self.assertFalse(data['update_permissions_checked'])
            fetch.assert_called_once_with('/api/products')
            self.assertNotIn('private-', json.dumps(data))
        self.assertEqual(main.history, history)
        self.assertEqual(main.pending, pending)
