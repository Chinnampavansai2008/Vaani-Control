"""Vaani Fashion: independent, persistent local-demo store backend.

The voice controller NEVER connects to this store's database. It uses the
conditional PATCH API with X-API-Key, exactly as Person 2 requested.
This is a hackathon prototype, not a public/production commerce backend.
"""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).with_name('.env'))
DB_PATH = os.getenv('STORE_DB_PATH', str(Path(__file__).with_name('store.db')))
STORE_API_KEY = os.getenv('STORE_API_KEY', 'local-demo-key')
ADMIN_KEY = os.getenv('STORE_ADMIN_KEY', 'local-admin-key')
ALLOWED_ORIGINS = [s.strip() for s in os.getenv('STORE_CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',') if s.strip()]

app = FastAPI(title='Vaani Fashion Store API', version='1.0.0', description='Independent clothing store with authenticated, conflict-safe voice integration API')
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=['GET','POST','PATCH','PUT'], allow_headers=['Content-Type','X-API-Key','X-Admin-Key','X-Integration-Key'])

PRODUCTS = [
    (1, 'Black Hoodie', 'Streetwear', 'Midweight relaxed-fit cotton hoodie.', 1299, 20, 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=800&auto=format&fit=crop', '["S","M","L","XL"]', '["Black"]'),
    (2, 'White T-Shirt', 'Unisex', 'Soft everyday cotton tee with a clean silhouette.', 499, 40, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&auto=format&fit=crop', '["XS","S","M","L","XL"]', '["White","Black"]'),
    (3, 'Linen Summer Shirt', 'Men', 'Breathable linen blend for sunny days.', 1599, 16, 'https://images.unsplash.com/photo-1598032895397-b9472444bf93?w=800&auto=format&fit=crop', '["S","M","L","XL"]', '["White","Sand"]'),
    (4, 'Classic Denim Jacket', 'Unisex', 'An easy-to-layer everyday denim essential.', 2399, 12, 'https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=800&auto=format&fit=crop', '["S","M","L"]', '["Blue"]'),
    (5, 'Floral Midi Dress', 'Women', 'Flowy midi dress with delicate floral details.', 1899, 11, 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=800&auto=format&fit=crop', '["XS","S","M","L"]', '["Blue","Pink"]'),
    (6, 'Wide Leg Trousers', 'Women', 'Relaxed-fit trousers for effortless styling.', 1499, 19, 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800&auto=format&fit=crop', '["S","M","L"]', '["Beige","Black"]'),
]


def connect():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, isolation_level=None, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA busy_timeout=15000')
    con.execute('PRAGMA foreign_keys=ON')
    return con


@contextmanager
def db():
    con = connect()
    try:
        yield con
    finally:
        con.close()


def init_database():
    with db() as con:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL CHECK(price>=0),
          stock INTEGER NOT NULL CHECK(stock>=0), image_url TEXT NOT NULL DEFAULT '',
          sizes TEXT NOT NULL, colors TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS store_actions (
          action_id TEXT PRIMARY KEY, product_id INTEGER NOT NULL, field TEXT NOT NULL,
          old_value INTEGER NOT NULL, new_value INTEGER NOT NULL,
          source TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL,
          email TEXT NOT NULL, total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'demo_pending_payment',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS order_items (
          order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, name TEXT NOT NULL,
          quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL,
          size TEXT NOT NULL, color TEXT NOT NULL,
          FOREIGN KEY(order_id) REFERENCES orders(id)
        );
        ''')
        if con.execute('SELECT COUNT(*) FROM products').fetchone()[0] == 0:
            con.executemany('INSERT INTO products (id,name,category,description,price,stock,image_url,sizes,colors) VALUES (?,?,?,?,?,?,?,?,?)', PRODUCTS)


def as_product(row):
    p = dict(row)
    p['sizes'] = json.loads(p['sizes'])
    p['colors'] = json.loads(p['colors'])
    return p


def require_control(x_api_key: str | None = Header(default=None)):
    if not x_api_key or not secrets.compare_digest(x_api_key, STORE_API_KEY):
        raise HTTPException(401, 'Invalid or missing API key')


def require_admin(x_admin_key: str | None = Header(default=None)):
    if not x_admin_key or not secrets.compare_digest(x_admin_key, ADMIN_KEY):
        raise HTTPException(401, 'Invalid or missing admin key')


def require_legacy(x_integration_key: str | None = Header(default=None)):
    if not x_integration_key or not secrets.compare_digest(x_integration_key, STORE_API_KEY):
        raise HTTPException(401, 'Invalid integration key')


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    category: str = Field(min_length=2, max_length=60)
    description: str = Field(default='', max_length=1000)
    price: int = Field(ge=0, le=10_000_000, strict=True)
    stock: int = Field(ge=0, le=100_000, strict=True)
    image_url: str = Field(default='', max_length=2000)
    sizes: list[str] = Field(default_factory=lambda: ['S','M','L'], min_length=1)
    colors: list[str] = Field(default_factory=lambda: ['Black'], min_length=1)


class ProductEdit(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    category: str = Field(min_length=2, max_length=60)
    description: str = Field(default='', max_length=1000)
    image_url: str = Field(default='', max_length=2000)
    sizes: list[str] = Field(min_length=1)
    colors: list[str] = Field(min_length=1)


class VoiceUpdate(BaseModel):
    field: Literal['price','stock']
    value: int = Field(ge=0, le=10_000_000, strict=True)
    expected: int = Field(ge=0, le=10_000_000, strict=True)


class LegacyUpdate(BaseModel):
    new_value: int = Field(ge=0, le=10_000_000, strict=True)
    expected_value: int = Field(ge=0, le=10_000_000, strict=True)
    action_id: str = Field(min_length=8, max_length=100)


class CartLine(BaseModel):
    product_id: int = Field(ge=1, strict=True)
    quantity: int = Field(ge=1, le=20, strict=True)
    size: str = Field(min_length=1, max_length=20)
    color: str = Field(min_length=1, max_length=30)
    expected_unit_price: int | None = Field(default=None, ge=0, strict=True)


class OrderCreate(BaseModel):
    customer_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=150)
    items: list[CartLine] = Field(min_length=1, max_length=30)


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'store'}


@app.get('/api/products')
def list_products():
    with db() as con:
        return [as_product(p) for p in con.execute('SELECT * FROM products ORDER BY id')]


@app.get('/api/products/{product_id}')
def get_product(product_id: int):
    with db() as con:
        p = con.execute('SELECT * FROM products WHERE id=?', (product_id,)).fetchone()
    if p is None:
        raise HTTPException(404, 'Product not found')
    return as_product(p)


def transactional_change(product_id: int, field: Literal['price','stock'], value: int, expected: int, source: str, action_id: str | None = None):
    max_value = 100_000 if field == 'stock' else 10_000_000
    if value > max_value or expected > max_value:
        raise HTTPException(422, f'{field} exceeds allowed range')
    action_id = action_id or str(uuid.uuid4())
    with db() as con:
        try:
            con.execute('BEGIN IMMEDIATE')
            previous_action = con.execute('SELECT * FROM store_actions WHERE action_id=?', (action_id,)).fetchone()
            if previous_action:
                if (previous_action['product_id'], previous_action['field'], previous_action['old_value'], previous_action['new_value']) != (product_id,field,expected,value):
                    raise HTTPException(409, 'Action ID was already used for a different update')
                con.commit()
                return {'previous': previous_action['old_value'], 'value': previous_action['new_value'], 'idempotent': True}
            row = con.execute(f'SELECT {field} FROM products WHERE id=?', (product_id,)).fetchone()
            if row is None:
                raise HTTPException(404, 'Product not found')
            previous = row[field]
            if previous != expected:
                raise HTTPException(409, f'Conflict: expected {field} {expected} but current is {previous}')
            con.execute(f'UPDATE products SET {field}=? WHERE id=?', (value,product_id))
            con.execute('INSERT INTO store_actions (action_id,product_id,field,old_value,new_value,source,created_at) VALUES (?,?,?,?,?,?,?)',
                        (action_id,product_id,field,previous,value,source,datetime.now(timezone.utc).isoformat()))
            con.commit()
            return {'previous': previous, 'value': value}
        except Exception:
            con.rollback()
            raise


@app.patch('/api/integrations/products/{product_id}', dependencies=[Depends(require_control)])
def voice_update(product_id: int, body: VoiceUpdate):
    """Exact Person 2 integration contract. No direct AI database writes."""
    return transactional_change(product_id, body.field, body.value, body.expected, 'vaanicontrol')


@app.patch('/api/integrations/products/{product_id}/price', dependencies=[Depends(require_legacy)])
def legacy_price_update(product_id: int, body: LegacyUpdate):
    return transactional_change(product_id,'price',body.new_value,body.expected_value,'legacy-integration',body.action_id)


@app.patch('/api/integrations/products/{product_id}/stock', dependencies=[Depends(require_legacy)])
def legacy_stock_update(product_id: int, body: LegacyUpdate):
    return transactional_change(product_id,'stock',body.new_value,body.expected_value,'legacy-integration',body.action_id)


@app.post('/api/admin/products', dependencies=[Depends(require_admin)], status_code=201)
def add_product(body: ProductCreate):
    with db() as con:
        cur = con.execute('''INSERT INTO products (name,category,description,price,stock,image_url,sizes,colors) VALUES (?,?,?,?,?,?,?,?)''',
                          (body.name,body.category,body.description,body.price,body.stock,body.image_url,json.dumps(body.sizes),json.dumps(body.colors)))
        new_id = cur.lastrowid
    return get_product(new_id)


@app.put('/api/admin/products/{product_id}', dependencies=[Depends(require_admin)])
def edit_product(product_id: int, body: ProductEdit):
    with db() as con:
        if con.execute('SELECT id FROM products WHERE id=?', (product_id,)).fetchone() is None:
            raise HTTPException(404, 'Product not found')
        con.execute('''UPDATE products SET name=?,category=?,description=?,image_url=?,sizes=?,colors=? WHERE id=?''',
                    (body.name,body.category,body.description,body.image_url,json.dumps(body.sizes),json.dumps(body.colors),product_id))
    return get_product(product_id)


@app.patch('/api/admin/products/{product_id}/{field}', dependencies=[Depends(require_admin)])
def admin_update(product_id: int,field: Literal['price','stock'],body: LegacyUpdate):
    result = transactional_change(product_id,field,body.new_value,body.expected_value,'store-admin',body.action_id)
    return {'id':product_id,'old_value':result['previous'],'new_value':result['value'],'action_id':body.action_id}


@app.post('/api/orders', status_code=201)
def place_order(body: OrderCreate):
    # Demo order: updates real inventory; does NOT charge real money.
    if not body.email.strip() or '@' not in body.email:
        raise HTTPException(422, 'Valid customer email is required')
    with db() as con:
        try:
            con.execute('BEGIN IMMEDIATE')
            quantities: dict[int,int] = {}
            total = 0
            details = []
            for item in body.items:
                quantities[item.product_id] = quantities.get(item.product_id,0) + item.quantity
            for pid, qty in quantities.items():
                if qty > 20:
                    raise HTTPException(422, 'Maximum 20 units per product')
                p = con.execute('SELECT * FROM products WHERE id=?', (pid,)).fetchone()
                if p is None:
                    raise HTTPException(404, f'Unknown product ID {pid}')
                if p['stock'] < qty:
                    raise HTTPException(409, f'Not enough stock for {p["name"]}')
                total += p['price'] * qty
            for item in body.items:
                p = con.execute('SELECT * FROM products WHERE id=?', (item.product_id,)).fetchone()
                if item.expected_unit_price is not None and item.expected_unit_price != p['price']:
                    raise HTTPException(409, {'code': 'price_changed', 'message': f'Price changed for {p["name"]}. Review the updated bag total and place your order again.'})
                if item.size not in json.loads(p['sizes']) or item.color not in json.loads(p['colors']):
                    raise HTTPException(422, f'Invalid size/color for {p["name"]}')
                details.append((item.product_id,p['name'],item.quantity,p['price'],item.size,item.color))
            for pid,qty in quantities.items():
                con.execute('UPDATE products SET stock=stock-? WHERE id=?', (qty,pid))
            cur = con.execute('INSERT INTO orders (customer_name,email,total,status,created_at) VALUES (?,?,?,?,?)',
                              (body.customer_name,body.email,total,'demo_pending_payment',datetime.now(timezone.utc).isoformat()))
            order_id=cur.lastrowid
            for pid,name,qty,unit_price,size,color in details:
                con.execute('INSERT INTO order_items (order_id,product_id,name,quantity,unit_price,size,color) VALUES (?,?,?,?,?,?,?)',
                            (order_id,pid,name,qty,unit_price,size,color))
            con.commit()
            return {'order_id':order_id,'total':total,'payment':'demo-only-no-real-charge','status':'demo_pending_payment',
                    'items':[{'product_id':pid,'name':name,'quantity':qty,'unit_price':unit_price,'size':size,'color':color}
                             for pid,name,qty,unit_price,size,color in details]}
        except Exception:
            con.rollback()
            raise


@app.get('/api/admin/orders', dependencies=[Depends(require_admin)])
def get_orders():
    with db() as con:
        rows=[dict(r) for r in con.execute('SELECT * FROM orders ORDER BY id DESC LIMIT 100')]
        for row in rows:
            row['items']=[dict(r) for r in con.execute('SELECT product_id,name,quantity,unit_price,size,color FROM order_items WHERE order_id=?', (row['id'],))]
        return rows


@app.get('/api/admin/actions', dependencies=[Depends(require_admin)])
def get_actions():
    with db() as con:
        return [dict(r) for r in con.execute('SELECT * FROM store_actions ORDER BY created_at DESC LIMIT 100')]


init_database()
