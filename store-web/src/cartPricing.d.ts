type PricedLine = {product_id:number; name:string; price:number; quantity:number; size:string; color:string};
export function reconcileCartPrices<T extends PricedLine>(cart:T[], products:{id:number;price:number}[]): {items:T[];changed:boolean;unavailable:string[]};
export function buildOrderItems(cart:PricedLine[]): {product_id:number;quantity:number;size:string;color:string;expected_unit_price:number}[];
