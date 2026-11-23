import React, {useEffect, useState} from 'react';
import {fetchStoreStatus} from './storeConnection.js';

export default function StoreConnection() {
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false, expired = false;
    setChecking(true);
    const timer = setTimeout(() => { expired = true; controller.abort(); }, 15000);
    fetchStoreStatus({signal: controller.signal}).then(data => {
      if (!disposed) setResult(data);
    }).catch(() => {
      if (!disposed) setResult({status: 'unavailable', host: null, product_count: null,
        message: expired ? 'The connection check timed out. Try again when the store is reachable.' :
          'Could not check the store. Check that the VaaniControl backend is running, then try again.'});
    }).finally(() => {
      clearTimeout(timer);
      if (!disposed) setChecking(false);
    });
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [attempt]);

  const status = checking ? 'checking' : result?.status;
  const title = {checking: 'Checking catalog…', ok: 'Catalog reachable', incompatible: 'Incompatible catalog', unavailable: 'Store unavailable'}[status];
  return <section className="store-connection" aria-labelledby="store-connection-heading">
    <div className="connection-content">
      <div className="connection-heading"><h2 id="store-connection-heading">Connected store</h2>
        <span className={'connection-badge connection-badge--' + status} role="status" aria-live="polite">{title}</span></div>
      {!checking && result?.host && <p className="connection-target">{result.host}{result.status === 'ok' && <span> · {result.product_count} {result.product_count === 1 ? 'product' : 'products'}</span>}</p>}
      <p className="connection-message">{checking ? 'Reading the configured store’s product list. No changes will be made.' : result?.message}</p>
      <p className="connection-note">Checks product access only. Update permissions are checked when you confirm a change.</p>
    </div>
    <button className="secondary" disabled={checking} onClick={() => setAttempt(value => value + 1)}>{checking ? 'Checking…' : 'Check connection'}</button>
  </section>;
}
