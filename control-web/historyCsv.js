const HEADERS = ['Timestamp', 'Product', 'Action', 'Previous value', 'New value', 'Status', 'Undone at'];

function cell(value) {
  // Numeric values remain numbers; only text cells need formula protection.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let text = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function generateHistoryCsv(actions) {
  const rows = [HEADERS, ...actions.map(action => [
    action.timestamp, action.product, action.field, action.previous,
    action.value, action.status, action.undone_at,
  ])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function historyCsvFilename(date = new Date()) {
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return `vaanicontrol-history-${day}.csv`;
}

export function downloadHistoryCsv(actions, {
  date = new Date(), doc = globalThis.document, urls = globalThis.URL, schedule = globalThis.setTimeout,
} = {}) {
  if (!actions.length) return false;
  const blob = new Blob([generateHistoryCsv(actions)], {type: 'text/csv;charset=utf-8'});
  const url = urls.createObjectURL(blob);
  let link;
  try {
    link = doc.createElement('a');
    link.href = url;
    link.download = historyCsvFilename(date);
    link.hidden = true;
    doc.body.appendChild(link);
    link.click();
  } finally {
    link?.remove();
    // Give the browser time to start the download before releasing the URL.
    schedule(() => urls.revokeObjectURL(url), 1000);
  }
  return true;
}
