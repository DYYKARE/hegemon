// Genel bölge üretimi: HERHANGİ bir dünya ülkesini (countries-50m.json poligonu)
// harita düzenine göre bölgelere ayırır. Türkiye dahil tüm ülkeler için tek sistem.
//
// Yöntem: ülke poligonu içine düzene göre N tohum nokta serpilir (deterministik,
// ülke id'sine göre seed'li PRNG), Delaunay/Voronoi komşuluğu çıkarılır. Sonuç
// projeksiyon-bağımsızdır (lng/lat); render katmanı Voronoi'yi ekranda çizer.
//
// Bu modül SAF ve kendi başına test edilebilir — mevcut oyun motoruna dokunmaz;
// genelleştirme entegrasyonu aşamalı yapılır.

import * as d3 from 'd3';
import { geoContains, geoBounds, geoArea, geoCentroid } from 'd3-geo';
import { MapLayout } from './settings';
import { layoutRegionCount } from './countryData';
import { hasRealProvinces, getRealProvinces } from './provinceData';

export interface GeneratedRegion {
  id: string;              // `${countryId}-r${i}`
  countryId: string;
  name: string;
  seed: [number, number];  // [lng, lat] — bölge merkezi (şehir)
  neighbors: string[];     // aynı ülkedeki komşu bölge id'leri
}

// --- Deterministik PRNG (mulberry32) ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Bölge sayısı: ülkenin GERÇEK il sayısına oranlı (bkz. countryData.layoutRegionCount).
// gercek = gerçek il sayısı · detayli = ¼'ü · basit = detaylının ⅓'ü.
export function regionCount(layout: MapLayout, feature: any): number {
  const cid = String(feature.id ?? '');
  const area = geoArea(feature);
  return layoutRegionCount(cid, area, layout);
}

// Ülke poligonu içine düzene göre bölgeler üretir (deterministik).
export function generateRegions(feature: any, layout: MapLayout, countryName = ''): GeneratedRegion[] {
  const cid = String(feature.id ?? countryName);

  // GERÇEK düzen + gerçek il verisi: tohumlar il merkezlerine 1:1 oturur.
  // Rastgele tohumlar birden çok bölgeyi aynı ile düşürüyordu ("Şanlıurfa 2/3");
  // sınır savunması da aynı şehre birden çok atama yapıyormuş gibi görünüyordu.
  if (layout === 'gercek' && hasRealProvinces(cid)) {
    const provs = getRealProvinces(cid);
    if (provs.length > 0) {
      const seeds = provs.map(p => p.centroid);
      const regions: GeneratedRegion[] = seeds.map((seed, i) => ({
        id: `${cid}-r${i}`,
        countryId: cid,
        name: provs[i].name,
        seed,
        neighbors: [],
      }));
      if (seeds.length >= 3) {
        const delaunay = d3.Delaunay.from(seeds);
        for (let i = 0; i < seeds.length; i++) {
          for (const j of delaunay.neighbors(i)) {
            if (j > i) { regions[i].neighbors.push(regions[j].id); regions[j].neighbors.push(regions[i].id); }
          }
        }
      } else if (seeds.length === 2) {
        regions[0].neighbors.push(regions[1].id);
        regions[1].neighbors.push(regions[0].id);
      }
      return regions;
    }
  }

  const n = regionCount(layout, feature);
  const rng = mulberry32(hashStr(cid + '|' + layout));

  const bounds = geoBounds(feature); // [[west, south], [east, north]]
  const [w, s] = bounds[0];
  let [e, north] = bounds[1];
  // Antimeridyeni aşan ülkeler (Rusya, Fiji): doğu batıdan küçük gelir → 360 ekle
  if (e < w) e += 360;
  const lngSpan = e - w;
  const latSpan = north - s;

  // İki fazlı reddetme örneklemesi:
  //  faz 1 — dengeli dağılım için min-mesafe filtresiyle tohum topla
  //  faz 2 — yetmezse filtreyi bırakıp poligon içi herhangi noktayla tamamla
  const seeds: [number, number][] = [];
  const minDist2 = (lngSpan * latSpan) / (n * 12);
  const sample = (): [number, number] | null => {
    let lng = w + rng() * lngSpan;
    if (lng > 180) lng -= 360; // sarma sonrası normalize
    const lat = s + rng() * latSpan;
    return geoContains(feature, [lng, lat]) ? [lng, lat] : null;
  };
  for (let t = 0; t < n * 600 && seeds.length < n; t++) {
    const p = sample();
    if (p && !seeds.some(([sl, sa]) => (sl - p[0]) ** 2 + (sa - p[1]) ** 2 < minDist2)) seeds.push(p);
  }
  for (let t = 0; t < n * 400 && seeds.length < n; t++) {
    const p = sample();
    if (p) seeds.push(p); // filtre yok — küçük/parçalı ülkeleri de doldur
  }
  if (seeds.length === 0) seeds.push(geoCentroid(feature) as [number, number]);

  // Komşuluk: Delaunay (lng/lat düzleminde yeterince doğru)
  const delaunay = d3.Delaunay.from(seeds);
  const regions: GeneratedRegion[] = seeds.map((seed, i) => ({
    id: `${cid}-r${i}`,
    countryId: cid,
    name: `${countryName || cid} Bölge ${i + 1}`,
    seed,
    neighbors: [],
  }));
  for (let i = 0; i < seeds.length; i++) {
    for (const j of delaunay.neighbors(i)) {
      if (j > i) { regions[i].neighbors.push(regions[j].id); regions[j].neighbors.push(regions[i].id); }
    }
  }
  return regions;
}
