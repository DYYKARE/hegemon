// TR il komşuluk grafını public/data/tr-cities.json geometrisinden üretir.
// Çalıştırma: node scripts/generate-tr-adjacency.mjs
// Çıktı: src/engine/frontline/trAdjacency.ts
//
// Yöntem: sınırı paylaşan poligonlar aynı köşe noktalarını içerir; koordinatlar
// 4 ondalığa (~11 m) yuvarlanıp kesişim aranır. Basitleştirilmiş geometride
// bazı kısa sınırlar hiç ortak nokta bırakmadan kaybolmuş — bunlar gerçek
// komşuluk listeleriyle doğrulanıp MANUAL_EDGES ile tamamlanır.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const geo = JSON.parse(readFileSync(join(root, 'public/data/tr-cities.json'), 'utf8'));

// Geometride ortak köşe bırakmadan kaybolmuş GERÇEK sınırlar (elle doğrulandı,
// aradaki boşluk < ~2.5 km — haritada iller görsel olarak değiyor):
const MANUAL_EDGES = [
  ['tr-3', 'tr-15'],  // Afyon – Burdur
  ['tr-13', 'tr-72'], // Bitlis – Batman
  ['tr-49', 'tr-72'], // Muş – Batman
  ['tr-14', 'tr-18'], // Bolu – Çankırı
  ['tr-18', 'tr-71'], // Çankırı – Kırıkkale
  ['tr-38', 'tr-46'], // Kayseri – Kahramanmaraş
];
// Bilinçli HARİÇ: Bolu–Zonguldak. Gerçekte kısa bir sınır var ama bu veri
// setinde araları ~18 km açık; oyuncunun haritada görmediği edge eklenmez.

const rings = g => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());

const pts = new Map(); // id -> Set<"x,y">
const names = new Map();
for (const f of geo.features) {
  const id = `tr-${f.properties.number}`;
  names.set(id, f.properties.name);
  const s = new Set();
  for (const ring of rings(f.geometry)) {
    for (const [x, y] of ring) s.add(`${x.toFixed(4)},${y.toFixed(4)}`);
  }
  pts.set(id, s);
}

const num = id => Number(id.split('-')[1]);
const ids = [...pts.keys()].sort((a, b) => num(a) - num(b));

const adj = new Map(ids.map(id => [id, new Set()]));
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    for (const p of pts.get(a)) {
      if (pts.get(b).has(p)) { adj.get(a).add(b); adj.get(b).add(a); break; }
    }
  }
}
for (const [a, b] of MANUAL_EDGES) {
  if (adj.get(a).has(b)) throw new Error(`gereksiz manuel edge: ${a}-${b} zaten bulundu`);
  adj.get(a).add(b);
  adj.get(b).add(a);
}

// Doğrulama: simetri + tek bağlı bileşen
for (const [a, ns] of adj) {
  for (const b of ns) if (!adj.get(b).has(a)) throw new Error(`asimetri: ${a}->${b}`);
}
const seen = new Set();
const stack = [ids[0]];
while (stack.length) {
  const cur = stack.pop();
  if (seen.has(cur)) continue;
  seen.add(cur);
  stack.push(...adj.get(cur));
}
if (seen.size !== ids.length) throw new Error(`graf bağlı değil: ${seen.size}/${ids.length}`);

const lines = ids.map(id => {
  const ns = [...adj.get(id)].sort((a, b) => num(a) - num(b));
  const nameList = ns.map(n => names.get(n)).join(', ');
  return `  '${id}': [${ns.map(n => `'${n}'`).join(', ')}], // ${names.get(id)}: ${nameList}`;
});

const out = `// OTOMATİK ÜRETİLDİ — elle düzenlemeyin.
// Kaynak: public/data/tr-cities.json · Üretici: scripts/generate-tr-adjacency.mjs
// Yeniden üretmek için: node scripts/generate-tr-adjacency.mjs
//
// 81 TR ilinin komşuluk grafı (graph EDGE listesi). Simetrik ve tek bağlı
// bileşen olduğu üretim sırasında doğrulanır. Kısa sınırları basitleştirilmiş
// geometride kaybolan 6 gerçek komşuluk üreticideki MANUAL_EDGES ile eklidir.

export const TR_PROVINCE_NEIGHBORS: Record<string, string[]> = {
${lines.join('\n')}
};
`;

writeFileSync(join(root, 'src/engine/frontline/trAdjacency.ts'), out);
const edgeCount = ids.reduce((s, id) => s + adj.get(id).size, 0) / 2;
console.log(`OK: 81 il, ${edgeCount} sınır (edge) → src/engine/frontline/trAdjacency.ts`);
