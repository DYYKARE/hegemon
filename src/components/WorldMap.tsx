import React, { useEffect, useState, useRef } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { Plane, Shield, Swords, Castle, Rocket, Users, Tractor, Factory, Ship, Anchor } from 'lucide-react';
import { War } from '../engine/types';
import { MilitaryOrder } from '../engine/frontline/types';
import { getActiveWorld, regionCountry, getSeaCells } from '../engine/activeWorld';
import { SEA_STEP } from '../engine/world';
import { hasRealProvinces, getRealProvinces } from '../engine/provinceData';
import { formatCount } from '../engine/economy';

// Harita görünümü (zoom/pan) oturumlar arası burada saklanır; oyuncu ülkesi
// değişirse (yeni oyun, başka ülke) kayıt yok sayılır ve ülkeye odaklanılır.
const MAP_VIEW_KEY = 'hegemon_map_view';

interface WorldMapProps {
  onSelect?: (regionId: string, name: string) => void;
  selectedId?: string | null;
  interactive?: boolean;
  playerCountryId: string;
  playerColor?: string;
  provinceUnits?: Record<string, Record<string, number>>;
  provinceInvestments?: Record<string, Record<string, number>>;
  activeFilters?: string[];
  conqueredCountryIds?: string[];
  occupiedProvinces?: Record<string, string>;
  occupiedGarrisons?: Record<string, number>;
  warCountryIds?: string[];
  wars?: War[];
  capturedEnemyProvinces?: string[];
  enemyProvinceStrength?: Record<string, number>;
  orders?: MilitaryOrder[];
  // Ordu transferi görselleştirmesi: kaynak seçildi (to=null → hedef bekleniyor,
  // kaynakta nabız halkası) ya da hedef de seçildi (kaynaktan hedefe canlı ok).
  transferArrow?: { from: string; to: string | null } | null;
  // Tur sonu muharebe flaşları: bölge id listesi + tekrar oynatma anahtarı (seq).
  // Aynı seq yeniden render'da animasyonu tekrarlamaz; yeni tur yeni seq üretir.
  battleFlash?: { ids: string[]; seq: number } | null;
}

// Düz emir çizgisi yerine zarif eğri: orta noktadan dik yönde sapan quadratic
// Bézier. Sapma yönü emir id'sinden deterministik — aynı emir hep aynı kaviste.
// endT: hedef rozetini örtmemek için eğrinin 0..endT alt parçası (de Casteljau).
function curvedPath(a: [number, number], b: [number, number], id: string, endT = 0.85): string {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const sign = h % 2 === 0 ? 1 : -1;
  const bow = Math.min(len * 0.18, 14) * sign;
  const c: [number, number] = [a[0] + dx / 2 - (dy / len) * bow, a[1] + dy / 2 + (dx / len) * bow];
  const c1: [number, number] = [a[0] + (c[0] - a[0]) * endT, a[1] + (c[1] - a[1]) * endT];
  const m1: [number, number] = [c[0] + (b[0] - c[0]) * endT, c[1] + (b[1] - c[1]) * endT];
  const e: [number, number] = [c1[0] + (m1[0] - c1[0]) * endT, c1[1] + (m1[1] - c1[1]) * endT];
  return `M${a[0]},${a[1]} Q${c1[0]},${c1[1]} ${e[0]},${e[1]}`;
}

function chipVisual(type: string): { Icon: React.ComponentType<any>; color: string } {
  switch (type) {
    case 'tank': return { Icon: Shield, color: '#eab308' };
    case 'ucak': return { Icon: Plane, color: '#3b82f6' };
    case 'gemi': return { Icon: Ship, color: '#22d3ee' };
    case 'liman': return { Icon: Anchor, color: '#06b6d4' };
    case 'hava_savunma': return { Icon: Rocket, color: '#a855f7' };
    case 'kara_savunma': return { Icon: Castle, color: '#22c55e' };
    case 'tarim': return { Icon: Tractor, color: '#4ade80' };
    case 'sanayi': return { Icon: Factory, color: '#facc15' };
    case 'nufus': return { Icon: Users, color: '#fb923c' };
    // asker: DOST MAVİSİ — kırmızı kılıç düşman garnizon rozetiyle karışıyordu
    // (kullanıcı kendi ordusunu rakip sandı). Kırmızı yalnız düşmana aittir.
    default: return { Icon: Swords, color: '#60a5fa' };
  }
}

// --- Bölge sınırlarını doğal (organik) hale getirme ---
// Voronoi kenarları düz çizgidir; amatör durur. Her kenarı alt bölümlere ayırıp
// dik yönde deterministik gürültüyle kaydırırız. İki komşu hücrenin PAYLAŞTIĞI kenar
// aynı mutlak noktalarla üretilir (kanonik uç sırası + uçlara göre hash) → boşluk olmaz.

function hash01(a: number): number {
  // xorshift benzeri deterministik [0,1)
  let x = (a ^ 0x9e3779b9) >>> 0;
  x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
  return x / 4294967296;
}
function edgeSeed(p: [number, number], q: [number, number]): number {
  // uç noktalardan (kanonik) tam-sayı seed
  const s = Math.round(p[0] * 8) * 73856093 ^ Math.round(p[1] * 8) * 19349663
    ^ Math.round(q[0] * 8) * 83492791 ^ Math.round(q[1] * 8) * 39916801;
  return s >>> 0;
}
// Bir kenar boyunca yumuşak değer-gürültüsü [-1,1] (birkaç oktav)
function edgeNoise(seed: number, x: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 3; o++) {
    const xi = x * freq;
    const x0 = Math.floor(xi), f = xi - x0;
    const s = f * f * (3 - 2 * f);
    const r0 = hash01((seed + x0 * 131) >>> 0), r1 = hash01((seed + (x0 + 1) * 131) >>> 0);
    sum += (r0 * (1 - s) + r1 * s) * amp;
    norm += amp; amp *= 0.5; freq *= 2.3;
  }
  return (sum / norm) * 2 - 1;
}

// Voronoi hücre poligonunu organik kenarlı poligona çevirir
function roughenPolygon(poly: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  const n = poly.length;
  for (let e = 0; e < n; e++) {
    const a = poly[e], b = poly[(e + 1) % n];
    out.push(a);
    const swap = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
    const p = swap ? b : a, q = swap ? a : b;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.8) continue;
    const nx = -dy / len, ny = dx / len;        // dik yön
    const seed = edgeSeed(p, q);
    const K = Math.max(2, Math.min(28, Math.round(len / 0.9)));
    const amp = Math.min(2.6, len * 0.13);      // kenar boyuyla orantılı genlik
    const mids: [number, number][] = [];
    for (let i = 1; i < K; i++) {
      const t = i / K;
      const taper = Math.sin(Math.PI * t);      // uçlarda köşeleri sabit tut
      const off = edgeNoise(seed, t * K) * amp * taper;
      mids.push([p[0] + dx * t + nx * off, p[1] + dy * t + ny * off]);
    }
    if (swap) mids.reverse();
    out.push(...mids);
  }
  return out;
}

const PILL_W = 52, PILL_H = 18, PILL_GAP = 3;

function ChipGrid({ items }: { items: { type: string; count: number }[] }) {
  const columns = Math.min(2, items.length);
  const rows = Math.ceil(items.length / columns);
  return (
    <>
      {items.map((item, idx) => {
        const row = Math.floor(idx / columns), col = idx % columns;
        const colsInRow = Math.min(columns, items.length - row * columns);
        const x = col * (PILL_W + PILL_GAP) - (colsInRow * (PILL_W + PILL_GAP) - PILL_GAP) / 2 + PILL_W / 2;
        const y = row * (PILL_H + PILL_GAP) - (rows * (PILL_H + PILL_GAP) - PILL_GAP) / 2 + PILL_H / 2;
        const { Icon, color } = chipVisual(item.type);
        return (
          <g key={item.type} transform={`translate(${x}, ${y})`}>
            <rect x={-PILL_W / 2} y={-PILL_H / 2 + 1} width={PILL_W} height={PILL_H} rx="8" fill="rgba(0,0,0,0.35)" />
            <rect x={-PILL_W / 2} y={-PILL_H / 2} width={PILL_W} height={PILL_H} rx="8" fill="rgba(8,13,29,0.92)" stroke={color} strokeWidth="1" />
            <Icon width={11} height={11} stroke={color} strokeWidth={2.2} x={-PILL_W / 2 + 4} y={-5.5} />
            <text x={5} y="4" fontSize="10" fill="white" textAnchor="middle" fontWeight="bold">{formatCount(item.count)}</text>
          </g>
        );
      })}
    </>
  );
}

export function WorldMap({
  onSelect, selectedId, interactive = true, playerCountryId, playerColor = '#1d4ed8',
  provinceUnits = {}, provinceInvestments = {}, activeFilters = [],
  conqueredCountryIds = [], occupiedProvinces = {}, occupiedGarrisons = {},
  warCountryIds = [], wars = [], capturedEnemyProvinces = [],
  enemyProvinceStrength = {}, orders = [], transferArrow = null, battleFlash = null,
}: WorldMapProps) {
  const [geography, setGeography] = useState<any>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const lastZoomK = useRef(6);
  const badgeScale = () => 1 / Math.max(lastZoomK.current, 3);

  useEffect(() => {
    fetch('data/countries-50m.json').then(r => r.json()).then(world => {
      setGeography(topojson.feature(world, world.objects.countries));
    });
  }, []);

  const width = 1000, height = 600;
  const { projection, pathGenerator } = React.useMemo(() => {
    const proj = d3.geoEquirectangular().scale(160).translate([width / 2, height / 2]);
    return { projection: proj, pathGenerator: d3.geoPath().projection(proj) };
  }, []);

  const world = React.useMemo(() => { try { return getActiveWorld(); } catch { return null; } }, [geography]);

  // Uluslararası sular ızgarası (tek path — 900+ hücre, silik çizgi)
  const seaGridPath = React.useMemo(() => {
    if (!world) return '';
    let d = '';
    for (const cell of Object.values(getSeaCells())) {
      const x0 = cell.center[0] - SEA_STEP / 2, y0 = cell.center[1] - SEA_STEP / 2;
      const p1 = projection([x0, y0]), p2 = projection([x0 + SEA_STEP, y0]);
      const p3 = projection([x0 + SEA_STEP, y0 + SEA_STEP]), p4 = projection([x0, y0 + SEA_STEP]);
      if (!p1 || !p2 || !p3 || !p4) continue;
      d += `M${p1[0]},${p1[1]}L${p2[0]},${p2[1]}L${p3[0]},${p3[1]}L${p4[0]},${p4[1]}Z`;
    }
    return d;
  }, [world, projection]);

  // Bölünmüş çizilecek ülkeler: oyuncu + fethedilen + savaştaki + oyuncunun kara komşuları.
  // (Perf: tüm dünyayı bölmek yerine "aktif cephe" bölünür, gerisi düz ülke.)
  const dividedCountries = React.useMemo(() => {
    const set = new Set<string>([playerCountryId, ...conqueredCountryIds, ...warCountryIds]);
    if (world) for (const n of world.countryNeighbors[playerCountryId] ?? []) set.add(n);
    // fethedilenlerin komşuları da (genişleyen cephe)
    if (world) for (const c of conqueredCountryIds) for (const n of world.countryNeighbors[c] ?? []) set.add(n);
    return set;
  }, [world, playerCountryId, conqueredCountryIds, warCountryIds]);

  // Ülke başına çizilecek hücreler + bölge başına GÖRSEL ÇAPA (rozet/ok konumu).
  // Gerçek il verisi varsa GERÇEK il poligonları (her il en yakın bölge tohumuna
  // atanır → o bölgenin rengini/sahipliğini alır); yoksa prosedürel Voronoi.
  //
  // ÇAPA NEDEN AYRI: basit/detaylı düzende bölge tohumu RASTGELE bir noktadır;
  // iller merkez-en-yakın-tohum kuralıyla atandığından tohum, görsel olarak BAŞKA
  // bölgenin toprağında kalabilir → rozetler kayardı (Erzurum savunması komşu ilde
  // görünüyordu). Çapa, bölgeye ATANAN en büyük ilin merkezidir: her zaman bölgenin
  // kendi boyalı toprağının üstüne düşer. Voronoi'de tohum hücrenin içindedir,
  // çapaya gerek yok (fallback tohumu kullanır).
  const { cellsByCountry, regionAnchors } = React.useMemo(() => {
    const out: Record<string, { regionId: string; d: string }[]> = {};
    const anchors: Record<string, [number, number]> = {};
    if (!geography || !world) return { cellsByCountry: out, regionAnchors: anchors };
    // Halka alanı (shoelace, lng/lat düzleminde — yalnız KARŞILAŞTIRMA için)
    const ringArea = (ring: [number, number][]): number => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
        a += x1 * y2 - x2 * y1;
      }
      return Math.abs(a) / 2;
    };
    for (const feature of geography.features) {
      const cid = String(feature.id ?? '');
      if (!dividedCountries.has(cid)) continue;
      const regs = world.byCountry[cid];
      if (!regs || regs.length === 0) continue;
      const seeds = regs.map(id => projection(world.regions[id].seed)!);

      if (hasRealProvinces(cid)) {
        // Gerçek iller: her il ayrı poligon (gerçek sınır), en yakın bölge tohumuna
        // atanır → o bölgenin rengini alır. Seçim, sarı konturla DEĞİL parlak dolguyla
        // gösterilir (bölge tek parça okunur, geometri hatası olmaz).
        const cells: { regionId: string; d: string }[] = [];
        const bestProv: Record<string, { area: number; centroid: [number, number] }> = {};
        for (const prov of getRealProvinces(cid)) {
          let best = 0, bestD = Infinity;
          for (let i = 0; i < regs.length; i++) {
            const s = world.regions[regs[i]].seed;
            const dx = s[0] - prov.centroid[0], dy = s[1] - prov.centroid[1];
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = i; }
          }
          let d = '';
          let area = 0;
          for (const ring of prov.rings) {
            const pts = ring.map(p => projection(p)).filter(Boolean) as [number, number][];
            if (pts.length < 3) continue;
            d += 'M' + pts.map(p => `${p[0]},${p[1]}`).join('L') + 'Z';
            area += ringArea(ring);
          }
          if (!d) continue;
          cells.push({ regionId: regs[best], d });
          // Bölgenin çapası: atanan en BÜYÜK ilin merkezi
          const rid = regs[best];
          if (area > (bestProv[rid]?.area ?? -1)) bestProv[rid] = { area, centroid: prov.centroid };
        }
        for (const [rid, b] of Object.entries(bestProv)) {
          const p = projection(b.centroid);
          if (p) anchors[rid] = p;
        }
        out[cid] = cells;
      } else {
        // Prosedürel Voronoi (organik)
        const b = pathGenerator.bounds(feature);
        if (isNaN(b[0][0])) continue;
        const pad = 60;
        const vor = d3.Delaunay.from(seeds).voronoi([b[0][0] - pad, b[0][1] - pad, b[1][0] + pad, b[1][1] + pad]);
        out[cid] = regs.map((id, i) => {
          const poly = vor.cellPolygon(i) as [number, number][] | null;
          const rough = poly ? roughenPolygon(poly) : null;
          return { regionId: id, d: rough ? 'M' + rough.map(p => `${p[0]},${p[1]}`).join('L') + 'Z' : '' };
        }).filter(c => c.d);
      }
    }
    return { cellsByCountry: out, regionAnchors: anchors };
  }, [geography, world, dividedCountries, projection, pathGenerator]);

  // Bölgenin görsel çapası: atanan ilden hesaplanan nokta; yoksa tohum (Voronoi).
  const anchorOf = React.useCallback((rid: string): [number, number] | null => {
    if (regionAnchors[rid]) return regionAnchors[rid];
    const seed = world?.regions[rid]?.seed;
    return seed ? projection(seed) ?? null : null;
  }, [regionAnchors, world, projection]);

  // Rozet konumları: her bölgenin görsel çapası (ekran koordinatı)
  const regionSeedsByCountry = React.useMemo(() => {
    const out: Record<string, { id: string; centroid: [number, number] }[]> = {};
    if (!world) return out;
    for (const cid of dividedCountries) {
      const regs = world.byCountry[cid];
      if (!regs) continue;
      out[cid] = regs
        .map(id => ({ id, centroid: anchorOf(id) }))
        .filter((r): r is { id: string; centroid: [number, number] } => r.centroid !== null);
    }
    return out;
  }, [world, dividedCountries, anchorOf]);

  // Kıyı ışıması iki katmanlı stroke ile çizilir (feGaussianBlur YOK — WebView'de
  // pahalı; katmanlı stroke ucuz ve yeterli).
  //
  // Kara kütlesi TEK path DEĞİL, kara parçası başına AYRI path olarak döner.
  // Sebep ölçüm: tek dev path tüm dünyayı kapsadığı için Chromium onu hiçbir
  // zaman eleyemiyor ve ölçek her değiştiğinde 199.000 çizim komutunun tamamını
  // yeniden rasterleştiriyordu — cihazda yakınlaştırma kare süresinin %85'i
  // buradan geliyordu. Ayrı path'lerde ekran dışında kalanlar elenir.
  // Geometri birebir aynı; değişen yalnız DOM yapısı.
  //   tek path : 602ms/kare      ayrı path'ler: 89ms/kare  (Xiaomi 2306EPN60G)
  const landPaths = React.useMemo(() => {
    if (!geography) return [] as string[];
    const all = geography.features.map((f: any) => pathGenerator(f) || '').join(' ');
    return all.split('M').slice(1).map((s: string) => 'M' + s.trim()).filter((s: string) => s.length > 1);
  }, [geography, pathGenerator]);

  // Canvas çizimi bileşenin ilerisinde tanımlanır (renk fonksiyonlarına ihtiyaç
  // duyar), ama zoom effect'i burada kurulur → ref üzerinden çağrılır.
  const sceneRef = useRef<{ ops: any[]; hits: { p: Path2D; id: string; name: string }[] }>({ ops: [], hits: [] });
  const transformRef = useRef(d3.zoomIdentity);
  const drawRef = useRef<() => void>(() => {});
  const drawRaf2 = useRef(0);
  const scheduleDraw = React.useCallback(() => {
    if (drawRaf2.current) return;
    drawRaf2.current = requestAnimationFrame(() => { drawRaf2.current = 0; drawRef.current(); });
  }, []);
  // Sürüklemenin sonundaki "click" seçim yapmasın: jest hareket ettiyse bastır.
  const movedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Path2D önbelleği: yapımı pahalı (4000 path ≈ 38ms), geometri nadiren
  // değişir. Aynı 'd' dizesi için nesne yeniden kullanılır; böylece sahne her
  // render'da ucuzca yeniden kurulabilir.
  const p2d = useRef(new Map<string, Path2D>());
  const hitCanvas = useRef<CanvasRenderingContext2D | null>(null);

  // DİKKAT: Bu hook'lar bilerek "Harita Yükleniyor" erken dönüşünün ÜSTÜNDE.
  // Altına konurlarsa geography null iken çağrılmaz, dolu iken çağrılır →
  // render'lar arasında hook sayısı değişir ve React bileşeni patlatır.
  // Her render sonrası (renk/seçim/emir değişimi) ve boyut değişiminde yeniden çiz.
  useEffect(() => { scheduleDraw(); });
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => scheduleDraw());
    ro.observe(cv);
    return () => ro.disconnect();
  }, [scheduleDraw]);
  // İptalde sayaç SIFIRLANMALI: StrictMode geliştirmede bileşeni söküp yeniden
  // takıyor; sayaç sıfırlanmazsa scheduleDraw kalıcı olarak "zaten planlandı"
  // sanır ve bir daha hiç çizmez (harita boş kalır).
  useEffect(() => () => { if (drawRaf2.current) { cancelAnimationFrame(drawRaf2.current); drawRaf2.current = 0; } }, []);

  // Zoom
  const hasZoomedInitial = useRef(false);

  // k'ya bağlı görsel düzeltmeler (kontur kalınlığı + rozet ölçeği) tek yerde ve
  // rAF ile birleştirilmiş: pinch sırasında saniyede onlarca kez değil, kare
  // başına en fazla bir kez DOM'a yazılır.
  const scaleRaf = useRef(0);
  const pendingK = useRef(0);
  const applyZoomScale = React.useCallback((k: number) => {
    // Bekleyen k HER ÇAĞRIDA güncellenir; rAF yalnız bir kez planlanır. (Önce
    // "rAF bekliyorsa çık" deniyordu — bu, ilk değeri yazıp sonrakileri
    // düşürüyordu ve pinch'te yanlış ölçekte kalınıyordu.)
    pendingK.current = k;
    if (scaleRaf.current) return;
    scaleRaf.current = requestAnimationFrame(() => {
      scaleRaf.current = 0;
      const g = gRef.current;
      if (!g) return;
      const kk = pendingK.current;
      const bs = 1 / Math.max(kk, 3);
      g.querySelectorAll<SVGGElement>('g[data-badge]').forEach(el => el.setAttribute('transform', `scale(${bs})`));
    });
  }, []);
  useEffect(() => () => { if (scaleRaf.current) { cancelAnimationFrame(scaleRaf.current); scaleRaf.current = 0; } }, []);
  useEffect(() => {
    if (!svgRef.current || !gRef.current || !geography || !world) return;
    // Katman terfisi: React'in silemeyeceği şekilde imperatif kuruluyor.
    gRef.current.style.willChange = 'transform';
    gRef.current.style.transformOrigin = '0 0';
    // Yeniden render sonrası (React g'yi yeniden oluşturmuş olabilir) mevcut
    // ölçek kaybolmasın: kayıtlı k ile kontur/rozet ölçeğini geri yaz.
    applyZoomScale(lastZoomK.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.5, 300])
      .on('start', () => { movedRef.current = false; })
      .on('zoom', (event) => {
        const t = event.transform;
        movedRef.current = true;
        transformRef.current = t;
        // Taban harita canvas'a yeniden çizilir (kare başına bir kez).
        scheduleDraw();
        // Rozet/ok katmanı SVG'de kalır: CSS transform ile taşınır. Nitelik
        // yerine CSS kullanılır çünkü nitelik değişimi SVG alt ağacını yeniden
        // boyatır; burada eleman sayısı az olsa da aynı kural geçerli.
        if (gRef.current) gRef.current.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        // Rozet ölçeği YALNIZ k değiştiğinde güncellenir; düz sürüklemede k
        // sabit olduğundan bu iş tamamen atlanır.
        if (t.k !== lastZoomK.current) {
          lastZoomK.current = t.k;
          applyZoomScale(t.k);
        }
      })
      // Görünüm oturumlar arası hatırlanır: her açılışta yeniden yakınlaştırmak
      // (özellikle telefonda) yorucuydu. viewBox sabit (1000×600) olduğundan
      // transform çözünürlükten bağımsızdır; 'end'de yazılır — sürükleme
      // boyunca her karede localStorage'a dokunulmaz.
      .on('end', (event) => {
        try {
          const { k, x, y } = event.transform;
          localStorage.setItem(MAP_VIEW_KEY, JSON.stringify({ k, x, y, cid: playerCountryId }));
        } catch { /* depolama yoksa görünüm hatırlanmaz — oyun etkilenmez */ }
      });
    d3.select(svgRef.current).call(zoom);
    if (!hasZoomedInitial.current) {
      hasZoomedInitial.current = true;
      // Önce kayıtlı görünüm (aynı oyuncu ülkesiyse): animasyonsuz, anında devam hissi
      let restored = false;
      try {
        const raw = localStorage.getItem(MAP_VIEW_KEY);
        if (raw) {
          const v = JSON.parse(raw);
          if (v?.cid === playerCountryId && Number.isFinite(v.k) && Number.isFinite(v.x) && Number.isFinite(v.y)) {
            const t = d3.zoomIdentity.translate(v.x, v.y).scale(v.k);
            d3.select(svgRef.current).call(zoom.transform, t);
            lastZoomK.current = v.k;
            applyZoomScale(v.k);
            restored = true;
          }
        }
      } catch { /* bozuk kayıt: varsayılan yakınlaştırmaya düş */ }
      const feature = !restored && geography.features.find((f: any) => String(f.id) === playerCountryId);
      if (feature) {
        const bnd = pathGenerator.bounds(feature);
        if (!isNaN(bnd[0][0])) {
          const dx = bnd[1][0] - bnd[0][0], dy = bnd[1][1] - bnd[0][1];
          const x = (bnd[0][0] + bnd[1][0]) / 2, y = (bnd[0][1] + bnd[1][1]) / 2;
          const scale = Math.max(1, Math.min(40, 0.85 / Math.max(dx / width, dy / height)));
          const t = d3.zoomIdentity.translate(width / 2 - scale * x, height / 2 - scale * y).scale(scale);
          d3.select(svgRef.current).transition().duration(750).call(zoom.transform, t);
          lastZoomK.current = scale;
          applyZoomScale(scale);
        }
      }
    }
  }, [geography, world, playerCountryId, pathGenerator, applyZoomScale]);

  if (!geography) {
    return <div className="flex items-center justify-center w-full h-full bg-slate-900 text-slate-400">Harita Yükleniyor...</div>;
  }

  const captured = new Set(capturedEnemyProvinces);
  const conquered = new Set(conqueredCountryIds);
  const atWar = new Set(warCountryIds);

  // Sınır çizgisi: sert siyah yerine yarı saydam koyu ton + yuvarlak birleşim —
  // kuantalanmış (0.05°) poligonların basamaklı kenarları göze daha yumuşak gelir.
  const BORDER_COLOR = 'rgba(15,23,42,0.55)';
  // Ülke DIŞ sınırı: sert beyaz değil, YUMUŞAK açık-slate yarı saydam. Ülke
  // renkleri zaten birbirinden ayrıştığı için sınırın işi sadece kenarı nazikçe
  // belirtmek — iç il çizgileri (koyu/ince) ile karışmaz.
  const COUNTRY_OUTLINE = 'rgba(196,214,238,0.42)';

  // Deterministik string→sayı (renk seçimi ve ton varyasyonu için)
  const hashOf = (s: string): number => {
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  };
  const toneOf = (rid: string, tones: string[]): string => tones[hashOf(rid) % tones.length];
  // Bir hex rengin RGB'sini eşit miktarda açar/koyar — il başına hafif doku
  const shade = (hex: string, d: number): string => {
    const n = parseInt(hex.slice(1), 16);
    const cl = (v: number) => Math.max(0, Math.min(255, v));
    const r = cl(((n >> 16) & 255) + d), g = cl(((n >> 8) & 255) + d), b = cl((n & 255) + d);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };
  // Oyuncu toprağı: seçilen renkten türer (il başına ±parlaklıkla doku). Sabit
  // mavi paletin yerini alır — oyuncu yeni oyunda rengini seçer.
  const playerTone = (rid: string): string =>
    shade(playerColor, [-12, -6, 0, 6, 12][hashOf(rid) % 5]);
  // Oyuncu KIRMIZI bandında bir renk seçtiyse düşman/işgal paleti turuncu-kahveye
  // kayar: "benim kızılım" ile "savaştaki düşman" haritada ayırt edilemiyordu
  // (2026-07-15 çocuk-persona testi). Kırmızı bandı: R baskın, G ve B zayıf.
  const pcNum = parseInt(playerColor.slice(1), 16);
  const playerIsRed = ((pcNum >> 16) & 255) > 140
    && ((pcNum >> 16) & 255) > ((pcNum >> 8) & 255) * 1.8
    && ((pcNum >> 16) & 255) > (pcNum & 255) * 1.8;
  const T_ENEMY = playerIsRed
    ? ['#9a3412', '#a63f12', '#8f300f', '#ab4517']  // turuncu-kahve (savaş)
    : ['#7f1d1d', '#8a2121', '#741a1a', '#932420']; // klasik koyu kırmızı
  const ENEMY_SEL = playerIsRed ? '#fb923c' : '#ef4444';
  const OCCUPIED_FILL = playerIsRed ? '#c2410c' : '#991b1b';
  // Nötr ülkeler artık GRİ DEĞİL: her ülke kendi mat renginde (modern siyasi
  // harita). Palet, oyuncu mavisi (~220°) ve düşman kırmızısı (~0°) bantlarından
  // kasıtlı uzak — karışmasın; hepsi mat ve orta-koyu, koyu okyanusta ayrışır ama
  // göz yormaz. Bir ülkenin tüm illeri aynı renk ailesinde (il başına ±parlaklık).
  const NEUTRAL_PALETTE = [
    '#2f7d72', '#348a5b', '#6f7a34', '#a5842f', '#b0703a',
    '#8a5a3e', '#6b4a9c', '#95468b', '#4c509e', '#3f6f7d',
    '#7a4f68', '#4a7a4e',
  ];
  const countryColor = (cid: string): string => NEUTRAL_PALETTE[hashOf(cid) % NEUTRAL_PALETTE.length];
  const neutralTone = (rid: string, cid: string): string =>
    shade(countryColor(cid), [-14, -7, 0, 7, 14][hashOf(rid) % 5]);

  // Bölge sahiplik/renk. Seçili bölge PARLAK dolguyla vurgulanır (gerçek-il modunda
  // sarı kontur patchwork yaratmasın diye seçim renkle gösterilir).
  const regionFill = (rid: string, cid: string, isSelected: boolean): string => {
    if (occupiedProvinces[rid]) return isSelected ? ENEMY_SEL : OCCUPIED_FILL; // bizim ilimiz işgalde
    if (captured.has(rid)) return isSelected ? shade(playerColor, 60) : playerTone(rid); // ele geçirdik
    if (cid === playerCountryId || conquered.has(cid)) return isSelected ? shade(playerColor, 60) : playerTone(rid); // bizim
    if (atWar.has(cid)) return isSelected ? ENEMY_SEL : toneOf(rid, T_ENEMY); // düşman (savaş)
    return isSelected ? shade(countryColor(cid), 55) : neutralTone(rid, cid); // nötr — ülke rengi
  };

  // ————————————————————————————————————————————————————————————————
  // TABAN HARİTA: CANVAS
  //
  // Taban harita (okyanus, deniz ızgarası, kıyı ışıması, ülke/il dolguları,
  // sınırlar, seçim vurgusu) SVG değil canvas ile çizilir. Rozetler, emir
  // okları ve animasyonlar SVG katmanında kalır — onlar az sayıda eleman.
  //
  // Sebep ölçüm (Xiaomi 2306EPN60G, aynı geometri, gerçek kare hızında):
  //   SVG  : pan 8.3ms/kare, zoom 597→81ms/kare (ölçek değişince ~800 poligon
  //          yeniden rasterleştiriliyor; kaçınılmaz)
  //   Canvas: pan 8.3ms, zoom 8.3ms — ikisi de 120fps (ekranın tavanı)
  // Aradaki fark yakınlaştırmada 10 kat; SVG'de bunu düzeltmenin yolu yoktu.
  const P = (d: string): Path2D => {
    let p = p2d.current.get(d);
    if (!p) {
      p = new Path2D(d);
      if (p2d.current.size > 20000) p2d.current.clear();
      p2d.current.set(d, p);
    }
    return p;
  };

  type Op =
    | { p: Path2D; fill?: string; stroke?: string; lw?: number; round?: boolean }
    | { clip: Path2D }
    | { pop: true };

  const ops: Op[] = [];
  const hits: { p: Path2D; id: string; name: string }[] = [];
  {
    // KATMAN 0: uluslararası sular ızgarası
    if (seaGridPath) ops.push({ p: P(seaGridPath), stroke: 'rgba(94,145,195,0.09)', lw: 0.5 });

    // KATMAN 0.5: kıyı ışıması (iki katmanlı stroke, blur filtresi yok)
    for (const d of landPaths) ops.push({ p: P(d), stroke: 'rgba(96,165,250,0.07)', lw: 7, round: true });
    for (const d of landPaths) ops.push({ p: P(d), stroke: 'rgba(125,180,255,0.16)', lw: 2.5, round: true });

    // KATMAN 1: bölünmemiş ülkeler
    geography.features.forEach((feature: any, i: number) => {
      const cid = String(feature.id ?? '');
      if (cid && dividedCountries.has(cid)) return;
      const d = pathGenerator(feature) || '';
      if (!d) return;
      const path = P(d);
      const isSel = selectedId === cid;
      const base = countryColor(cid || String(i));
      ops.push({ p: path, fill: isSel ? shade(base, 55) : base, stroke: COUNTRY_OUTLINE, lw: 0.9, round: true });
      if (interactive && cid) hits.push({ p: path, id: cid, name: feature.properties?.name ?? cid });
    });

    // KATMAN 2: bölünmüş ülkelerin bölgeleri
    for (const [cid, cells] of Object.entries(cellsByCountry)) {
      if (!hasRealProvinces(cid)) {
        // Prosedürel Voronoi: ülke şekliyle kırpılır (SVG'deki clipPath karşılığı)
        const feature = geography.features.find((f: any) => String(f.id) === cid);
        const clipD = feature ? pathGenerator(feature) : null;
        if (clipD) ops.push({ clip: P(clipD) });
        for (const cell of cells) {
          const rid = cell.regionId;
          const isSel = selectedId === rid;
          const isTarget = orders.some(o => o.to === rid);
          const path = P(cell.d);
          ops.push({
            p: path, fill: regionFill(rid, cid, isSel || isTarget),
            stroke: isSel ? '#fbbf24' : isTarget ? '#f87171' : BORDER_COLOR,
            lw: isSel || isTarget ? 1.2 : 0.5, round: true,
          });
          if (interactive && world?.regions[rid]) hits.push({ p: path, id: rid, name: world.regions[rid].name });
        }
        if (clipD) ops.push({ pop: true });
        continue;
      }
      // Gerçek iller: bölge başına önce koyu kontur geçişi, sonra dolgu geçişi.
      // Bölge içi il kenarları kendi dolgusunun altında kalır → yalnız bölge
      // sınırları okunur (SVG'deki iki geçişli mantığın aynısı).
      const byRegion: Record<string, typeof cells> = {};
      for (const c of cells) (byRegion[c.regionId] ??= []).push(c);
      for (const [rid, rcells] of Object.entries(byRegion)) {
        const isSel = selectedId === rid;
        const isTarget = orders.some(o => o.to === rid);
        const fill = regionFill(rid, cid, isSel || isTarget);
        for (const c of rcells) ops.push({ p: P(c.d), stroke: BORDER_COLOR, lw: 2, round: true });
        for (const c of rcells) {
          const path = P(c.d);
          ops.push({ p: path, fill, stroke: fill, lw: 0.4 });
          if (interactive && world?.regions[rid]) hits.push({ p: path, id: rid, name: world.regions[rid].name });
        }
      }
    }

    // KATMAN 2.4: bölünmüş ülkelerin dış konturu (sınır hiyerarşisi)
    for (const cid of dividedCountries) {
      const feature = geography.features.find((f: any) => String(f.id) === cid);
      const d = feature ? pathGenerator(feature) : null;
      if (d) ops.push({ p: P(d), stroke: COUNTRY_OUTLINE, lw: 1.3, round: true });
    }

    // KATMAN 2.5: seçim / emir hedefi vurgusu — en üstte, komşu dolgular örtmesin
    for (const rid of new Set([...orders.map(o => o.to), selectedId].filter((r): r is string => !!r))) {
      const entry = Object.entries(cellsByCountry).find(([cid2, cells2]) =>
        hasRealProvinces(cid2) && cells2.some(c => c.regionId === rid));
      if (!entry) continue;
      const [cid2, cells2] = entry;
      const rcells = cells2.filter(c => c.regionId === rid);
      const isSel = selectedId === rid;
      const fill = regionFill(rid, cid2, true);
      for (const c of rcells) ops.push({ p: P(c.d), stroke: isSel ? 'rgba(251,191,36,0.30)' : 'rgba(248,113,113,0.30)', lw: 5, round: true });
      for (const c of rcells) ops.push({ p: P(c.d), stroke: isSel ? '#fbbf24' : '#f87171', lw: 2, round: true });
      for (const c of rcells) ops.push({ p: P(c.d), fill, stroke: fill, lw: 0.5 });
    }
  }
  sceneRef.current = { ops, hits };

  // Sahneyi canvas'a çizer. Konturlar 1/k ile ölçeklenir → ekranda sabit
  // kalınlık (SVG'deki non-scaling-stroke davranışının birebir karşılığı).
  drawRef.current = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.round(rect.width * dpr), ch = Math.round(rect.height * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    // Okyanus: zoom'dan bağımsız, ekran uzayında vinyetli radyal gradyan
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const gx = cw / 2, gy = ch * 0.42;
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(cw, ch) * 0.75);
    grad.addColorStop(0, '#16233f');
    grad.addColorStop(0.55, '#0e1830');
    grad.addColorStop(1, '#070d1b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);

    // viewBox (1000×600) → ekran eşlemesi: SVG'deki object-contain ile aynı
    const vbS = Math.min(rect.width / width, rect.height / height);
    const offX = (rect.width - width * vbS) / 2, offY = (rect.height - height * vbS) / 2;
    const t = transformRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(offX, offY);
    ctx.scale(vbS, vbS);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    const inv = 1 / t.k;
    let depth = 0;
    for (const op of sceneRef.current.ops as Op[]) {
      if ('clip' in op) { ctx.save(); ctx.clip(op.clip); depth++; continue; }
      if ('pop' in op) { if (depth > 0) { ctx.restore(); depth--; } continue; }
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(op.p); }
      if (op.stroke && op.lw) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.lw * inv;
        ctx.lineJoin = op.round ? 'round' : 'miter';
        ctx.lineCap = op.round ? 'round' : 'butt';
        ctx.stroke(op.p);
      }
    }
    while (depth-- > 0) ctx.restore();
  };

  // Tıklama: canvas'ta DOM isabet testi yok — nokta, sahnedeki Path2D'lere
  // karşı sınanır (en üstte çizilen kazanır, o yüzden sondan başa taranır).
  const handleMapClick = (e: React.MouseEvent<SVGRectElement>) => {
    if (!interactive || !onSelect) return;
    if (movedRef.current) { movedRef.current = false; return; } // sürüklemeydi
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const t = transformRef.current;
    const mx = (p.x - t.x) / t.k, my = (p.y - t.y) / t.k;
    if (!hitCanvas.current) hitCanvas.current = document.createElement('canvas').getContext('2d');
    const hc = hitCanvas.current;
    if (!hc) return;
    const hs = sceneRef.current.hits;
    for (let i = hs.length - 1; i >= 0; i--) {
      if (hc.isPointInPath(hs[i].p, mx, my)) { onSelect(hs[i].id, hs[i].name); return; }
    }
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#080e1d] flex items-center justify-center">
      {/* Taban harita. SVG ile aynı kutuyu kaplar; ikisi de object-contain
          eşlemesini kullandığı için koordinatları birebir örtüşür. */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      <svg ref={svgRef} data-testid="world-map" viewBox={`0 0 ${width} ${height}`} className="w-full h-full object-contain cursor-grab active:cursor-grabbing relative">
        <defs>
          <marker id="attack-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="#f87171" />
          </marker>
          <marker id="transfer-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="#22d3ee" />
          </marker>
          <marker id="sea-attack-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="#38bdf8" />
          </marker>
        </defs>
        {/* Saydam yakalama dikdörtgeni: taban harita artik canvas'ta oldugundan
            SVG'de tiklanacak/suruklenecek boyali eleman kalmadi. d3.zoom ve
            secim tiklamasi bu dikdortgen uzerinden calisir. */}
        <rect x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0)"
          onClick={handleMapClick} className={interactive ? 'cursor-pointer' : ''} />
        {/* style prop'u YOK ve olmamali: transform buraya imperatif yaziliyor
            (zoom effect'i). React'e style prop'u verilirse React elemanin inline
            stilini yonetmeye baslar ve imperatif yazdiklarimizi siler. */}
        <g ref={gRef} pointerEvents="none">
          {/* (Şehir ışıkları katmanı denendi ve KALDIRILDI: harita-birimi yarıçap
              zoom'la büyüyüp balonlaşıyordu — kullanıcı istemedi, geri ekleme.) */}

          {/* KATMAN 2.9: MUHAREBE FLAŞLARI — tur sonunda çatışma yaşanan bölgelerde
              tek seferlik genişleyen halka + parlama (seq değişince yeniden oynar). */}
          {battleFlash && world && (
            <g key={`bf-${battleFlash.seq}`} className="pointer-events-none">
              {battleFlash.ids.map(rid => {
                const p = anchorOf(rid);
                if (!p) return null;
                return (
                  <g key={`fl-${rid}`}>
                    <circle cx={p[0]} cy={p[1]} r={1} fill="none" stroke="#fbbf24" strokeWidth={1.4} vectorEffect="non-scaling-stroke">
                      <animate attributeName="r" from="1" to="10" dur="0.9s" repeatCount="1" fill="freeze" />
                      <animate attributeName="opacity" from="0.9" to="0" dur="0.9s" repeatCount="1" fill="freeze" />
                    </circle>
                    <circle cx={p[0]} cy={p[1]} r={0.6} fill="#fef3c7">
                      <animate attributeName="r" from="0.6" to="3" dur="0.5s" repeatCount="1" fill="freeze" />
                      <animate attributeName="opacity" from="1" to="0" dur="0.5s" repeatCount="1" fill="freeze" />
                    </circle>
                  </g>
                );
              })}
            </g>
          )}

          {/* KATMAN 3: rozetler (bölge başına, ekran-sabit boyut) */}
          <g className="pointer-events-none">
            {Object.entries(regionSeedsByCountry).flatMap(([cid, seeds]) => seeds.map(({ id: rid, centroid }) => {
              const isPlayer = !occupiedProvinces[rid] && (captured.has(rid) || cid === playerCountryId || conquered.has(cid));
              const [cx, cy] = centroid;
              if (isPlayer) {
                const units = provinceUnits[rid] || {};
                const items = Object.entries(units)
                  .filter(([t, c]) => c > 0 && (activeFilters.length === 0 || activeFilters.includes(t)))
                  .map(([type, count]) => ({ type, count }));
                if (items.length === 0) return null;
                return (
                  <g key={`b-${rid}`} transform={`translate(${cx},${cy})`}>
                    <g data-badge transform={`scale(${badgeScale()})`}><ChipGrid items={items} /></g>
                  </g>
                );
              }
              // düşman / işgalci garnizon — boş (0) garnizona rozet çizilmez:
              // "⚔ 0" hata gibi görünüyor; boş bölge bilgisi zaten rozetsizlikten okunur
              const garrison = occupiedProvinces[rid] ? occupiedGarrisons[rid] : (atWar.has(cid) ? enemyProvinceStrength[rid] : undefined);
              if (garrison == null || garrison <= 0) return null;
              return (
                <g key={`b-${rid}`} transform={`translate(${cx},${cy})`}>
                  <g data-badge transform={`scale(${badgeScale()})`}>
                    <rect x="-26" y="-8" width="52" height="19" rx="9" fill="rgba(0,0,0,0.35)" />
                    <rect x="-26" y="-9" width="52" height="18" rx="9" fill="rgba(69,10,10,0.94)" stroke="#f87171" strokeWidth="1.1" />
                    <text x="0" y="4" fontSize="11" fill="#fecaca" textAnchor="middle" fontWeight="bold">⚔ {formatCount(garrison)}</text>
                  </g>
                </g>
              );
            }))}
          </g>

          {/* KATMAN 4: emir okları — ok boyunca HAREKET EDEN birlik işaretiyle */}
          {orders.length > 0 && world && (
            <g className="pointer-events-none">
              {orders.map(o => {
                const a = anchorOf(o.from), b = anchorOf(o.to);
                if (!a || !b) return null;
                // Deniz emri (çıkarma): mavi ok + gemi işareti; kara/hava: kırmızı + kılıç
                const col = o.sea ? '#38bdf8' : '#f87171';
                const marker = o.sea ? 'url(#sea-attack-arrow)' : 'url(#attack-arrow)';
                const d = curvedPath(a, b, o.id);
                return (
                  <g key={o.id}>
                    <path d={d} fill="none" stroke={col} strokeWidth={2} strokeDasharray="4 2" strokeLinecap="round" vectorEffect="non-scaling-stroke" markerEnd={marker} opacity={0.9}>
                      <animate attributeName="stroke-dashoffset" from="12" to="0" dur="1s" repeatCount="indefinite" />
                    </path>
                    <circle cx={a[0]} cy={a[1]} r={0.8} fill={col} opacity={0.9} />
                    {/* Taarruza giden ordu: kaynaktan hedefe süzülen işaret */}
                    <g>
                      <animateMotion dur={o.sea ? '2.4s' : '1.8s'} repeatCount="indefinite" path={d} />
                      <g data-badge transform={`scale(${badgeScale()})`}>
                        <circle r="9" fill="rgba(15,23,42,0.92)" stroke={col} strokeWidth="1.5" />
                        <text textAnchor="middle" dy="3.5" fontSize="10">{o.sea ? '🚢' : '⚔️'}</text>
                      </g>
                    </g>
                  </g>
                );
              })}
            </g>
          )}

          {/* KATMAN 5: transfer görselleştirmesi — kaynak seçildi (nabız) /
              hedef seçildi (mor ok + taşınan ordu işareti) */}
          {transferArrow && world && (() => {
            const a = anchorOf(transferArrow.from);
            if (!a) return null;
            if (!transferArrow.to) {
              // Hedef bekleniyor: kaynakta nabız halkası
              return (
                <g className="pointer-events-none">
                  <circle cx={a[0]} cy={a[1]} fill="none" stroke="#22d3ee" strokeWidth={1.5} vectorEffect="non-scaling-stroke">
                    <animate attributeName="r" values="1;7;1" dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.9;0.15;0.9" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                </g>
              );
            }
            const b = anchorOf(transferArrow.to);
            if (!b) return null;
            const dT = curvedPath(a, b, `${transferArrow.from}>${transferArrow.to}`, 0.88);
            return (
              <g className="pointer-events-none">
                <path d={dT} fill="none" stroke="#22d3ee" strokeWidth={2} strokeDasharray="5 3" strokeLinecap="round" vectorEffect="non-scaling-stroke" markerEnd="url(#transfer-arrow)" opacity={0.95}>
                  <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1s" repeatCount="indefinite" />
                </path>
                <circle cx={a[0]} cy={a[1]} r={0.8} fill="#22d3ee" opacity={0.9} />
                <g>
                  <animateMotion dur="1.6s" repeatCount="indefinite" path={dT} />
                  <g data-badge transform={`scale(${badgeScale()})`}>
                    <circle r="9" fill="rgba(15,23,42,0.92)" stroke="#22d3ee" strokeWidth="1.5" />
                    <text textAnchor="middle" dy="3.5" fontSize="10">🪖</text>
                  </g>
                </g>
              </g>
            );
          })()}
        </g>
      </svg>
    </div>
  );
}
