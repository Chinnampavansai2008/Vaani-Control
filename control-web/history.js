// Filtering returns the original action objects in their existing order.
export function filterHistory(history, {search = '', type = 'all', status = 'all'} = {}) {
  const query = search.trim().toLowerCase();
  return history.filter(action =>
    String(action.product ?? '').toLowerCase().includes(query) &&
    (type === 'all' || action.field === type) &&
    (status === 'all' || action.status === status)
  );
}
