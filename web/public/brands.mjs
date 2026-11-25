import { brandCatalog, icon } from '/vendor/icons-entry.mjs';

const catalog = new Map(brandCatalog.map(brand => [brand.id, brand]));
export function providerBrand(provider) {
  return brandCatalog.find(brand => brand.providers.includes(provider))?.id || '';
}
export function specialistBrand(specialist) {
  return brandCatalog.find(brand => brand.specialists.includes(specialist))?.id || '';
}
export function brandLabel(id) { return catalog.get(id)?.label || ''; }
export function providerLabel(provider) { return brandLabel(providerBrand(provider)) || provider; }
// Only catalog identities can select local files; display names never select logos.
export function brandIcon(id, fallback = 'cpu') {
  const mark = document.createElement('span'); mark.className = 'brand-mark';
  setBrandIcon(mark, id, fallback);
  return mark;
}
export function setBrandIcon(node, id, fallback = 'cpu') {
  const brand = catalog.get(id), key = (brand?.id || '') + ':' + fallback;
  if (node.dataset.brandKey === key) return;
  node.dataset.brandKey = key;
  node.dataset.brand = brand?.id || '';
  if (!brand) { node.replaceChildren(icon(fallback)); return; }
  const image = document.createElement('img');
  image.className = 'brand-logo'; image.src = '/brands/' + brand.file;
  image.alt = ''; image.width = 16; image.height = 16; image.setAttribute('aria-hidden', 'true');
  image.addEventListener('error', () => { if (image.parentNode === node) node.replaceChildren(icon(fallback)); }, { once: true });
  node.replaceChildren(image);
}
