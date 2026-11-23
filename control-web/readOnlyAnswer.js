export function validateReadOnlyAnswer(data) {
  if (!data || data.read_only !== true || !Number.isSafeInteger(data.product_id) ||
      typeof data.product !== 'string' || !data.product.trim() ||
      !['price', 'stock'].includes(data.field) || !Number.isSafeInteger(data.value) || data.value < 0) {
    throw new Error('The store did not return a valid read-only answer. Please try again.');
  }
  return {product_id: data.product_id, product: data.product, field: data.field, value: data.value, read_only: true};
}
