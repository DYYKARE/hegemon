// Genel dünya modeli: TÜM ülkeleri düzene göre bölgelere ayırır ve tek bir global
// komşuluk grafı kurar (ülke içi + ülkeler arası kara sınırları). Ülke seçimi,
// komşu tespiti ve harita render'ının ortak kaynağı.
//
// Ülkeler arası komşuluk: tüm bölge tohumları üzerinde tek Delaunay kurulur;
// farklı ülkelerin Delaunay-komşusu bölgeleri, tohumları yeterince yakınsa (kara
// sınırı) bağlanır — okyanus ötesi sahte bağlar mesafe eşiğiyle elenir.

import { geoDistance, geoContains } from 'd3-geo';
import { MapLayout } from './settings';
import { GeneratedRegion, generateRegions } from './worldRegions';
import { COUNTRY_META, countryName, registerCountryName } from './countryData';
import { hasRealProvinces, getRealProvinces } from './provinceData';

export interface WorldRegion extends GeneratedRegion {
  crossNeighbors: string[]; // farklı ülkelerdeki komşu bölge id'leri (kara sınırı)
}

// ULUSLARARASI SULAR: denizler/okyanuslar/büyük göller SEA_STEP°'lik hücrelere
// bölünür. Hücreler kimsenin değildir; kıyı illeri değdikleri hücrelere bağlanır,
// deniz rotası (çıkarma harekâtı) hücre komşuluğu üzerinden yürür. Kapalı havzalar
// (Hazar) ayrı bağlı-bileşen olur: Hazar filosu okyanusa çıkamaz.
export interface SeaCell {
  id: string;                 // sea_x_y
  center: [number, number];   // [lng, lat]
  neighbors: string[];        // 4-yön + boylam sarması
  comp: number;               // bağlı bileşen (deniz havzası) id'si
}

export interface World {
  layout: MapLayout;
  regions: Record<string, WorldRegion>;       // tüm bölgeler (id → bölge)
  byCountry: Record<string, string[]>;         // ülke id → bölge id listesi
  countryNeighbors: Record<string, string[]>;  // ülke id → kara komşusu ülke id'leri
  seaCells: Record<string, SeaCell>;           // uluslararası su hücreleri
  regionSeas: Record<string, string[]>;        // KIYI bölgesi → değdiği su hücreleri
}

export const SEA_STEP = 6; // su hücresi boyutu (derece)

// İki ülke kara komşusu sayılır: sınır noktaları ~0.12° (~13 km) içinde.
// Eski 0.35° (~40 km) eşiği dar boğazlar için gevşetilmişti ama SAHTE kara
// komşulukları üretiyordu: Almanya–Lihtenştayn (30 km kara arası!), Bavyera–
// İsviçre (Bodensee üstünden), Japonya–Rusya, İngiltere–Fransa — kara ordusu
// gemisiz su aşıyordu ve ada olmayan "komşular" zafer koşuluna giriyordu.
// 0.12° gerçek sınırları (örnekleme yoğunluğu 900 nokta/halka ile) yakalar,
// köprü-mesafesi boğazları (Öresund ~4 km) korur; adalar ada kalır — donanma
// için STRAITS deniz rotaları ayrıca vardır, zaferleri de ada kuralına tabidir.
const BORDER_DIST = 0.12;
// Ülkeler arası bölge komşuluğu GERÇEK ortak sınır noktalarından türetilir
// (aşağıda generateWorld adım 2). Tohum-mesafesi eşiği yaklaşımı terk edildi:
// iç illeri (Muş, Erzurum) sınır ili sayıyordu.

interface CountryShape {
  cid: string;
  pts: [number, number][]; // seyreltilmiş sınır noktaları [lng,lat]
  bbox: [number, number, number, number]; // [w,s,e,n]
}

function extractShape(cid: string, feature: any): CountryShape {
  const pts: [number, number][] = [];
  const g = feature.geometry;
  const rings: number[][][] = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
  let w = 180, s = 90, e = -180, n = -90;
  for (const ring of rings) {
    // seyreltme: en çok ~900 nokta/halka. 240 iken örnekleme aralığı BORDER_DIST'in
    // sıkılaştırılmasına (0.35→0.12) izin vermiyordu: dev ülkelerin GERÇEK sınırları
    // seyrek örnekte eşiğin dışına düşerdi. 900 nokta aralığı ~3.75x sıklaştırır;
    // bbox budaması karşılaştırmayı sınır kuşağıyla sınırlı tutar (perf ölçüldü).
    const step = Math.max(1, Math.floor(ring.length / 900));
    for (let i = 0; i < ring.length; i += step) {
      const p = ring[i] as [number, number];
      pts.push(p);
      if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0];
      if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1];
    }
  }
  return { cid, pts, bbox: [w, s, e, n] };
}

// bbox+pad içinde kalan noktalar (karşı ülkeye yakın olabilecekler)
function ptsNearBbox(pts: [number, number][], b: [number, number, number, number], pad: number): [number, number][] {
  return pts.filter(p =>
    p[0] > b[0] - pad && p[0] < b[2] + pad && p[1] > b[1] - pad && p[1] < b[3] + pad);
}

// İl poligonu halkalarından ~cap nokta örnekle (sınır noktası ataması için)
function sampleRingPts(rings: [number, number][][], cap: number): [number, number][] {
  const total = rings.reduce((a, r) => a + r.length, 0);
  const step = Math.max(1, Math.floor(total / cap));
  const out: [number, number][] = [];
  let k = 0;
  for (const ring of rings) for (const pt of ring) if (k++ % step === 0) out.push(pt);
  return out;
}

function bboxNear(a: [number, number, number, number], b: [number, number, number, number], pad: number): boolean {
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}

// İki şeklin sınırı BORDER_DIST içinde mi (kara komşusu mu)?
// Nokta yoğunluğu arttığı için önce bbox budaması yapılır (perf).
function shapesBorder(a: CountryShape, b: CountryShape): boolean {
  const d2 = BORDER_DIST * BORDER_DIST;
  const aPts = ptsNearBbox(a.pts, b.bbox, BORDER_DIST);
  const bPts = ptsNearBbox(b.pts, a.bbox, BORDER_DIST);
  for (const pa of aPts) {
    for (const pb of bPts) {
      const dx = pa[0] - pb[0], dy = pa[1] - pb[1];
      if (dx * dx + dy * dy < d2) return true;
    }
  }
  return false;
}

export function generateWorld(worldGeo: any, layout: MapLayout): World {
  const regions: Record<string, WorldRegion> = {};
  // Gerçek-il modunda bölge → il poligon noktaları (+bbox): sınır noktası ataması
  // tohum yerine bu poligonlara göre yapılır (dolduran: feature döngüsü aşağıda)
  const regionPts: Record<string, [number, number][]> = {};
  const regionBox: Record<string, [number, number, number, number]> = {};
  const byCountry: Record<string, string[]> = {};
  const shapes: CountryShape[] = [];
  const featureByCid: Record<string, any> = {}; // kara testi (geoContains) için

  for (const feature of worldGeo.features) {
    const cid = String(feature.id ?? '');
    if (!cid || cid === '-99') continue; // tanımsız coğrafya parçalarını atla
    featureByCid[cid] = feature;
    registerCountryName(cid, feature.properties?.name); // tablo dışı ülkeler için ad kaydı
    const name = countryName(cid, feature.properties?.name);
    const regs = generateRegions(feature, layout, name);
    // Gerçek il verisi varsa: her bölgeyi seed'ine en yakın gerçek ile göre adlandır
    // (ör. "Türkiye Bölge 8" yerine "Ankara"). Aynı ad birden çok bölgeye düşerse
    // ikincisine il adı + sıra eklenir.
    if (hasRealProvinces(cid)) {
      const provs = getRealProvinces(cid);
      const used: Record<string, number> = {};
      for (const r of regs) {
        let best = provs[0], bestD = Infinity;
        for (const p of provs) {
          const dx = p.centroid[0] - r.seed[0], dy = p.centroid[1] - r.seed[1];
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best) {
          const n = (used[best.name] = (used[best.name] ?? 0) + 1);
          r.name = n === 1 ? best.name : `${best.name} ${n}`;
        }
      }
    }
    byCountry[cid] = [];
    for (const r of regs) {
      regions[r.id] = { ...r, crossNeighbors: [] };
      byCountry[cid].push(r.id);
    }
    // Gerçek-il 1:1 eşlemesinde (gerçek düzen) bölgenin POLİGON noktaları saklanır:
    // sınır noktası ataması merkez yerine poligona göre yapılır. Merkez ataması,
    // merkezi sınırdan uzak ama sınırda toprağı olan illeri (Ağrı-İran) atlıyordu —
    // komşu ilin sınıra yakın merkezi (Iğdır) o noktaları sahipleniyordu.
    if (layout === 'gercek' && hasRealProvinces(cid)) {
      const provs = getRealProvinces(cid);
      regs.forEach((r, i) => {
        const p = provs[i];
        if (!p) return;
        // 240 nokta: 80 ile üçlü-sınır köşelerinde (Ardahan-Kars-Gürcistan) seyrek
        // örnekleme yüzünden sınır noktası yanlış ile atanıyordu (Kars "Gürcistan
        // komşusu" çıkıyordu). bbox budaması maliyeti sınırlı tutar.
        const pts = sampleRingPts(p.rings, 240);
        regionPts[r.id] = pts;
        let bw = 180, bs = 90, be = -180, bn = -90;
        for (const [x, y] of pts) {
          if (x < bw) bw = x; if (x > be) be = x;
          if (y < bs) bs = y; if (y > bn) bn = y;
        }
        regionBox[r.id] = [bw, bs, be, bn];
      });
    }
    shapes.push(extractShape(cid, feature));
  }

  // 1) Ülke komşuluğu: gerçek poligon sınırı yakınlığı (bbox ile budanmış)
  const countryNeighbors: Record<string, string[]> = {};
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (!bboxNear(shapes[i].bbox, shapes[j].bbox, BORDER_DIST)) continue;
      if (!shapesBorder(shapes[i], shapes[j])) continue;
      (countryNeighbors[shapes[i].cid] ??= []).push(shapes[j].cid);
      (countryNeighbors[shapes[j].cid] ??= []).push(shapes[i].cid);
    }
  }

  // 2) Komşu ülkeler arası bölge kenarları: GERÇEK ortak sınır üzerinden.
  //    İki ülkenin BORDER_DIST içinde kalan sınır noktaları "ortak sınır çizgisi"dir;
  //    her sınır noktası iki tarafta da EN YAKIN bölgeye atanır ve o bölge çifti
  //    bağlanır. Yalnız sınırda fiilen toprağı olan bölgeler komşu olur — tohum
  //    mesafesi tahmini, iç illeri (Muş, Erzurum) sınır ili sayıyordu; bu saymaz.
  const shapeByCid: Record<string, CountryShape> = {};
  for (const s of shapes) shapeByCid[s.cid] = s;
  // Sınır noktasına en yakın bölge: il poligonu varsa POLİGONA (halka noktalarına)
  // göre, yoksa tohuma göre. Poligon ataması "sınırda toprağı olan il" sorusunu
  // doğru yanıtlar; tohum ataması Iğdır gibi merkezi sınıra yakın komşuların
  // Ağrı'nın sınır kesimini sahiplenmesine yol açıyordu.
  const nearestRegion = (regIds: string[], p: [number, number]): string | null => {
    let best: string | null = null, bestD = Infinity;
    for (const id of regIds) {
      const pts = regionPts[id];
      if (pts) {
        const bb = regionBox[id];
        const ox = p[0] < bb[0] ? bb[0] - p[0] : p[0] > bb[2] ? p[0] - bb[2] : 0;
        const oy = p[1] < bb[1] ? bb[1] - p[1] : p[1] > bb[3] ? p[1] - bb[3] : 0;
        if (ox * ox + oy * oy >= bestD) continue; // bbox budaması
        for (const q of pts) {
          const dx = q[0] - p[0], dy = q[1] - p[1];
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = id; }
        }
      } else {
        const sd = regions[id].seed;
        const dx = sd[0] - p[0], dy = sd[1] - p[1];
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = id; }
      }
    }
    return best;
  };
  const bd2 = BORDER_DIST * BORDER_DIST;
  for (const [cid, neighs] of Object.entries(countryNeighbors)) {
    for (const nid of neighs) {
      if (nid <= cid) continue; // çifti bir kez işle
      const A = shapeByCid[cid], B = shapeByCid[nid];
      const aRegs = byCountry[cid] ?? [];
      const bRegs = byCountry[nid] ?? [];
      if (!A || !B || aRegs.length === 0 || bRegs.length === 0) continue;

      const aPts = ptsNearBbox(A.pts, B.bbox, BORDER_DIST);
      const bPts = ptsNearBbox(B.pts, A.bbox, BORDER_DIST);
      let linked = false;
      const linkAt = (p: [number, number]) => {
        const ra = nearestRegion(aRegs, p);
        const rb = nearestRegion(bRegs, p);
        if (!ra || !rb) return;
        regions[ra].crossNeighbors.push(rb);
        regions[rb].crossNeighbors.push(ra);
        linked = true;
      };
      // İKİ GEÇİŞ + UYARLANIR EŞİK: countries-50m topolojiktir — GERÇEK ortak
      // sınırda iki ülkenin noktaları aynı arc üzerindedir (çift mesafesi ~0,
      // örnekleme kaymasıyla en çok birkaç km). Üçüncü ülke sınırının yakın
      // geçen kesimi ise (Gürcistan-Ermenistan hattının Türkiye'ye <40km kısmı)
      // 15-40km çift mesafesi verir ve Kars'ı "Gürcistan komşusu" yapıyordu.
      // Önce en küçük çift mesafesi bulunur; bağlama eşiği ona göre ölçeklenir
      // (seyrek örneklenen dev ülkelerde — Rusya — eşik kendiliğinden genişler).
      let minD2 = bd2;
      const nearestD2 = (p: [number, number], pts: [number, number][]) => {
        let best = Infinity;
        for (const q of pts) {
          const dx = p[0] - q[0], dy = p[1] - q[1];
          const d = dx * dx + dy * dy;
          if (d < best) best = d;
        }
        return best;
      };
      const aD2 = aPts.map(p => nearestD2(p, bPts));
      const bD2 = bPts.map(p => nearestD2(p, aPts));
      for (const d of aD2) if (d < minD2) minD2 = d;
      for (const d of bD2) if (d < minD2) minD2 = d;
      // Taban 0.035°(~4km): gerçek ortak-arc noktaları ~0'dadır; 50m veri setinin
      // sınır sarkmaları (Gürcistan hattının Kars'a 0.046° yaklaşması) elenir.
      const linkThresh = Math.min(BORDER_DIST, Math.max(Math.sqrt(minD2) * 2.5, 0.035));
      const lt2 = linkThresh * linkThresh;
      aPts.forEach((pa, i) => { if (aD2[i] < lt2) linkAt(pa); });
      bPts.forEach((pb, i) => { if (bD2[i] < lt2) linkAt(pb); });
      // Güvence: hiç bağ kurulamadıysa en yakın tohum çifti bağlanır (cephe kopmasın)
      if (!linked) {
        let best: [string, string] | null = null;
        let bestD = Infinity;
        for (const a of aRegs) {
          for (const b of bRegs) {
            const d = geoDistance(regions[a].seed, regions[b].seed);
            if (d < bestD) { bestD = d; best = [a, b]; }
          }
        }
        if (best) {
          regions[best[0]].crossNeighbors.push(best[1]);
          regions[best[1]].crossNeighbors.push(best[0]);
        }
      }
    }
  }
  // yinelenen kenarları temizle
  for (const r of Object.values(regions)) r.crossNeighbors = [...new Set(r.crossNeighbors)];

  // 3) ULUSLARARASI SULAR: kara içermeyen SEA_STEP° hücreler (okyanus + Hazar gibi
  //    kapalı havzalar). Hücre komşuluğu 4-yön + boylam sarması; her havza ayrı
  //    bağlı-bileşen alır (Hazar filosu okyanusa çıkamaz).
  const seaCells: Record<string, SeaCell> = {};
  const seaId = (x: number, y: number) => `sea_${x}_${y}`;
  const isLand = (p: [number, number]): boolean => {
    for (const sh of shapes) {
      const b = sh.bbox;
      if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
      if (geoContains(featureByCid[sh.cid], p)) return true;
    }
    return false;
  };
  for (let x = -180; x < 180; x += SEA_STEP) {
    for (let y = -60; y < 78; y += SEA_STEP) {
      const center: [number, number] = [x + SEA_STEP / 2, y + SEA_STEP / 2];
      if (isLand(center)) continue;
      seaCells[seaId(x, y)] = { id: seaId(x, y), center, neighbors: [], comp: -1 };
    }
  }
  for (const cell of Object.values(seaCells)) {
    const cx = Math.round(cell.center[0] - SEA_STEP / 2);
    const cy = Math.round(cell.center[1] - SEA_STEP / 2);
    for (const [dx, dy] of [[SEA_STEP, 0], [-SEA_STEP, 0], [0, SEA_STEP], [0, -SEA_STEP]] as const) {
      let nx = cx + dx;
      if (nx >= 180) nx -= 360;
      if (nx < -180) nx += 360;
      const nid = seaId(nx, cy + dy);
      if (seaCells[nid]) cell.neighbors.push(nid);
    }
  }
  // BOĞAZLAR: 6°'lik ızgara dar geçitleri kara sanıp havzaları koparır —
  // Karadeniz Ege'ye, Basra Körfezi okyanusa çıkamazdı. Gerçekte gemi geçen
  // dar sular sanal kenarla bağlanır; havza bileşenleri bu kenarların ÜZERİNDEN
  // hesaplandığından çıkarma rotaları boğazlardan akar. (Hazar bilinçli yok:
  // kapalı havza kalır.) Uçlar yaklaşık koordinattır; en yakın su hücresi bulunur.
  const STRAITS: [[number, number], [number, number]][] = [
    [[31, 43], [25, 38.5]],     // Karadeniz ↔ Ege (İstanbul + Çanakkale)
    [[36.5, 45.5], [35, 44]],   // Azak ↔ Karadeniz (Kerç)
    [[32.3, 31.8], [37, 23]],   // Akdeniz ↔ Kızıldeniz (Süveyş Kanalı)
    [[42.5, 13.5], [47, 12]],   // Kızıldeniz ↔ Aden Körfezi (Bab-el-Mandeb)
    [[53, 26.5], [59, 23]],     // Basra Körfezi ↔ Umman Denizi (Hormuz)
    [[-5.5, 36], [-8, 35]],     // Akdeniz ↔ Atlantik (Cebelitarık)
    [[1.3, 51], [-5, 49.5]],    // Kuzey Denizi ↔ Manş (Dover)
    [[10.5, 57.5], [14, 55.5]], // Kuzey Denizi ↔ Baltık (Danimarka boğazları)
    [[100, 4], [104.5, 1]],     // Andaman ↔ Güney Çin Denizi (Malakka)
  ];
  const nearestSeaCell = (p: [number, number]): SeaCell | null => {
    let best: SeaCell | null = null, bestD = Infinity;
    for (const c of Object.values(seaCells)) {
      const dx = c.center[0] - p[0], dy = c.center[1] - p[1];
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= 100 ? best : null; // 10°'den uzak eşleşme = veri hatası, bağlama
  };
  for (const [a, b] of STRAITS) {
    const ca = nearestSeaCell(a), cb = nearestSeaCell(b);
    if (!ca || !cb || ca.id === cb.id) continue;
    if (!ca.neighbors.includes(cb.id)) ca.neighbors.push(cb.id);
    if (!cb.neighbors.includes(ca.id)) cb.neighbors.push(ca.id);
  }
  {
    let comp = 0;
    for (const start of Object.values(seaCells)) {
      if (start.comp !== -1) continue;
      start.comp = comp;
      const stack = [start.id];
      while (stack.length) {
        const cur = seaCells[stack.pop()!];
        for (const n of cur.neighbors) {
          if (seaCells[n].comp === -1) { seaCells[n].comp = comp; stack.push(n); }
        }
      }
      comp++;
    }
  }

  // 4) KIYI TESPİTİ: ülkenin kara sınırına ATANMAYAN dış sınır noktaları kıyıdır.
  //    Her kıyı noktası en yakın bölgeye (poligon-duyarlı nearestRegion) ve bitişik
  //    su hücrelerine bağlanır → regionSeas. Suya değmeyen il liman yapamaz;
  //    iç kara ülkelerinde tüm noktalar kara sınırı eşleştiğinden kıyı çıkmaz.
  const regionSeaSets: Record<string, Set<string>> = {};
  for (const sh of shapes) {
    const regIds = byCountry[sh.cid] ?? [];
    if (regIds.length === 0) continue;
    const neighPts: [number, number][] = [];
    for (const nid of countryNeighbors[sh.cid] ?? []) {
      const B = shapeByCid[nid];
      if (B) neighPts.push(...ptsNearBbox(B.pts, sh.bbox, BORDER_DIST));
    }
    for (const p of sh.pts) {
      let landBorder = false;
      for (const q of neighPts) {
        const dx = q[0] - p[0], dy = q[1] - p[1];
        if (dx * dx + dy * dy < bd2) { landBorder = true; break; }
      }
      if (landBorder) continue;
      // bitişik su hücreleri: noktanın hücresi + 8 komşusu — ama hücre MERKEZİ
      // noktaya gerçekten yakın olmalı (≤ 0.75×SEA_STEP). Salt 8-komşuluk,
      // eşleşmeyen bir kara-sınır noktasını (ihtilaflı çizimler, ör. Pencap-
      // Hindistan) yüzlerce km ötedeki deniz hücresine bağlayıp iç eyaleti
      // "kıyı" yapabiliyordu.
      const gx = Math.floor(p[0] / SEA_STEP) * SEA_STEP;
      const gy = Math.floor(p[1] / SEA_STEP) * SEA_STEP;
      // 1×SEA_STEP: ada-merkezli "kara" hücrelerin (Ege) yanındaki kıyılar komşu
      // hücreye ulaşabilsin; sahte iç-nokta vakaları (Pencap ~8°) yine elenir.
      const maxD2 = SEA_STEP * SEA_STEP;
      const linked: string[] = [];
      for (let dx = -SEA_STEP; dx <= SEA_STEP; dx += SEA_STEP) {
        for (let dy = -SEA_STEP; dy <= SEA_STEP; dy += SEA_STEP) {
          let nx = gx + dx;
          if (nx >= 180) nx -= 360;
          if (nx < -180) nx += 360;
          const cell = seaCells[seaId(nx, gy + dy)];
          if (!cell) continue;
          const ddx = cell.center[0] - p[0], ddy = cell.center[1] - p[1];
          if (ddx * ddx + ddy * ddy <= maxD2) linked.push(cell.id);
        }
      }
      if (linked.length === 0) continue; // suya değmiyor — sahte kıyı noktası
      const rid = nearestRegion(regIds, p);
      if (!rid) continue;
      const set = regionSeaSets[rid] ?? (regionSeaSets[rid] = new Set());
      for (const c of linked) set.add(c);
    }
  }
  const regionSeas: Record<string, string[]> = {};
  for (const [rid, set] of Object.entries(regionSeaSets)) regionSeas[rid] = [...set];

  return { layout, regions, byCountry, countryNeighbors, seaCells, regionSeas };
}

// Bölgenin tüm komşuları (ülke içi + ülkeler arası)
export function regionNeighbors(world: World, regionId: string): string[] {
  const r = world.regions[regionId];
  if (!r) return [];
  return [...r.neighbors, ...r.crossNeighbors];
}

export { COUNTRY_META, countryName };
