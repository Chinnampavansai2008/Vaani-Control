"""Contract tests for Person 1's store; run: python -m pytest -q tests/test_store.py"""
import importlib.util
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

STORE_MAIN = Path(__file__).resolve().parents[1] / 'store-api' / 'main.py'
spec = importlib.util.spec_from_file_location('vaani_store_module', STORE_MAIN)
store = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = store
spec.loader.exec_module(store)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store,'DB_PATH',str(tmp_path/'test.db'))
    monkeypatch.setattr(store,'STORE_API_KEY','private-test-integration-key')
    monkeypatch.setattr(store,'ADMIN_KEY','private-test-admin-key')
    store.init_database()
    with TestClient(store.app) as c:
        yield c


def control_headers(key='private-test-integration-key'):
    return {'X-API-Key':key}


def admin_headers(key='private-test-admin-key'):
    return {'X-Admin-Key':key}


def test_products_have_int_ids_and_expected_p2_seed(client):
    r=client.get('/api/products')
    assert r.status_code == 200
    products=r.json()
    assert len(products) >= 6
    assert products[0]['id'] == 1
    assert type(products[0]['id']) is int
    assert products[0]['name'] == 'Black Hoodie'
    assert products[0]['price'] == 1299
    assert products[0]['stock'] == 20
    assert client.get('/api/products/1').json()['id'] == 1


def test_integration_price_then_undo_and_stock(client):
    patch='/api/integrations/products/1'
    r=client.patch(patch,headers=control_headers(),json={'field':'price','value':999,'expected':1299})
    assert r.status_code == 200 and r.json() == {'previous':1299,'value':999}
    assert client.get('/api/products/1').json()['price'] == 999
    assert client.patch(patch,headers=control_headers(),json={'field':'price','value':9999,'expected':1299}).status_code == 409
    r=client.patch(patch,headers=control_headers(),json={'field':'price','value':1299,'expected':999})
    assert r.status_code == 200 and r.json()['value'] == 1299
    r=client.patch(patch,headers=control_headers(),json={'field':'stock','value':30,'expected':20})
    assert r.status_code == 200 and r.json() == {'previous':20,'value':30}
    assert client.get('/api/products/1').json()['stock'] == 30


def test_invalid_or_missing_credentials(client):
    route='/api/integrations/products/1'
    action={'field':'price','value':99,'expected':1299}
    assert client.patch(route,json=action).status_code == 401
    assert client.patch(route,headers=control_headers('wrong'),json=action).status_code == 401
    assert client.patch(route,headers=admin_headers(),json=action).status_code == 401
    assert client.post('/api/admin/products',json={'name':'Test','category':'Men','price':9,'stock':1}).status_code == 401


@pytest.mark.parametrize('body',[{'field':'delete','value':999,'expected':1299},
                                  {'field':'price','value':-1,'expected':1299},
                                  {'field':'stock','value':-1,'expected':20},
                                  {'field':'price','value':True,'expected':1299},
                                  {'field':'price','value':1.5,'expected':1299},
                                  {'field':'price','value':'999','expected':1299}])
def test_invalid_input_rejected(client,body):
    assert client.patch('/api/integrations/products/1',headers=control_headers(),json=body).status_code == 422


def test_not_found_and_stock_limit(client):
    assert client.patch('/api/integrations/products/10001',headers=control_headers(),json={'field':'price','value':400,'expected':0}).status_code==404
    assert client.patch('/api/integrations/products/1',headers=control_headers(),json={'field':'stock','value':100001,'expected':20}).status_code==422


def test_admin_product_create_edit_price_and_orders(client):
    created=client.post('/api/admin/products',headers=admin_headers(),json={
        'name':'New Cap','category':'Accessories','description':'Cotton cap','price':599,'stock':10,
        'image_url':'','sizes':['One size'],'colors':['Black']})
    assert created.status_code == 201, created.text
    p=created.json()
    assert type(p['id']) is int and p['name']=='New Cap'
    updated=client.put(f"/api/admin/products/{p['id']}",headers=admin_headers(),json={
        'name':'Premium Cap','category':'Accessories','description':'Soft cap','image_url':'',
        'sizes':['One size'],'colors':['Black','Blue']})
    assert updated.status_code==200 and updated.json()['name']=='Premium Cap'
    r=client.patch(f"/api/admin/products/{p['id']}/price",headers=admin_headers(),json={'new_value':649,'expected_value':599,'action_id':'test-action-price-0001'})
    assert r.status_code==200 and r.json()['new_value']==649
    order=client.post('/api/orders',json={'customer_name':'Test Buyer','email':'test@example.com','items':[{'product_id':p['id'],'quantity':2,'size':'One size','color':'Blue'}]})
    assert order.status_code==201, order.text
    assert order.json()['total']==1298 and order.json()['payment']=='demo-only-no-real-charge'
    assert client.get(f"/api/products/{p['id']}").json()['stock']==8
    orders=client.get('/api/admin/orders',headers=admin_headers()).json()
    assert orders[0]['items'][0]['name']=='Premium Cap'
    assert orders[0]['status']=='demo_pending_payment'
    assert client.get('/api/admin/actions',headers=admin_headers()).json()


def test_checkout_cannot_oversell_or_accept_invalid_options(client):
    order={'customer_name':'Test Buyer','email':'test@example.com','items':[{'product_id':1,'quantity':20,'size':'L','color':'Black'}]}
    assert client.post('/api/orders',json=order).status_code==201
    assert client.post('/api/orders',json=order).status_code==409
    assert client.get('/api/products/1').json()['stock']==0
    invalid={'customer_name':'Test Buyer','email':'test@example.com','items':[{'product_id':2,'quantity':1,'size':'???','color':'White'}]}
    assert client.post('/api/orders',json=invalid).status_code==422
    assert client.get('/api/products/2').json()['stock']==40


def test_legacy_update_route_idempotent(client):
    body={'new_value':1200,'expected_value':1299,'action_id':'test-action-legacy-0001'}
    url='/api/integrations/products/1/price'
    headers={'X-Integration-Key':'private-test-integration-key'}
    r=client.patch(url,headers=headers,json=body)
    assert r.status_code==200
    r2=client.patch(url,headers=headers,json=body)
    assert r2.status_code==200 and r2.json()['idempotent'] is True
    assert client.patch(url,headers=headers,json={**body,'new_value':1000}).status_code==409


def test_concurrent_cas_only_one_update_succeeds(client):
    url='/api/integrations/products/1'
    def call(v): return client.patch(url,headers=control_headers(),json={'field':'price','value':v,'expected':1299}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses=list(pool.map(call,[995,996]))
    assert sorted(statuses)==[200,409]


def checkout_body(items):
    return {'customer_name':'Test Buyer','email':'test@example.com','items':items}


@pytest.mark.parametrize('new_price',[999,1499,0])
def test_stale_checkout_price_rejected_without_order_or_inventory_change(client,new_price):
    changed=client.patch('/api/integrations/products/1',headers=control_headers(),json={'field':'price','value':new_price,'expected':1299})
    assert changed.status_code==200
    response=client.post('/api/orders',json=checkout_body([{'product_id':1,'quantity':2,'size':'M','color':'Black','expected_unit_price':1299}]))
    assert response.status_code==409
    assert response.json()['detail']['code']=='price_changed'
    assert client.get('/api/products/1').json()['stock']==20
    assert client.get('/api/admin/orders',headers=admin_headers()).json()==[]


@pytest.mark.parametrize('price',[1299,0])
def test_matching_expected_price_checkout_succeeds(client,price):
    if price==0:
        assert client.patch('/api/integrations/products/1',headers=control_headers(),json={'field':'price','value':0,'expected':1299}).status_code==200
    response=client.post('/api/orders',json=checkout_body([{'product_id':1,'quantity':2,'size':'M','color':'Black','expected_unit_price':price}]))
    assert response.status_code==201
    assert response.json()['total']==2*price
    assert response.json()['items'][0]['unit_price']==price
    assert client.get('/api/products/1').json()['stock']==18


def test_one_stale_line_rejects_entire_order_without_partial_writes(client):
    items=[{'product_id':1,'quantity':1,'size':'M','color':'Black','expected_unit_price':1299},
           {'product_id':2,'quantity':1,'size':'M','color':'White','expected_unit_price':399}]
    assert client.post('/api/orders',json=checkout_body(items)).status_code==409
    assert [p['stock'] for p in client.get('/api/products').json()][:2]==[20,40]
    with store.db() as con:
        assert con.execute('SELECT COUNT(*) FROM orders').fetchone()[0]==0
        assert con.execute('SELECT COUNT(*) FROM order_items').fetchone()[0]==0


def test_each_size_line_must_match_the_current_price(client):
    items=[{'product_id':1,'quantity':1,'size':size,'color':'Black','expected_unit_price':price} for size,price in [('M',1299),('L',999)]]
    assert client.post('/api/orders',json=checkout_body(items)).status_code==409
    assert client.get('/api/products/1').json()['stock']==20


@pytest.mark.parametrize('price',[True,-1,1.5,'1299',{},[]])
def test_invalid_expected_unit_price_rejected(client,price):
    response=client.post('/api/orders',json=checkout_body([{'product_id':1,'quantity':1,'size':'M','color':'Black','expected_unit_price':price}]))
    assert response.status_code==422
    assert client.get('/api/products/1').json()['stock']==20
