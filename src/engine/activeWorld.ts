// Aktif dünya singleton'ı — generic bölge modelinin motor genelindeki erişim noktası.
// Dünya (bölgeler, komşuluk, adlar) düzen+geojson'dan DETERMINISTIK üretilir; oyun
// başlarken/yüklenirken bir kez kurulur ve tüm motor/UI buradan okur.

import { World, generateWorld } from './world';
import { MapLayout } from './settings';

let active: World | null = null;
let activeGeo: any = null; // countries-50m geojson (topojson.feature çıktısı)

// React katmanı geojson'u getirip bir kez verir (App başlangıcında)
export function setWorldGeo(geo: any): void {
  activeGeo = geo;
}
export function getWorldGeo(): any {
  return activeGeo;
}

// Düzene göre dünyayı (yeniden) kurar. Aynı düzende ikinci çağrı cache'i korur.
export function buildActiveWorld(layout: MapLayout): World {
  if (active && active.layout === layout) return active;
  if (!activeGeo) throw new Error('World geo yüklenmedi (setWorldGeo çağrılmadı)');
  active = generateWorld(activeGeo, layout);
  return active;
}

export function getActiveWorld(): World {
  if (!active) throw new Error('Aktif dünya kurulmadı (buildActiveWorld çağrılmadı)');
  return active;
}

export function hasActiveWorld(): boolean {
  return active !== null;
}

// --- Kısayol lookup'lar (motor/UI her yerde kullanır) ---

// Bölge id'sinden ülke id'si: `{cid}-r{i}` → cid
export function regionCountry(regionId: string): string {
  const idx = regionId.lastIndexOf('-r');
  return idx > 0 ? regionId.slice(0, idx) : regionId;
}

export function regionName(regionId: string): string {
  return active?.regions[regionId]?.name ?? regionId;
}

// Bölgenin tüm komşuları (ülke içi + ülkeler arası kara sınırı)
export function regionNeighbors(regionId: string): string[] {
  const r = active?.regions[regionId];
  return r ? [...r.neighbors, ...r.crossNeighbors] : [];
}

export function countryRegions(cid: string): string[] {
  return active?.byCountry[cid] ?? [];
}

export function countryLandNeighbors(cid: string): string[] {
  return active?.countryNeighbors[cid] ?? [];
}

export function regionSeed(regionId: string): [number, number] | undefined {
  return active?.regions[regionId]?.seed;
}

// --- Deniz katmanı ---

// Bölgenin kıyısı var mı (liman ancak kıyı iline kurulur)
export function isCoastalRegion(regionId: string): boolean {
  return (active?.regionSeas[regionId]?.length ?? 0) > 0;
}

// İki KIYI bölgesi aynı deniz havzasında mı (çıkarma rotası var mı)?
// Havza = su hücrelerinin bağlı bileşeni; Hazar ile okyanus ayrı havzadır.
export function seaReachable(a: string, b: string): boolean {
  if (!active) return false;
  const compsOf = (rid: string) => {
    const s = new Set<number>();
    for (const cid of active!.regionSeas[rid] ?? []) {
      const cell = active!.seaCells[cid];
      if (cell) s.add(cell.comp);
    }
    return s;
  };
  const ca = compsOf(a);
  if (ca.size === 0) return false;
  for (const c of compsOf(b)) if (ca.has(c)) return true;
  return false;
}

export function getSeaCells(): Record<string, import('./world').SeaCell> {
  return active?.seaCells ?? {};
}
