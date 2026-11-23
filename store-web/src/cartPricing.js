// Keep selected options and quantities; only the catalog determines displayed prices.
export function reconcileCartPrices(cart, products) {
  const catalog = new Map(products.map(product => [product.id, product]));
  const unavailable = [];
  let changed = false;
  const items = cart.map(item => {
    const product = catalog.get(item.product_id);
    if (!product || !Number.isSafeInteger(product.price) || product.price < 0) {
      unavailable.push(item.name);
      return item;
    }
    if (item.price === product.price) return item;
    changed = true;
    return {...item, price: product.price};
  });
  return {items: changed ? items : cart, changed, unavailable};
}

export function buildOrderItems(cart) {
  return cart.map(item => {
    if (!Number.isSafeInteger(item.price) || item.price < 0) throw new Error('Review the bag prices before checkout.');
    return {product_id: item.product_id, quantity: item.quantity, size: item.size, color: item.color, expected_unit_price: item.price};
  });
}
