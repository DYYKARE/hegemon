// Gerçek admin-1 (il/eyalet) sınır verisi — public/data/provinces.json'dan yüklenir.
// Oynanabilir ~44 ülke için gerçek il poligonları. WorldMap bunları çizerek gerçek
// sınırları gösterir; her il en yakın oyun-bölgesi tohumuna göre renklendirilir.
// Veri yoksa (listede olmayan ülke) render prosedürel Voronoi'ye düşer.

export interface RealProvince {
  code: string;
  name: string;
  rings: [number, number][][]; // [lng, lat] halkalar
  centroid: [number, number];  // yaklaşık merkez (en yakın bölge tohumu eşleşmesi için)
}

type RawProvince = { c: string; n: string; r: [number, number][][]; neighbors?: number[] };

let byCountry: Record<string, RealProvince[]> | null = null;

function centroidOf(rings: [number, number][][]): [number, number] {
  // en büyük halkanın basit ortalaması
  let best = rings[0], bestLen = 0;
  for (const r of rings) if (r.length > bestLen) { best = r; bestLen = r.length; }
  let sx = 0, sy = 0;
  for (const [x, y] of best) { sx += x; sy += y; }
  return [sx / best.length, sy / best.length];
}

export function setProvinceData(raw: Record<string, RawProvince[]>): void {
  const out: Record<string, RealProvince[]> = {};
  for (const [cid, provs] of Object.entries(raw)) {
    out[cid] = provs.map(p => ({ code: p.c, name: p.n, rings: p.r, centroid: centroidOf(p.r) }));
  }
  byCountry = out;
}

export function hasRealProvinces(cid: string): boolean {
  return !!byCountry?.[cid]?.length;
}

export function getRealProvinces(cid: string): RealProvince[] {
  return byCountry?.[cid] ?? [];
}
