// Derive display groups from names so existing arrivals also get grouping.
const types = [
  ['Чехол конверт', /^чехол[\s-]+конверт(?=\s|$)/u],
  ['Защитный чехол', /^защитный\s+чехол(?=\s|$)/u],
  ['Защитная плёнка', /^защитная\s+пленка(?=\s|$)/u],
  ['Защитное стекло', /^защитное\s+стекло(?=\s|$)/u],
  ['Чехол', /^чехол(?=\s|$)/u],
  ['Кабель', /^кабель(?=\s|$)/u],
  ['Зарядное устройство', /^зарядное\s+устройство(?=\s|$)/u],
  ['Аккумулятор', /^(?:внешний\s+)?аккумулятор(?=\s|$)/u]
];
export function productType(name) {
  const normalized=String(name??'').trim().toLowerCase().replaceAll('ё','е').replace(/[‐‑–—]/g,'-');
  return types.find(([,pattern])=>pattern.test(normalized))?.[0] || 'Прочие товары';
}
export function groupProducts(products) {
  const groups=new Map();
  for(const product of products){
    const name=productType(product.name);
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(product);
  }
  // Keep the file/catalog order within each group; never change product IDs or data.
  return [...groups].map(([name,products])=>({name,products}));
}
