import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import {reconcileCartPrices, buildOrderItems} from './cartPricing.js';

const API = import.meta.env.VITE_STORE_API_URL || 'http://localhost:8001';
type Product = { id:number; name:string; category:string; description:string; price:number; stock:number; image_url:string; sizes:string[]; colors:string[] };
type CartItem = { key:string; product_id:number; name:string; price:number; quantity:number; size:string; color:string };
const money = (n:number) => `₹${n.toLocaleString('en-IN')}`;

function App() {
  const [products,setProducts] = useState<Product[]>([]);
  const [savedCart,setCart] = useState<CartItem[]>([]);
  const {items:cart, changed:cartPricesChanged, unavailable} = reconcileCartPrices(savedCart,products);
  const [tab,setTab] = useState<'shop'|'admin'>('shop');
  const [filter,setFilter] = useState('All');
  const [search,setSearch] = useState('');
  const [cartOpen,setCartOpen] = useState(false);
  const [selected,setSelected] = useState<Record<string,{size:string;color:string}>>({});
  const [checkout,setCheckout] = useState({name:'',email:''});
  const [adminKey,setAdminKey] = useState('');
  const [newProduct,setNewProduct] = useState({name:'',category:'Unisex',description:'',price:'999',stock:'10',image_url:''});
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const [orders,setOrders] = useState<{id:number;customer_name:string;email:string;total:number;status:string;created_at:string;items:{name:string;quantity:number;size:string;color:string}[]}[]>([]);
  const [adminView,setAdminView] = useState<'inventory'|'orders'>('inventory');
  const [productEdit,setProductEdit] = useState<Record<string,{price:string;stock:string}>>({});

  async function load() {
    try { const r = await fetch(`${API}/api/products`); if (!r.ok) throw new Error('Store API unavailable'); setProducts(await r.json()); }
    catch { setMessage('Cannot reach store API. Start the store backend on port 8001.'); }
  }
  useEffect(()=>{ void load(); const t = window.setInterval(()=>{void load()},3000); return ()=>clearInterval(t); },[]);
  const categories = useMemo(()=>['All',...new Set(products.map(p=>p.category))], [products]);
  const visible = products.filter(p => (filter==='All' || p.category===filter) && `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase()));
  const total = cart.reduce((a,x)=>a+x.price*x.quantity,0);
  const count = cart.reduce((a,x)=>a+x.quantity,0);

  function addToCart(p:Product) {
    if (p.stock === 0) return;
    const options = selected[p.id] || {size:p.sizes[0], color:p.colors[0]};
    const key = `${p.id}/${options.size}/${options.color}`;
    setCart(items=>{
      const existing = items.find(x=>x.key===key);
      if (existing) return items.map(x=>x.key===key ? {...x,quantity:Math.min(p.stock,x.quantity+1)} : x);
      return [...items,{key,product_id:p.id,name:p.name,price:p.price,quantity:1,...options}];
    });
    setCartOpen(true);
  }

  async function order() {
    if (unavailable.length) return setMessage('Some bag products are unavailable. Remove them before checkout.');
    if (!checkout.name.trim() || !checkout.email.includes('@')) return setMessage('Enter your name and a valid email for demo checkout.');
    setBusy(true);setMessage('');
    try {
      const response = await fetch(`${API}/api/orders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name:checkout.name,email:checkout.email,items:buildOrderItems(cart)})});
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(result.detail?.code === 'price_changed' ? result.detail.message : typeof result.detail === 'string' ? result.detail : 'Checkout failed. Please review your bag and try again.');
      }
      setMessage(`Demo order #${result.order_id} created! Total ${money(result.total)}. No payment was collected.`);
      setCart([]);setCartOpen(false);void load();
    } catch(e) {setMessage(e instanceof Error? e.message:'Order failed');}
    finally {setBusy(false);}
  }

  async function loadOrders() {
    try { const r=await fetch(`${API}/api/admin/orders`,{headers:{'X-Admin-Key':adminKey}}); const data=await r.json(); if (!r.ok) throw new Error(typeof data.detail==='string'?data.detail:'Could not load orders'); setOrders(data);setAdminView('orders');setMessage(''); }
    catch(e) { setMessage(e instanceof Error?e.message:'Could not load orders'); }
  }

  async function createProduct() {
    if (!newProduct.name.trim()) { setMessage('Enter a product name first.'); return; }
    setBusy(true);setMessage('');
    try {
      const r=await fetch(`${API}/api/admin/products`,{method:'POST',headers:{'X-Admin-Key':adminKey,'Content-Type':'application/json'},body:JSON.stringify({...newProduct,price:Number(newProduct.price),stock:Number(newProduct.stock),sizes:['S','M','L','XL'],colors:['Black']})});
      const data=await r.json();if(!r.ok) throw new Error(data.detail || 'Unable to add product');
      setMessage(`${data.name} added to the live store.`);setNewProduct({name:'',category:'Unisex',description:'',price:'999',stock:'10',image_url:''});void load();
    }catch(e){setMessage(e instanceof Error?e.message:'Error');}
    finally{setBusy(false);}
  }

  async function updateProduct(p:Product,field:'price'|'stock') {
    const value = Number(productEdit[p.id]?.[field] ?? p[field]);
    if (!Number.isSafeInteger(value) || value < 0) { setMessage('Enter a nonnegative whole number.');return; }
    setBusy(true);setMessage('');
    try {
      const r=await fetch(`${API}/api/admin/products/${p.id}/${field}`,{method:'PATCH',headers:{'X-Admin-Key':adminKey,'Content-Type':'application/json'},body:JSON.stringify({expected_value:p[field],new_value:value,action_id:crypto.randomUUID()})});
      const data=await r.json();if(!r.ok) throw new Error(data.detail || 'Update failed');
      setMessage(`${p.name} ${field} updated successfully.`);setProductEdit(s=>{const copy={...s};delete copy[p.id];return copy;});void load();
    }catch(e){setMessage(e instanceof Error?e.message:'Update failed');}
    finally{setBusy(false);}
  }

  return <>
    <div className="promo">A NEW SEASON OF EVERYDAY STYLE <span>✦</span> WELCOME TO VAANI FASHION</div>
    <header className="nav"><button className="logo" onClick={()=>setTab('shop')}>VAANI<span>.</span> <small>FASHION</small></button><nav><button className={tab==='shop'?'active':''} onClick={()=>setTab('shop')}>Shop collection</button><button className={tab==='admin'?'active':''} onClick={()=>setTab('admin')}>Seller studio</button></nav><button className="bag" onClick={()=>setCartOpen(true)}>Bag <span>{count}</span></button></header>
    {tab==='shop' ? <>
      <section className="hero"><div className="hero-copy"><div className="eyebrow">THE EVERYDAY EDIT / 2026</div><h1>Wear your<br/><em>own story.</em></h1><p>Versatile essentials. Thoughtful details. Made for the way you move through the world.</p><button className="button dark" onClick={()=>document.getElementById('collection')?.scrollIntoView({behavior:'smooth'})}>Explore collection <span>↗</span></button></div><div className="hero-art"><div className="hero-shape"><div>VAANI</div><span>THE NEW<br/>ESSENTIALS</span></div><div className="hero-number">01 / 06</div></div></section>
      <section className="collection" id="collection"><div className="section-heading"><div><div className="eyebrow">SELECTED FOR YOU</div><h2>Discover the collection</h2></div><p>Find your next favorite fit.</p></div><div className="toolbar"><div className="filters">{categories.map(c=><button key={c} className={filter===c?'filter selected':'filter'} onClick={()=>setFilter(c)}>{c}</button>)}</div><input className="search" placeholder="Search styles..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
      <div className="product-grid">{visible.map((p,i)=><article className="product-card" key={p.id}><div className={`product-image shade-${i%5}`}><img src={p.image_url} alt={p.name} onError={e=>{e.currentTarget.style.display='none'}}/><span className="tag">{p.stock===0?'SOLD OUT':'NEW EDIT'}</span></div><div className="product-meta"><div><small>{p.category.toUpperCase()}</small><h3>{p.name}</h3></div><strong>{money(p.price)}</strong></div><p className="desc">{p.description}</p><div className="options"><select value={(selected[p.id]?.size)||p.sizes[0]} onChange={e=>setSelected(s=>({...s,[p.id]:{size:e.target.value,color:s[p.id]?.color||p.colors[0]}}))}>{p.sizes.map(x=><option key={x}>{x}</option>)}</select><select value={selected[p.id]?.color||p.colors[0]} onChange={e=>setSelected(s=>({...s,[p.id]:{size:s[p.id]?.size||p.sizes[0],color:e.target.value}}))}>{p.colors.map(x=><option key={x}>{x}</option>)}</select></div><button className="button outline full" onClick={()=>addToCart(p)} disabled={p.stock===0}>{p.stock?'Add to bag +':'Sold out'}</button></article>)}</div>{visible.length===0&&<p>No styles match your search.</p>}</section>
      <footer><span>VAANI<span className="dot">.</span> FASHION</span><small>Designed as a working hackathon demo · Checkout is simulated, not a live payment.</small></footer>
    </> : <main className="studio"><div className="eyebrow">STORE ADMINISTRATION</div><h1>Seller studio</h1><p>Manage your fashion store independently. Updates from VaaniControl will also appear here.</p><div className="admin-auth"><label>Local demo admin key <input type="password" placeholder="Enter STORE_ADMIN_KEY" value={adminKey} onChange={e=>setAdminKey(e.target.value)}/></label><small>Only for localhost development. Add production auth before deployment.</small></div><div className="seller-switch"><button className={adminView==='inventory'?'selected':''} onClick={()=>setAdminView('inventory')}>Product inventory</button><button className={adminView==='orders'?'selected':''} onClick={()=>void loadOrders()}>Orders</button></div>{adminView==='inventory' ? <><h2>Product inventory</h2><div className="admin-products">{products.map(p=><div key={p.id} className="admin-item"><div><strong>{p.name}</strong><small>{p.id}</small></div><label>Price (₹)<input type="number" min="0" value={productEdit[p.id]?.price ?? String(p.price)} onChange={e=>setProductEdit(s=>({...s,[p.id]:{price:e.target.value,stock:s[p.id]?.stock ?? String(p.stock)}}))}/></label><button className="mini-btn" disabled={busy} onClick={()=>void updateProduct(p,'price')}>Save price</button><label>Stock<input type="number" min="0" value={productEdit[p.id]?.stock ?? String(p.stock)} onChange={e=>setProductEdit(s=>({...s,[p.id]:{price:s[p.id]?.price ?? String(p.price),stock:e.target.value}}))}/></label><button className="mini-btn" disabled={busy} onClick={()=>void updateProduct(p,'stock')}>Save stock</button></div>)}</div><h2>Add a new product</h2><div className="admin-form">{(Object.keys(newProduct) as (keyof typeof newProduct)[]).map(k=><label key={k}>{k.replace('_',' ')}<input value={newProduct[k]} onChange={e=>setNewProduct(s=>({...s,[k]:e.target.value}))}/></label>)}<button className="button dark" disabled={busy} onClick={()=>void createProduct()}>Create product</button></div></> : <><h2>Recent demo orders</h2><p>Orders are saved in the store database. These are demo checkouts; no payments are processed.</p><div className="order-list">{orders.length ? orders.map(o=><article className="order-card" key={o.id}><div className="order-top"><strong>Order #{o.id}</strong><span>{money(o.total)}</span></div><div>{o.customer_name} · {o.email}</div><small>{o.created_at} · {o.status.replaceAll('_',' ')}</small><div className="order-items">{o.items.map((item,i)=><small key={i}>{item.quantity}× {item.name} ({item.size}, {item.color})</small>)}</div></article>) : <p>No demo orders yet. Place one in the shop.</p>}</div></>}</main>}
    {message&&<div className="toast" role="status">{message}<button onClick={()=>setMessage('')}>×</button></div>}
    {cartOpen&&<div className="cart-backdrop" onMouseDown={()=>setCartOpen(false)}><aside className="cart-panel" onMouseDown={e=>e.stopPropagation()}><div className="cart-head"><h2>Your bag ({count})</h2><button onClick={()=>setCartOpen(false)}>✕</button></div>{!cart.length?<div className="empty">Your bag is waiting for something great.</div>:<><div className="cart-items">{cart.map(x=><div className="cart-row" key={x.key}><div><strong>{x.name}</strong><small>{x.size} · {x.color} · {money(x.price)}</small></div><div className="qty"><button onClick={()=>setCart(c=>c.map(y=>y.key===x.key?{...y,quantity:Math.max(0,y.quantity-1)}:y).filter(y=>y.quantity>0))}>−</button><span>{x.quantity}</span><button onClick={()=>setCart(c=>c.map(y=>y.key===x.key?{...y,quantity:y.quantity+1}:y))}>+</button></div></div>)}</div><div className="cart-checkout">{unavailable.length>0 ? <p className="demo-label" role="alert">Unavailable: {unavailable.join(', ')}. Remove these items before checkout.</p> : cartPricesChanged ? <p className="demo-label" role="status">Prices have changed. Your bag now shows current prices; review the updated total before ordering.</p> : null}<div className="subtotal"><span>Subtotal</span><strong>{money(total)}</strong></div><p className="demo-label">DEMO CHECKOUT — NO REAL PAYMENT</p><input placeholder="Your full name" value={checkout.name} onChange={e=>setCheckout(s=>({...s,name:e.target.value}))}/><input placeholder="Email address" type="email" value={checkout.email} onChange={e=>setCheckout(s=>({...s,email:e.target.value}))}/><button className="button dark full" disabled={busy || unavailable.length>0} onClick={()=>void order()}>{busy?'Placing...':'Place demo order →'}</button></div></>}</aside></div>}
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
