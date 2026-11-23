"""Read-only catalog compatibility check; never probes update permissions."""
from urllib.parse import urlsplit
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel


class StoreStatus(BaseModel):
    status: Literal['ok', 'incompatible', 'unavailable']
    host: str | None
    product_count: int | None
    message: str
    update_permissions_checked: Literal[False] = False


def public_host(base_url):
    try:
        address = urlsplit(base_url)
        if address.scheme not in {'http', 'https'} or not address.hostname:
            return None
        host = address.hostname
        if ':' in host:
            host = '[' + host + ']'
        port = address.port if address.port is not None else (443 if address.scheme == 'https' else 80)
        return host + ':' + str(port)
    except (TypeError, ValueError):
        return None


def inspect_store(fetch, base_url):
    host = public_host(base_url)

    def result(status, message, count=None):
        return StoreStatus(status=status, host=host, product_count=count, message=message)

    if host is None:
        return result('unavailable', 'The configured store address is invalid. Check STORE_API_URL privately in the backend configuration.')
    try:
        products = fetch('/api/products')
    except HTTPException as error:
        if error.status_code in (401, 403):
            return result('unavailable', 'The store denied access to its catalog. Check the store integration credentials.')
        if error.status_code == 404:
            return result('unavailable', 'The store product-list endpoint was not found. It must provide GET /api/products.')
        return result('unavailable', 'Could not read the store catalog. Check that the store backend is running and reachable.')
    except TimeoutError:
        return result('unavailable', 'The store did not respond in time. Check its address and try again.')
    except ValueError:
        return result('incompatible', 'The store did not return a readable JSON product list.')
    except Exception:
        # Upstream bodies and exception messages may contain private credentials.
        return result('unavailable', 'Could not read the store catalog. Check that the store backend is running and reachable.')

    if not isinstance(products, list):
        return result('incompatible', 'The store must return a JSON list of products.')
    ids = set()
    for product in products:
        if not isinstance(product, dict):
            return result('incompatible', 'Each catalog entry must be a product object.')
        pid = product.get('id')
        if type(pid) is not int or pid in ids:
            return result('incompatible', 'Product IDs must be unique integers. String IDs need a compatibility update before using this build.')
        ids.add(pid)
        if not isinstance(product.get('name'), str) or not product['name'].strip():
            return result('incompatible', 'Every product needs a nonempty name.')
        if any(type(product.get(field)) is not int or product[field] < 0 for field in ('price', 'stock')):
            return result('incompatible', 'Product prices and stock must be nonnegative whole numbers.')
    return result('ok', 'Catalog reachable and compatible.' if products else 'Catalog reachable. No products have been added yet.', len(products))
