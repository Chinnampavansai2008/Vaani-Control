export async function fetchStoreStatus({fetcher = globalThis.fetch, signal} = {}) {
  const response = await fetcher('/api/store/status', {signal});
  const data = await response.json();
  if (!response.ok || !data || !['ok', 'incompatible', 'unavailable'].includes(data.status) ||
      !(data.host === null || typeof data.host === 'string') || typeof data.message !== 'string' ||
      data.update_permissions_checked !== false ||
      (data.status === 'ok' ? !Number.isInteger(data.product_count) || data.product_count < 0 : data.product_count !== null)) {
    throw new Error('The backend could not provide a valid store check.');
  }
  return data;
}
