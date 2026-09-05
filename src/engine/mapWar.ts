// Harita tabanlı cephe savaşı — GameSave ile graph motoru (frontline/resolveTurn)
// arasındaki adaptör katmanı.
//
// Kara komşularıyla savaşlar bu modülle il il çözülür:
//  - Savaş ilanında düşman ordusu eyalet garnizonlarına bölünür (anavatan payı
//    aiMilitary'de kalır ve her tur cepheye takviye sızdırır).
//  - Oyuncu tur içinde TAARRUZ emirleri kuyruklar (save.pendingOrders);
//    AI kendi emirlerini tur sonunda üretir; hepsi resolveTurn'de TEK SEFERDE çözülür.
//  - Sonuç GameSave'e geri yazılır: işgaller occupiedProvinces'a, ele geçirilen
//    düşman eyaletleri capturedEnemyProvinces'a. Tüm eyaletler düşünce ülke fethedilir.
//
// İşgal altındaki TR ilini kurtarmak da sıradan bir TAARRUZ emridir — ayrı bir
// "kurtarma taarruzu" mekaniği yoktur (eski executeLiberateAttack'in yerini alır).

import { GameSave, War, TurnEvent, BattleReport } from './types';
import { Army, MilitaryOrder, ProvinceMap, TerrainType } from './frontline/types';
import {
  resolveTurn, airSupport, landAttackPower, landDefensePower,
  LAND_ATTACK, FORT_DEFENSE, AA_UNIT_POWER, BOMBARDMENT_POWER,
  TERRAIN_DEFENSE_BONUS, DECISIVE_RATIO, REPEL_RATIO,
} from './frontline/resolveTurn';
import { getCountryStats } from './countries';
import { happinessMultiplier, clampHappiness, getAiEconomy, formatMoney, formatCount, UNIT_COSTS } from './economy';
import { applyPeaceDiplomacy } from './diplomacy';
import { regionNeighbors, regionCountry, regionName, countryRegions, countryLandNeighbors, isCoastalRegion, seaReachable } from './activeWorld';
import { countryName as countryDisplayName } from './countryData';

// GameUI/diğer modüller için yeniden dışa aç
export const countryName = countryDisplayName;
export function countryLandNeighborList(cid: string): string[] { return countryLandNeighbors(cid); }

// --- Zafer koşulu (tek kaynak: GameUI banner'ı ve testler bunu kullanır) ---
// Kara komşusu olan ülke: TÜM kara komşuları fethedilince "Bölgesel Hegemon".
// Kara komşusu OLMAYAN ada ülkesi (Avustralya, Y.Zelanda...): kara zaferi
// tanımsız kalıyordu (oyun kazanılamazdı) — deniz aşırı ISLAND_VICTORY_CONQUESTS
// ülke fethi aynı payeyi verir.
export const ISLAND_VICTORY_CONQUESTS = 3;
export function victoryAchieved(save: GameSave): boolean {
  const neighbors = countryLandNeighbors(save.playerCountryId);
  if (neighbors.length === 0) {
    return (save.conqueredCountryIds?.length ?? 0) >= ISLAND_VICTORY_CONQUESTS;
  }
  return neighbors.every(c => save.conqueredCountryIds.includes(c));
}

export const PLAYER_ID = 'player';

// --- Denge sabitleri ---
export const GARRISON_SHARE_ON_WAR = 0.7;   // savaş ilanında ordunun eyaletlere dağıtılan payı
export const HOMELAND_REINFORCE_RATE = 0.12; // anavatanın her tur en zayıf eyalete sızdırdığı pay
const AI_COMMIT_SHARE = 0.75;                // AI taarruzda garnizonunun bu payını sürer
const MAX_AI_ATTACKS_PER_WAR = 2;            // ülke başına tur başına en çok taarruz
// Eşikler yıpratma bölgesini (R>0.8) kapsar: AI kesin zafer göremese de baskı kurar.
// (Eski 1.05 orta eşiği + %1 milis, savunmasız oyuncuya bile saldırıyı imkansız kılıyordu.)
const AI_MIN_RATIO: Record<string, number> = { kolay: 1.25, orta: 0.9, zor: 0.75 };

// Milis savunması: il nüfusunun bir kısmı işgale direnir. Garnizonsuz il bile
// bedavaya düşmez — kalabalık şehirler (İstanbul, Ankara) ordusuz da zor lokmadır,
// küçük sınır illeri kırılgan kalır. Yalnız savunmada sayılır; zayiat almaz.
// DİKKAT: milis zayiat almadığından yalnız-milisli il ancak KESİN ZAFERLE (R≥1.5)
// düşer — katsayı, büyük istilanın bu eşiği aşabileceği kadar düşük olmalı.
// %0.4: küçük akınları (Ermenistan ~5-7k) hâlâ püskürtür, 300k'lık istilayı durduramaz.
export const MILITIA_DEFENSE_PER_POP = 0.004;
// Milis, nüfusla SINIRSIZ büyüyemez: bölge başına nüfusu yüksek ülkeler (Almanya
// detaylı düzende 21M/bölge = 84K milis) aksi halde fiilen istila edilemez oluyordu —
// AI hiçbir taarruz eşiğine ulaşamıyor, savaşlar içi boş geçiyordu (2026-07-13 testi).
// Tavan, kalibre edilmiş TR bölgelerini (~4-6M) etkilemez; megakent bölgesini
// "garnizonsuz da düşmez" olmaktan çıkarır: savunma artık orduyla kurulur.
export const MILITIA_POP_CAP = 6_000_000;

// Bölge garnizonu, savaş ilanındaki payının en fazla bu katına şişebilir:
// anavatan takviyesi sonsuz birikip 60k'lık garnizonu 150k'ya çıkaramaz.
export const GARRISON_CAP_MULT = 2;

// Oyuncunun kontrolündeki bölge mi? (kendi ülkesi + fetihler + ele geçirilenler − işgaldekiler)
export function isPlayerRegion(save: GameSave, rid: string): boolean {
  if (save.occupiedProvinces[rid]) return false;
  if ((save.capturedEnemyProvinces ?? []).includes(rid)) return true;
  const cid = regionCountry(rid);
  return cid === save.playerCountryId || save.conqueredCountryIds.includes(cid);
}

export function militiaDefense(save: GameSave, rid: string): number {
  if (!isPlayerRegion(save, rid)) return 0;
  const pop = Math.min(save.provinceInvestments[rid]?.nufus ?? 0, MILITIA_POP_CAP);
  return Math.round(pop * MILITIA_DEFENSE_PER_POP);
}

// Elimizdeki tüm bölgeler (kendi ülke + fethedilen + ele geçirilen; işgal hariç).
// Set: fethedilen ülkenin bölgeleri captured listesinde de kalabilir — bir bölge
// listede İKİ KEZ görünürse sınır savunması aynı şehre çift kurulum yapardı.
function heldRegions(save: GameSave): string[] {
  return [...new Set([
    ...countryRegions(save.playerCountryId),
    ...save.conqueredCountryIds.flatMap(cid => countryRegions(cid)),
    ...(save.capturedEnemyProvinces ?? []),
  ])].filter(rid => isPlayerRegion(save, rid));
}

// Bir bölgenin YABANCI komşu ülkeleri (elimizde olmayan komşu bölgelerin ülkeleri).
// UI: "Sınır Hattına Savunma Kur" tıklanan ilin bu komşularını hedefler
// (Şanlıurfa → Suriye). İç bölgede boş döner → buton gösterilmez.
export function foreignNeighborCountries(save: GameSave, rid: string): string[] {
  const out: string[] = [];
  for (const n of regionNeighbors(rid)) {
    if (isPlayerRegion(save, n)) continue;
    // İşgal altındaki KENDİ bölgemiz "yabancı: Türkiye" gibi listelenmesin —
    // tehdit işgalcinin kendisidir (savunma da ona karşı kurulur).
    const cid = save.occupiedProvinces[n] ?? regionCountry(n);
    if (cid === save.playerCountryId || save.conqueredCountryIds.includes(cid)) continue;
    if (!out.includes(cid)) out.push(cid);
  }
  return out;
}

// Verilen ülkelere sınırı olan TÜM oyuncu bölgeleri: "Suriye'ye sınır illerim".
// Fethedilen/ele geçirilen bölgeler de dahildir — sınır hattı elimizdeki
// toprakların tamamı üzerinden hesaplanır.
export function borderRegionsWith(save: GameSave, cids: string[]): string[] {
  const wanted = new Set(cids);
  // İşgal altındaki bölgenin "ülkesi" işgalcidir: X ülkesine karşı sınır hattı,
  // X'in işgal ettiği illerimize komşu illeri de kapsar.
  return heldRegions(save).filter(rid =>
    regionNeighbors(rid).some(n => !isPlayerRegion(save, n)
      && wanted.has(save.occupiedProvinces[n] ?? regionCountry(n))));
}

// --- Sınır hattı savunma kurulumu (tek kaynak: UI ve testler bunu kullanır) ---
// cids doluysa HEDEFLİ mod (o ülkelerin sınırındaki iller), boşsa TÜM sınır hattı.
// Her bölgeye amounts'taki adet TAM BİR KEZ eklenir; maliyet aynı listeden ve
// UNIT_COSTS'tan hesaplanır (liste ile ödeme asla sapamaz). Para yetmezse/hedef yoksa null.
export function buildBorderDefense(
  save: GameSave,
  cids: string[],
  amounts: { kara_savunma?: number; hava_savunma?: number }
): { save: GameSave; regions: string[]; cost: number } | null {
  const kara = Math.max(0, Math.floor(amounts.kara_savunma ?? 0));
  const hava = Math.max(0, Math.floor(amounts.hava_savunma ?? 0));
  if (kara === 0 && hava === 0) return null;
  const regions = cids.length > 0 ? borderRegionsWith(save, cids) : allBorderRegions(save);
  if (regions.length === 0) return null;
  const perRegion = kara * (UNIT_COSTS.kara_savunma || 0) + hava * (UNIT_COSTS.hava_savunma || 0);
  const cost = perRegion * regions.length;
  if (cost > save.money) return null;
  const provinceUnits = { ...save.provinceUnits };
  for (const rid of regions) {
    const units = { ...(provinceUnits[rid] || {}) };
    if (kara) units.kara_savunma = (units.kara_savunma || 0) + kara;
    if (hava) units.hava_savunma = (units.hava_savunma || 0) + hava;
    provinceUnits[rid] = units;
  }
  return { save: { ...save, money: save.money - cost, provinceUnits }, regions, cost };
}

// Elimizdeki TÜM sınır illeri (herhangi bir yabancı ülkeye komşu olanlar).
// İç bir ilden "Sınır Hattına Savunma Kur" açılırsa hedef bu listedir —
// özellik her ilden erişilebilir kalır (yalnız kara sınırı olmayan ada
// ülkelerinde liste boştur; onlara kara istilası da yoktur).
export function allBorderRegions(save: GameSave): string[] {
  return heldRegions(save).filter(rid =>
    regionNeighbors(rid).some(n => !isPlayerRegion(save, n)));
}

const MAX_WAR_DURATION = 60;                 // combat.ts ile aynı: zorunlu barış sınırı
const TRUCE_DURATION = 40;

// Arazi: bölge id'sinin hash'inden deterministik çeşitlilik (dağ/şehir/ova).
// (Gerçek arazi verisi yok; savunma çarpanına makul çeşitlilik katar.)
export function terrainOf(rid: string): TerrainType {
  let h = 0; for (let i = 0; i < rid.length; i++) h = (h * 31 + rid.charCodeAt(i)) >>> 0;
  const m = h % 10;
  if (m < 2) return 'dag';   // %20 dağlık (x1.4)
  if (m < 3) return 'sehir'; // %10 şehir (x1.25)
  if (m < 4) return 'orman'; // %10 orman (x1.15)
  return 'ova';
}

// Düşman garnizonunun payları (uçaksavar direnci)
const AI_AA_SHARE = 0.15;

// --- Graph yardımcıları (generic dünya) ---

export function countryOfProvince(provId: string): string {
  return regionCountry(provId);
}

export function getProvinceNeighbors(provId: string): string[] {
  return regionNeighbors(provId);
}

export function provinceDisplayName(provId: string): string {
  return regionName(provId);
}

// Oyuncunun sahip olduğu herhangi bir bölge (birlik iadesi için sığınak)
function anyPlayerRegion(save: GameSave): string {
  const own = countryRegions(save.playerCountryId).find(id => !save.occupiedProvinces[id]);
  return own ?? Object.keys(save.provinceInvestments)[0] ?? '';
}

const emptyArmy = (): Army => ({ asker: 0, tank: 0, ucak: 0 });
const armyOfUnits = (u: Record<string, number> | undefined): Army => ({
  asker: u?.asker ?? 0, tank: u?.tank ?? 0, ucak: u?.ucak ?? 0,
});
const armyHasUnits = (a: Army) => a.asker > 0 || a.tank > 0 || a.ucak > 0;
// Rapor/garnizon skaları: taarruz gücü cinsinden (asker 1, tank 150, uçak bombardıman)
const armyPowerOf = (a: Army) =>
  Math.round(landAttackPower(a) + a.ucak * BOMBARDMENT_POWER);

// --- Savaş ilanı: orduyu eyalet garnizonlarına böl ---

// Belirtilen kuvveti ülkenin eyaletlerine eşit dağıtır (mutasyon — çağıran kopya verir)
export function splitForceToProvinces(
  target: Record<string, number>,
  countryId: string,
  force: number
): void {
  const regs = countryRegions(countryId);
  if (regs.length === 0 || force <= 0) return;
  const share = Math.round(force / regs.length);
  for (const rid of regs) target[rid] = (target[rid] ?? 0) + share;
}

// Ülkenin CEPHE bölgeleri: oyuncunun elindeki bir bölgeye kara komşusu olan,
// henüz ele geçirilmemiş bölgeleri. AI istilasının yığınak/takviye hedefi.
export function frontierRegions(save: GameSave, countryId: string): string[] {
  const captured = new Set(save.capturedEnemyProvinces ?? []);
  return countryRegions(countryId).filter(rid =>
    !captured.has(rid)
    && getProvinceNeighbors(rid).some(n => isPlayerRegion(save, n)));
}

// AI İSTİLASI kuvveti CEPHEYE yığılır, tüm ülkeye seyrelmez. Aksi halde çok
// bölgeli ülkelerde (gerçek düzen Fransa: 98 bölge) 180K'lık istila sınırda
// 1.8K'lık yığınlara dönüşüp hiçbir taarruz eşiğine ulaşamıyordu (2026-07-13).
// KOLAY'da AI özensiz yığınak yapar (eski dağınık davranış): kolay istilası
// "baskı yok denecek kadar az" kalibrasyonu korunur — yoğunlaşma orta/zor'a özgü.
// Cephe yoksa (ör. denizaşırı) da eski davranışa düşer.
//
// MIN_INVASION_SPREAD: istila lojistiği TEK noktaya sınırsız yığınak yapamaz —
// tavan hesabı kuvveti en az bu kadar bölgelik cepheye yayılmış sayar. Tek
// bölgelik cephede (Kore DMZ'si) bu tavan yokken saldırgan bütün ordusunu tek
// yığına dikiyor, savunan hangi hazineyle olursa olsun karşılayamıyordu.
export const MIN_INVASION_SPREAD = 4;

// Bir AI istila yığınının bölge başına tavanı (ilan payının GARRISON_CAP_MULT
// katı; en az MIN_INVASION_SPREAD bölgeye yayılmış varsayımıyla).
function invasionStackCap(save: GameSave, countryId: string, frontCount: number): number {
  const baseMil = getCountryStats(countryId, save.difficulty).military;
  return Math.round(
    baseMil * GARRISON_SHARE_ON_WAR * GARRISON_CAP_MULT
    / Math.max(frontCount, MIN_INVASION_SPREAD)
  );
}

// Kuvveti cepheye yatırır; TAVANI AŞAN kısım anavatan rezervinde kalır.
// Dönüş: gerçekten yatırılan miktar (ai.ts anavatandan yalnız bunu düşer).
export function splitInvasionForce(
  save: GameSave,
  target: Record<string, number>,
  countryId: string,
  force: number
): number {
  const front = save.difficulty === 'kolay' ? [] : frontierRegions(save, countryId);
  if (front.length === 0 || force <= 0) {
    splitForceToProvinces(target, countryId, force);
    return Math.max(0, Math.round(force));
  }
  const cap = invasionStackCap(save, countryId, front.length);
  const share = Math.round(force / front.length);
  let deposited = 0;
  for (const rid of front) {
    const put = Math.min(share, Math.max(0, cap - (target[rid] ?? 0)));
    target[rid] = (target[rid] ?? 0) + put;
    deposited += put;
  }
  return deposited;
}

// AI savaş ilanı ön kontrolü: istila yığını TAVANINA ulaşsa bile (anavatan
// takviyesi dahil en iyi durum) hiçbir sınır bölgemize taarruz eşiğini
// tutturamayacaksa savaş "donuk" doğar — AI ilan eder ama tek emir üretemez,
// oyuncu barış parası ödeyene dek hiçbir şey olmaz (2026-07-14 testi: Suriye
// 123K'yla ilan edip tabyalı sınıra 2 tur bakakaldı). Böyle savaş hiç açılmaz.
// generateAiOrders ile AYNI savunma formülü ve eşikler kullanılır — sapmaz.
export function invasionHasViableTarget(save: GameSave, countryId: string): boolean {
  const front = frontierRegions(save, countryId);
  if (front.length === 0) return true; // cephe modeli dışı (denizaşırı) — eski davranış
  const minRatio = AI_MIN_RATIO[save.difficulty] ?? 1.05;
  const hMult = happinessMultiplier(save.happiness ?? 70);
  // En iyi durum yığını: kolay'da kuvvet tüm ülkeye seyrelir, orta/zor'da
  // cepheye yığılır ve takviyeyle bölge tavanına kadar dolar (invasionStackCap).
  const allRegs = Math.max(1, countryRegions(countryId).length);
  const baseMil = getCountryStats(countryId, save.difficulty).military;
  const stackCap = save.difficulty === 'kolay'
    ? (save.aiMilitary[countryId] ?? baseMil) * GARRISON_SHARE_ON_WAR / allRegs
    : invasionStackCap(save, countryId, front.length);
  const commit = stackCap * AI_COMMIT_SHARE;

  for (const src of front) {
    for (const n of getProvinceNeighbors(src)) {
      if (!isPlayerRegion(save, n)) continue;
      const units = save.provinceUnits[n];
      const army = armyOfUnits(units);
      const pDef = (landDefensePower(army)
        + ((units?.kara_savunma ?? 0) * FORT_DEFENSE + militiaDefense(save, n)))
        * TERRAIN_DEFENSE_BONUS[terrainOf(n)] * hMult;
      // generateAiOrders ile aynı kural: ordusuz (yalnız milis/tabya) bölge
      // ancak kesin zaferle düşer — eşik oraya çekilir.
      const needed = landDefensePower(army) < 1000
        ? Math.max(minRatio, DECISIVE_RATIO)
        : minRatio;
      if (commit / Math.max(1, pDef) >= needed) return true;
    }
  }
  return false;
}

// Oyuncu savaş ilan ettiğinde: ordunun %70'i eyaletlere, %30'u anavatan rezervine
export function initWarGarrisons(save: GameSave, countryId: string): GameSave {
  const total = save.aiMilitary[countryId] ?? getCountryStats(countryId, save.difficulty).military;
  const enemyProvinceStrength = { ...save.enemyProvinceStrength };
  splitForceToProvinces(enemyProvinceStrength, countryId, total * GARRISON_SHARE_ON_WAR);
  return {
    ...save,
    enemyProvinceStrength,
    aiMilitary: { ...save.aiMilitary, [countryId]: Math.round(total * (1 - GARRISON_SHARE_ON_WAR)) },
  };
}

// Barış/fetih sonrası temizlik: garnizonlar anavatana katılır, ele geçirilen
// eyaletler iade edilir, oradaki oyuncu birlikleri sınır iline döner.
export function releaseCountryProvinces(save: GameSave, countryId: string): GameSave {
  const regs = countryRegions(countryId);
  if (regs.length === 0) return save;

  const enemyProvinceStrength = { ...save.enemyProvinceStrength };
  const provinceUnits = { ...save.provinceUnits };
  const provinceInvestments = { ...save.provinceInvestments };
  let capturedEnemyProvinces = [...(save.capturedEnemyProvinces ?? [])];
  let homeland = save.aiMilitary[countryId] ?? 0;
  const homeId = anyPlayerRegion(save);

  for (const rid of regs) {
    homeland += enemyProvinceStrength[rid] ?? 0;
    delete enemyProvinceStrength[rid];
    if (capturedEnemyProvinces.includes(rid)) {
      capturedEnemyProvinces = capturedEnemyProvinces.filter(x => x !== rid);
      const units = provinceUnits[rid];
      if (units && homeId) {
        const home = { ...(provinceUnits[homeId] || {}) };
        for (const [type, count] of Object.entries(units)) home[type] = (home[type] || 0) + count;
        provinceUnits[homeId] = home;
        delete provinceUnits[rid];
      }
      // Yatırım toprağa gömülüdür: bölge iade edilince tarım/sanayi/nüfus da
      // gider — yoksa kaybedilen bölgenin geliri hazineye sızmaya devam ederdi
      // (ilhak toprağına yatırım açılınca gerçek risk oldu, 2026-07-15).
      delete provinceInvestments[rid];
    }
  }

  return {
    ...save,
    enemyProvinceStrength,
    capturedEnemyProvinces,
    provinceUnits,
    provinceInvestments,
    aiMilitary: { ...save.aiMilitary, [countryId]: Math.round(homeland) },
  };
}

// Savaş ilerlemesi (UI): kaç bölge ele geçirildi
export function warProvinceProgress(save: GameSave, countryId: string): { total: number; captured: number } {
  const regs = countryRegions(countryId);
  const captured = regs.filter(id => (save.capturedEnemyProvinces ?? []).includes(id)).length;
  return { total: regs.length, captured };
}

// Ülkenin kalan toplam gücü: anavatan + bölge garnizonları (UI barları + barış bedeli)
export function countryRemainingStrength(save: GameSave, countryId: string): number {
  let total = save.aiMilitary[countryId] ?? 0;
  for (const rid of countryRegions(countryId)) total += save.enemyProvinceStrength[rid] ?? 0;
  return Math.round(total);
}

// --- İşgal Modu: Savaşı Bitir (İlhak), Geri Çekilme ve AI Kabul/Ret ---
// Oyuncu, ele geçirdiği bölgeleri MASADA TUTARAK savaşı bitirmeyi teklif eder;
// düşman AI puan matrisine göre kabul/ret kararı verir (puan >= eşik → kabul).

export const ANNEX_ACCEPT_THRESHOLD = 50;  // karar puanı eşiği
export const ANNEX_OFFER_COOLDOWN = 5;     // reddedilen teklif bu kadar tur yenilenemez
export const RETREAT_TRUCE_DURATION = 15;  // geri çekilme ateşkesi KISA (normal barış: 40)
export const RETREAT_HAPPINESS_COST = 8;   // geri çekilmenin prestij bedeli (mutluluk puanı)

export interface AnnexFactor { label: string; delta: number }
export interface AnnexDecision {
  score: number;
  accepted: boolean;
  factors: AnnexFactor[];
  capturedCount: number;
  totalRegions: number;
  weariness: number; // AI savaş yorgunluğu (0–100)
}

// Başkent: ülkenin ilk bölgesi (r0) başkent sayılır — ayrı başkent verisi yok,
// deterministik kabul. Mega-şehir = 'sehir' arazili bölge (terrainOf).
export function isCapitalRegion(rid: string): boolean {
  return rid.endsWith('-r0');
}

// AI savaş yorgunluğu (0–100): AI'nin ayrı bir mutluluk sistemi yok; süre ve
// ordu kaybından türetilir. Süre katkısı tur başına +4 ama 60'TA TAVANLANIR:
// yorgunluk eşiğini (%70, +30 puan) salt bekleyerek aşmak mümkün olmasın —
// savaşsız 18 tur bekleyip bedava ilhak koparma sömürüsünü kapatır (2026-07-15
// denge). Eşiği aşmak için düşmana gerçek kayıp (%17+) verdirmek gerekir.
export function aiWarWeariness(save: GameSave, war: War): number {
  const duration = Math.max(0, save.turn - war.startedTurn);
  const lossRatio = war.enemyMaxStrength > 0
    ? Math.max(0, 1 - war.enemyStrength / war.enemyMaxStrength) : 0;
  return Math.min(100, Math.round(Math.min(60, duration * 4) + lossRatio * 60));
}

// Karar matrisi (docs/prompt şablonuyla birebir):
//   Güç oranı (oyuncu/AI) > 1.5 → +20 · < 0.8 → −25
//   AI savaş yorgunluğu > %70 → +30
//   İşgal edilen bölge oranı < %10 → +15 · > %40 → −30
//   İşgalde başkent/mega-şehir varsa → −40
// playerPower: HUD'daki toplam saldırı gücü (computeTotalAttackPower) —
// mapWar combat'ı import edemez (döngü olur), değer parametreyle gelir;
// böylece oyuncunun panelde gördüğü sayı ile AI'nin okuduğu sayı hep aynıdır.
export function evaluateAnnexOffer(
  save: GameSave,
  countryId: string,
  playerPower: number
): AnnexDecision | null {
  const war = save.wars.find(w => w.countryId === countryId);
  if (!war) return null;
  const regs = countryRegions(countryId);
  if (regs.length === 0) return null; // bölgesiz ülkeyle ilhak pazarlığı olmaz
  const captured = regs.filter(id => (save.capturedEnemyProvinces ?? []).includes(id));
  const factors: AnnexFactor[] = [];

  const aiPower = Math.max(1, countryRemainingStrength(save, countryId));
  const powerRatio = playerPower / aiPower;
  if (powerRatio > 1.5) {
    factors.push({ label: `Ezici askeri üstünlük (${powerRatio.toFixed(1)}x)`, delta: 20 });
  } else if (powerRatio < 0.8) {
    factors.push({ label: `Düşman askeri üstün (${powerRatio.toFixed(1)}x)`, delta: -25 });
  }

  const weariness = aiWarWeariness(save, war);
  if (weariness > 70) {
    factors.push({ label: `Savaş yorgunluğu %${weariness} — halkı barış istiyor`, delta: 30 });
  }

  const occupationRatio = regs.length > 0 ? captured.length / regs.length : 0;
  if (occupationRatio < 0.10) {
    factors.push({ label: 'Kayıp küçük bir sınır bölgesi (<%10)', delta: 15 });
  } else if (occupationRatio > 0.40) {
    // −30 → −20 (2026-07-16 denge): −30'da >%40 işgalde ilhak matematiksel
    // olarak İMKANSIZDI (maks +20+30−30=20 < 50) — küçük ülkelerde "ya hepsi
    // ya iade" dayatıyordu. −20 ile ancak ezici üstünlük + tam yorgunluk
    // birleşirse eşik TAM tutturulur (20+30−20=50): zor ama mümkün.
    factors.push({ label: 'Toprak kaybı varoluşsal (>%40) — sonuna dek savaşır', delta: -20 });
  }

  const strategic = captured.some(rid => isCapitalRegion(rid) || terrainOf(rid) === 'sehir');
  if (strategic) {
    factors.push({ label: 'İşgalde başkent/mega-şehir var — kolay teslim edilemez', delta: -40 });
  }

  const score = factors.reduce((s, f) => s + f.delta, 0);
  return {
    score,
    accepted: score >= ANNEX_ACCEPT_THRESHOLD,
    factors,
    capturedCount: captured.length,
    totalRegions: regs.length,
    weariness,
  };
}

// "Savaşı Bitir" teklifini UYGULAR. Kabulde: ele geçirilen bölgeler kalıcı
// İLHAK edilir (capturedEnemyProvinces'ta kalır — oyuncu toprağı olarak
// yaşamaya devam ederler), kalan bölge garnizonları anavatana döner, savaş
// biter, normal ateşkes başlar. Redde: savaş sürer, teklif COOLDOWN boyunca
// yenilenemez. Karar her iki durumda da döner (UI sonucu gösterir).
export function applyAnnexOffer(
  save: GameSave,
  countryId: string,
  playerPower: number
): { save: GameSave; decision: AnnexDecision } | null {
  const decision = evaluateAnnexOffer(save, countryId, playerPower);
  if (!decision) return null;
  if (save.turn < (save.annexOffers?.[countryId] ?? 0)) return { save, decision }; // bekleme süresi

  if (!decision.accepted) {
    return {
      save: {
        ...save,
        annexOffers: { ...(save.annexOffers ?? {}), [countryId]: save.turn + ANNEX_OFFER_COOLDOWN },
      },
      decision,
    };
  }

  const captured = new Set(
    (save.capturedEnemyProvinces ?? []).filter(rid => regionCountry(rid) === countryId));

  // Kalan (ele geçirilmemiş) bölge garnizonları anavatana katılır
  const enemyProvinceStrength = { ...save.enemyProvinceStrength };
  let homeland = save.aiMilitary[countryId] ?? 0;
  for (const rid of countryRegions(countryId)) {
    if (captured.has(rid)) continue;
    homeland += enemyProvinceStrength[rid] ?? 0;
    delete enemyProvinceStrength[rid];
  }

  let next: GameSave = {
    ...save,
    enemyProvinceStrength,
    aiMilitary: { ...save.aiMilitary, [countryId]: Math.round(homeland) },
    wars: save.wars.filter(w => w.countryId !== countryId),
    truces: { ...save.truces, [countryId]: save.turn + TRUCE_DURATION },
    annexOffers: { ...(save.annexOffers ?? {}), [countryId]: 0 },
    // Bu ülkeyi hedefleyen emirler düşer; İLHAK edilen (artık bizim) bölgelere
    // birlik taşıyan MOVE emirleri yaşar.
    pendingOrders: (save.pendingOrders ?? []).filter(o => {
      const cid = save.occupiedProvinces[o.to] ?? regionCountry(o.to);
      if (cid !== countryId) return true;
      return o.type === 'MOVE' && captured.has(o.to);
    }),
  };
  next = applyPeaceDiplomacy(next, countryId);
  return { save: next, decision };
}

// Geri Çekilme: savaşı TEK TARAFLI bitirir — barış bedeli ödenmez ama ele
// geçirilen her bölge İADE edilir, birlikler yurda döner, prestij düşer
// (mutluluk −RETREAT_HAPPINESS_COST) ve ateşkes kısadır: düşman erken
// dönebilir. "Bedava barış" değildir, kesilen zarardır. (Düşmanın işgal
// ettiği İLLERİMİZ varsa onlar geri VERİLMEZ — fidyesiz çıkışın bedeli.)
//
// Ateşkes yalnız GERÇEKTEN savaşılmış savaşta doğar: "ilan et + hemen geri
// çekil" kombosu 15 turluk saldırı kalkanına dönüşüyordu (−8 mutlulukla
// tehlikeli komşu bedavaya kilitleniyordu — 2026-07-17 simülasyon bulgusu).
// Bu eşikten kısa savaşta geri çekilme savaşı bitirir ama ateşkes VERMEZ.
export const RETREAT_TRUCE_MIN_WAR_TURNS = 3;
export function retreatFromWar(save: GameSave, countryId: string): GameSave {
  const war = save.wars.find(w => w.countryId === countryId);
  if (!war) return save;
  const foughtLongEnough = save.turn - war.startedTurn >= RETREAT_TRUCE_MIN_WAR_TURNS;
  let next = releaseCountryProvinces(save, countryId);
  next = {
    ...next,
    wars: next.wars.filter(w => w.countryId !== countryId),
    truces: foughtLongEnough
      ? { ...next.truces, [countryId]: next.turn + RETREAT_TRUCE_DURATION }
      : next.truces,
    happiness: clampHappiness((next.happiness ?? 70) - RETREAT_HAPPINESS_COST),
    pendingOrders: (next.pendingOrders ?? []).filter(o => {
      const cid = next.occupiedProvinces[o.to] ?? regionCountry(o.to);
      return cid !== countryId;
    }),
  };
  return applyPeaceDiplomacy(next, countryId);
}

// --- Dünya grafını kur (Single Source of Truth: GameSave → ProvinceMap) ---

export function buildWarGraph(save: GameSave): ProvinceMap {
  const graph: ProvinceMap = {};
  const captured = new Set(save.capturedEnemyProvinces ?? []);

  // Oyuncunun bölgeleri: kendi ülkesi + fethedilen ülkeler + ele geçirilenler.
  // İşgal altındakiler işgalcinin node'u olur.
  const ownedCountries = [save.playerCountryId, ...save.conqueredCountryIds];
  const ownedRegionIds = new Set<string>([...captured]);
  for (const cid of ownedCountries) for (const rid of countryRegions(cid)) ownedRegionIds.add(rid);

  for (const id of ownedRegionIds) {
    const occupier = save.occupiedProvinces[id];
    const units = save.provinceUnits[id];
    graph[id] = {
      id, name: regionName(id),
      ownerId: occupier ?? PLAYER_ID,
      neighbors: getProvinceNeighbors(id),
      terrain: terrainOf(id),
      army: occupier
        ? { asker: Math.round(save.occupiedGarrisons?.[id] ?? 50_000), tank: 0, ucak: 0 }
        : armyOfUnits(units),
      defenses: occupier
        ? { kara_savunma: 0, hava_savunma: 0 } // işgalci bizim tabyalarımızı kullanamaz
        : {
            kara_savunma: (units?.kara_savunma ?? 0) + militiaDefense(save, id) / FORT_DEFENSE,
            hava_savunma: units?.hava_savunma ?? 0,
          },
      population: 0,
      baseIncome: 0,
    };
  }

  // Savaştaki (veya garnizon/işgal kaydı olan) düşman ülkelerin bölgeleri
  const mapWarCountries = new Set(save.wars.filter(w => w.warType === 'harita').map(w => w.countryId));
  const enemyCountries = new Set<string>(mapWarCountries);
  for (const rid of Object.keys(save.enemyProvinceStrength)) enemyCountries.add(regionCountry(rid));

  for (const cid of enemyCountries) {
    if (save.conqueredCountryIds.includes(cid) || cid === save.playerCountryId) continue;
    for (const rid of countryRegions(cid)) {
      if (captured.has(rid)) continue; // ele geçirilenler yukarıda eklendi
      const strength = Math.round(save.enemyProvinceStrength[rid] ?? 0);
      graph[rid] = {
        id: rid, name: regionName(rid),
        ownerId: cid,
        neighbors: getProvinceNeighbors(rid),
        terrain: terrainOf(rid),
        army: { asker: strength, tank: 0, ucak: 0 },
        defenses: { kara_savunma: 0, hava_savunma: Math.round(strength * AI_AA_SHARE / AA_UNIT_POWER) },
        population: 0,
        baseIncome: 0,
      };
    }
  }

  // SANAL kenarlar: resolveTurn "hedef komşu olmalı" doğrulamasını değiştirmeden
  // geçer (adaptör grafiğe kenarı ekler). Tek yön yeterli — emir from→to yürür;
  // başarısız çıkarma/varış kaynağa otomatik döner.
  //  - ÇIKARMA (sea): deniz rotası zaten queueAttackOrders'ta doğrulandı.
  //  - TRANSFER (MOVE): kendi bölgeleri arası — ülke içi yol varsayılır,
  //    komşu olmayan bölgeye de tek turda varır (kilitli geçen tur = bedeli).
  for (const o of save.pendingOrders ?? []) {
    if (!o.sea && o.type !== 'MOVE') continue;
    const f = graph[o.from];
    if (f && graph[o.to] && !f.neighbors.includes(o.to)) f.neighbors.push(o.to);
  }

  return graph;
}

// --- Emir yönetimi (oyuncu) ---

export interface AttackPreview {
  attackPower: number;
  defensePower: number;
  ratio: number;
  outcome: 'decisive' | 'attrition' | 'repelled';
  planesLost: number;
  // Tur sonunda beklenen düşman takviyesi (anavatan → en zayıf garnizon).
  // Emir tur sonunda çözüldüğünden fiili savunma önizlemeden güçlü olabilir;
  // bu alanlar muhafazakâr tahmini verir. reinforcement=0 ise ikisi aynıdır.
  reinforcement: number;
  ratioAfter: number;
  outcomeAfter: 'decisive' | 'attrition' | 'repelled';
}

// Tur sonunda hedef bölgeye gelmesi beklenen anavatan takviyesi.
// resolveMapTurn adım 2'nin birebir tahmini: takviye yalnız ülkenin EN ZAYIF
// garnizonuna gider ve bölge tavanıyla sınırlıdır; savaş bu tur ilan edildiyse gelmez.
export function expectedReinforcement(save: GameSave, targetId: string): number {
  const cid = regionCountry(targetId);
  const war = save.wars.find(w => w.countryId === cid && w.warType === 'harita');
  if (!war || war.startedTurn === save.turn) return 0;
  const homeland = save.aiMilitary[cid] ?? 0;
  if (homeland < 2000) return 0;
  const { provIds, capDivisor } = reinforcementPool(save, war);
  if (provIds.length === 0) return 0;
  const weakest = provIds.reduce((a, b) =>
    (save.enemyProvinceStrength[a] ?? 0) <= (save.enemyProvinceStrength[b] ?? 0) ? a : b);
  if (weakest !== targetId) return 0;
  const baseMil = getCountryStats(cid, save.difficulty).military;
  const capPerRegion = Math.round(
    baseMil * GARRISON_SHARE_ON_WAR * GARRISON_CAP_MULT / Math.max(1, capDivisor)
  );
  const room = capPerRegion - (save.enemyProvinceStrength[targetId] ?? 0);
  if (room <= 0) return 0;
  return Math.min(Math.round(homeland * HOMELAND_REINFORCE_RATE), room);
}

// Takviye havuzu: hangi bölgeler anavatan takviyesi alabilir + bölge tavanı
// hangi sayıya bölünür. OYUNCUNUN açtığı savaşta ülke her yerini savunur
// (tüm bölgeler, eski davranış). AI İSTİLASINDA (initiator 'ai') takviye ve
// tavan CEPHEYE odaklanır — istila kuvveti çok bölgeli ülkede seyrelip
// kaybolmasın. resolveMapTurn adım 2 ile expectedReinforcement AYNI havuzu
// kullanır; ayrışırlarsa taarruz önizlemesi motordan sapar.
function reinforcementPool(
  save: GameSave,
  war: { countryId: string; initiator: 'player' | 'ai' }
): { provIds: string[]; capDivisor: number } {
  const allRegs = countryRegions(war.countryId);
  const provIds = allRegs.filter(id => !(save.capturedEnemyProvinces ?? []).includes(id));
  if (war.initiator === 'ai' && save.difficulty !== 'kolay') {
    const front = provIds.filter(id =>
      getProvinceNeighbors(id).some(n => isPlayerRegion(save, n)));
    // capDivisor ≥ MIN_INVASION_SPREAD: dar cephede (Kore DMZ'si) takviye tek
    // yığını sonsuz şişiremez — splitInvasionForce tavanıyla aynı varsayım.
    if (front.length > 0) {
      return { provIds: front, capDivisor: Math.max(front.length, MIN_INVASION_SPREAD) };
    }
  }
  return { provIds, capDivisor: allRegs.length };
}

// UI önizlemesi: bu birliklerle taarruz edilirse beklenen sonuç (varyanssız).
// Motorla AYNI formüller kullanılır (airSupport + eşikler) — gösterge sapmaz.
export function previewAttack(
  save: GameSave,
  targetId: string,
  commits: Record<string, Army>
): AttackPreview | null {
  const graph = buildWarGraph(save);
  const target = graph[targetId];
  if (!target || target.ownerId === PLAYER_ID) return null;

  const force = emptyArmy();
  for (const a of Object.values(commits)) {
    force.asker += a.asker; force.tank += a.tank; force.ucak += a.ucak;
  }
  const hMult = happinessMultiplier(save.happiness ?? 70);
  const { bombardment, attackerPlanesLost } = airSupport(force, target.army, target.defenses.hava_savunma);
  const attackPower = (landAttackPower(force) + bombardment) * hMult;
  const defensePower = (landDefensePower(target.army) + target.defenses.kara_savunma * FORT_DEFENSE)
    * TERRAIN_DEFENSE_BONUS[target.terrain];
  const ratio = defensePower > 0 ? attackPower / defensePower : Number.POSITIVE_INFINITY;
  // Toprağı yalnız kara birliği tutar: sadece uçakla akında R yüksek olsa bile
  // bölge ele geçirilemez — en fazla "yıpratma" (motorla birebir aynı kural).
  const hasGroundForce = force.asker > 0 || force.tank > 0;
  const outcomeOf = (r: number): AttackPreview['outcome'] =>
    r >= DECISIVE_RATIO && hasGroundForce ? 'decisive' : r > REPEL_RATIO ? 'attrition' : 'repelled';

  // Takviye sonrası tahmin: emir tur sonunda çözülür; hedef bu turun takviyesini
  // alacaksa savunma büyür — oyuncu "kesin zafer" görüp yıpratmaya düşmesin.
  const reinforcement = expectedReinforcement(save, targetId);
  const defenseAfter = reinforcement > 0
    ? (landDefensePower({ ...target.army, asker: target.army.asker + reinforcement })
        + target.defenses.kara_savunma * FORT_DEFENSE) * TERRAIN_DEFENSE_BONUS[target.terrain]
    : defensePower;
  const ratioAfter = defenseAfter > 0 ? attackPower / defenseAfter : Number.POSITIVE_INFINITY;

  return {
    attackPower: Math.round(attackPower),
    defensePower: Math.round(defensePower),
    ratio,
    outcome: outcomeOf(ratio),
    planesLost: attackerPlanesLost,
    reinforcement,
    ratioAfter,
    outcomeAfter: outcomeOf(ratioAfter),
  };
}

// Bir bölge oyuncunundur (kara birliği yürütebilir): oyuncu ülkesi/fetih/ele geçirilen, işgalsiz
function isPlayerTerritory(save: GameSave, id: string): boolean {
  return isPlayerRegion(save, id);
}

// Hedefe komşu, KARA taarruzuna katılabilecek oyuncu illeri (asker/tank yürür)
export function attackSources(save: GameSave, targetId: string): string[] {
  return getProvinceNeighbors(targetId).filter(id => isPlayerTerritory(save, id));
}

// --- Deniz harekâtı (amfibi çıkarma) ---
// Gemiler LİMANLI kıyı illerinde üslenir; kara birliklerini deniz rotasıyla
// (aynı su havzası) düşman KIYI bölgesine taşıyıp çıkarma yapar.
export const SHIP_CAPACITY = 2_000; // gemi başına taşıma (ağırlık puanı)
export const SEA_WEIGHT: Record<'asker' | 'tank', number> = { asker: 1, tank: 25 };

export function seaLiftWeight(a: Army): number {
  return a.asker * SEA_WEIGHT.asker + a.tank * SEA_WEIGHT.tank;
}

// İlin çıkarma kapasitesi (ağırlık puanı): gemi sayısı × SHIP_CAPACITY
export function shipCapacityOf(save: GameSave, provId: string): number {
  return (save.provinceUnits[provId]?.gemi ?? 0) * SHIP_CAPACITY;
}

// Çıkarma kaynakları: limanlı + gemili KIYI illerimiz — hedef kıyıysa ve aynı
// su havzasındaysa. Hedefe kara komşusu olan iller zaten attackSources'tadır.
export function seaAttackSources(save: GameSave, targetId: string): string[] {
  if (!isCoastalRegion(targetId)) return [];
  const land = new Set(attackSources(save, targetId));
  return Object.keys(save.provinceUnits).filter(id =>
    !land.has(id)
    && isPlayerTerritory(save, id)
    && isCoastalRegion(id)
    && (save.provinceUnits[id]?.liman ?? 0) > 0
    && (save.provinceUnits[id]?.gemi ?? 0) > 0
    && seaReachable(id, targetId));
}

// Kara sınırı olmayan ülkeye savaş/sefer: en az bir kıyı bölgesine çıkarma
// yapabilecek kaynağımız (liman+gemi+rota) var mı?
export function canLaunchSeaInvasion(save: GameSave, cid: string): boolean {
  return countryRegions(cid).some(rid => seaAttackSources(save, rid).length > 0);
}

// Hava akınına katılabilecek üsler: uçağı olan TÜM oyuncu bölgeleri (menzil yok).
// Komşuluk aranmaz — uçaklar herhangi bir düşman bölgesini bombalayabilir.
export function airBases(save: GameSave, targetId: string): string[] {
  const adjacent = new Set(attackSources(save, targetId));
  return Object.keys(save.provinceUnits)
    .filter(id => (save.provinceUnits[id]?.ucak ?? 0) > 0
      && isPlayerTerritory(save, id)
      && !adjacent.has(id)); // komşu üsler zaten attackSources'ta (kara+hava birlikte)
}

// Bir hedefe taarruz emri verilebilir mi? (işgal altındaki TR ili her zaman;
// düşman eyaleti yalnız o ülkeyle harita savaşı sürüyorsa)
export function canOrderAttack(save: GameSave, targetId: string): boolean {
  // İşgal altındaki kendi bölgen her zaman hedeftir (kurtarma)
  if (save.occupiedProvinces[targetId]) return true;
  if (isPlayerRegion(save, targetId)) return false; // kendi bölgene saldıramazsın
  const cid = countryOfProvince(targetId);
  return save.wars.some(w => w.countryId === cid && w.warType === 'harita');
}

// Taarruz emirlerini kuyruğa ekler (kaynak başına bir emir; aynı kaynaktan
// önceki emir varsa üstüne yazılır — bir ordu aynı anda tek yere yürür)
export function queueAttackOrders(
  save: GameSave,
  targetId: string,
  commits: Record<string, Army>
): GameSave {
  if (!canOrderAttack(save, targetId)) return save;
  const landSources = new Set(attackSources(save, targetId));
  const seaSources = new Set(seaAttackSources(save, targetId));
  const airOnlySources = new Set(airBases(save, targetId));
  const orders: MilitaryOrder[] = [];
  for (const [from, req] of Object.entries(commits)) {
    let units = req;
    let sea = false;
    if (landSources.has(from)) {
      // Komşu il: kara + hava birlikte gider
    } else if (seaSources.has(from)) {
      // ÇIKARMA: kara birlikleri gemi kapasitesine kırpılır (uçaklar uçar, binmez)
      sea = true;
      let asker = Math.max(0, req.asker);
      let tank = Math.max(0, req.tank);
      const cap = shipCapacityOf(save, from);
      const w = asker * SEA_WEIGHT.asker + tank * SEA_WEIGHT.tank;
      if (w > cap) {
        const f = w > 0 ? cap / w : 0;
        asker = Math.floor(asker * f);
        tank = Math.floor(tank * f);
      }
      units = { asker, tank, ucak: req.ucak };
    } else if (airOnlySources.has(from)) {
      // Uzak üs: yalnız uçak (hava akını, menzilsiz) — kara birliği yürüyemez
      units = { asker: 0, tank: 0, ucak: req.ucak };
    } else {
      continue; // geçersiz kaynak
    }
    if (!armyHasUnits(units)) continue;
    orders.push({
      id: `ord-${save.turn}-${from}-${targetId}`,
      type: 'ATTACK',
      issuedBy: PLAYER_ID,
      from,
      to: targetId,
      units,
      ...(sea ? { sea: true } : {}),
    });
  }
  if (orders.length === 0) return save;
  // Yalnız AYNI kaynak→AYNI hedef eski emri değiştirilir; kaynağın BAŞKA hedeflere
  // emirleri korunur — bir il ordusunu bölüp aynı anda birden çok ile saldırabilir.
  // (Modal, başka hedeflere bağlanan birlikleri düşerek bölüşümü zaten zorlar;
  // motor da çözümde emirleri sırayla kilitleyip mevcuda kırpar.)
  const pending = (save.pendingOrders ?? []).filter(o =>
    !orders.some(n => n.from === o.from && n.to === o.to));
  return { ...save, pendingOrders: [...pending, ...orders] };
}

// --- Ordu transferi (kendi bölgeleri arası) ---
// Anlık ışınlama DEĞİL: MOVE emri kuyruklanır, tur sonunda resolveTurn işler.
// Emre bağlanan birlikler kilitlenir (kaynağı ancak %25 verimle savunur) —
// cepheyi boşaltıp orduyu ülkenin öbür ucuna taşımanın gerçek bir bedeli olur.
// Hedef tur içinde düşman eline geçerse birlikler kaynağa döner (motor kuralı).
// Yalnız mobil birlikler taşınır (asker/tank/uçak); yapılar ve gemiler sabittir.
export function queueTransferOrder(
  save: GameSave,
  from: string,
  to: string,
  units: Army
): GameSave {
  if (from === to) return save;
  if (!isPlayerRegion(save, from) || !isPlayerRegion(save, to)) return save;
  const clean: Army = {
    asker: Math.max(0, Math.floor(units.asker)),
    tank: Math.max(0, Math.floor(units.tank)),
    ucak: Math.max(0, Math.floor(units.ucak)),
  };
  if (!armyHasUnits(clean)) {
    // Boş taslakla Gönder = bu rotadaki emri iptal et (UI mevcut emri düzenleme
    // olarak açar; sıfıra çekmek doğal olarak "vazgeçtim" demektir)
    const pending = (save.pendingOrders ?? []).filter(o =>
      !(o.type === 'MOVE' && o.from === from && o.to === to));
    return pending.length === (save.pendingOrders ?? []).length
      ? save : { ...save, pendingOrders: pending };
  }
  const order: MilitaryOrder = {
    id: `mov-${save.turn}-${from}-${to}`,
    type: 'MOVE',
    issuedBy: PLAYER_ID,
    from,
    to,
    units: clean,
  };
  // Aynı kaynak→hedef eski transfer değiştirilir; diğer emirler korunur
  const pending = (save.pendingOrders ?? []).filter(o =>
    !(o.type === 'MOVE' && o.from === from && o.to === to));
  return { ...save, pendingOrders: [...pending, order] };
}

export function cancelOrder(save: GameSave, orderId: string): GameSave {
  return { ...save, pendingOrders: (save.pendingOrders ?? []).filter(o => o.id !== orderId) };
}

// Emre bağlanmış (kilitli) birlikler — UI kaynak ilde kalan "serbest" birliği göstersin
export function committedUnits(save: GameSave, provId: string): Army {
  const total = emptyArmy();
  for (const o of save.pendingOrders ?? []) {
    if (o.from !== provId) continue;
    total.asker += o.units.asker; total.tank += o.units.tank; total.ucak += o.units.ucak;
  }
  return total;
}

// --- AI emir üretimi ---

function generateAiOrders(save: GameSave, graph: ProvinceMap): MilitaryOrder[] {
  const orders: MilitaryOrder[] = [];
  const minRatio = AI_MIN_RATIO[save.difficulty] ?? 1.05;
  const hMult = happinessMultiplier(save.happiness ?? 70);

  for (const war of save.wars) {
    if (war.warType !== 'harita') continue;
    if (war.startedTurn === save.turn) continue; // ilan turu: oyuncuya hazırlık şansı

    // Son kale kuralı: ülkenin elinde kalan SON öz bölgesi huruç ETMEZ, tam
    // güçle savunur. Aksi halde her tur %75'iyle boş bıraktığımız bölgeyi geri
    // alıp kendi bölgesini kilitli birliğin %25 savunmasına terk ediyor; savaş
    // "bölge pinponu"na dönüp bitirilemiyordu (2026-07-14 testi). İşgal ettiği
    // oyuncu illeri öz bölge sayılmaz — oradan taarruz sürebilir.
    const ownRegions = Object.values(graph).filter(
      p => p.ownerId === war.countryId && regionCountry(p.id) === war.countryId);
    const lastStandId = ownRegions.length === 1 ? ownRegions[0].id : null;

    // Kaynaklar: ülkenin eyaletleri + işgal ettiği TR illeri (son kale hariç)
    const sources = Object.values(graph).filter(p =>
      p.ownerId === war.countryId && p.army.asker > 1000 && p.id !== lastStandId);

    const candidates: { from: string; to: string; ratio: number; commit: number }[] = [];
    for (const src of sources) {
      const commit = Math.floor(src.army.asker * AI_COMMIT_SHARE);
      if (commit < 1000) continue;
      for (const nId of src.neighbors) {
        const t = graph[nId];
        if (!t || t.ownerId !== PLAYER_ID) continue;
        const pDef = (landDefensePower(t.army) + t.defenses.kara_savunma * FORT_DEFENSE)
          * TERRAIN_DEFENSE_BONUS[t.terrain] * hMult;
        const ratio = commit / Math.max(1, pDef);
        // Ordusuz (yalnız milis/tabya) bölgede yıpratma İLERLEME SAĞLAMAZ —
        // milis zayiat almaz; bölge ancak kesin zaferle (R≥1.5) düşer. AI o
        // eşiğin altında boşuna taarruz edip kan kaybetmesin.
        const needed = landDefensePower(t.army) < 1000
          ? Math.max(minRatio, DECISIVE_RATIO)
          : minRatio;
        candidates.push({ from: src.id, to: nId, ratio: ratio / needed * minRatio, commit });
      }
    }

    // En umut verici taarruzlar önce; kaynak başına tek emir
    candidates.sort((a, b) => b.ratio - a.ratio);
    const usedSources = new Set<string>();
    let count = 0;
    for (const c of candidates) {
      if (count >= MAX_AI_ATTACKS_PER_WAR) break;
      if (c.ratio < minRatio) break;
      if (usedSources.has(c.from)) continue;
      usedSources.add(c.from);
      orders.push({
        id: `ai-${save.turn}-${c.from}`,
        type: 'ATTACK',
        issuedBy: war.countryId,
        from: c.from,
        to: c.to,
        units: { asker: c.commit, tank: 0, ucak: 0 },
      });
      count++;
    }
  }
  return orders;
}

// --- Tur çözümleme: emirler + muharebeler + sonuçların GameSave'e yazımı ---

export function resolveMapTurn(save: GameSave): { save: GameSave; events: TurnEvent[]; reports: BattleReport[] } {
  const mapWars = save.wars.filter(w => w.warType === 'harita');
  const playerOrders = save.pendingOrders ?? [];
  if (mapWars.length === 0 && playerOrders.length === 0) {
    return { save, events: [], reports: [] };
  }

  const events: TurnEvent[] = [];
  const reports: BattleReport[] = [];
  const aiMilitary = { ...save.aiMilitary };
  let enemyProvinceStrength = { ...save.enemyProvinceStrength };
  let money = save.money;
  const truces = { ...save.truces };
  let wars = [...save.wars];

  // 1) Zorunlu barış (60 tur): harita savaşları da savaş yorgunluğuna tabidir
  for (const war of mapWars) {
    if (save.turn - war.startedTurn < MAX_WAR_DURATION) continue;
    const maxS = war.enemyMaxStrength > 0 ? war.enemyMaxStrength : 1;
    const f = countryRemainingStrength({ ...save, aiMilitary, enemyProvinceStrength }, war.countryId) / maxS;
    const base = getCountryStats(war.countryId, save.difficulty).income;
    const cost = Math.round(base * 10 * (f - 0.4));
    money = Math.max(0, money - Math.max(0, cost)) + Math.max(0, -cost);
    truces[war.countryId] = save.turn + TRUCE_DURATION;
    wars = wars.filter(w => w.countryId !== war.countryId);
    events.push({ type: 'peace', message: `${war.countryName} ile savaş yorgunluğu: zorunlu barış imzalandı.` });
    reports.push({
      countryName: war.countryName, countryId: war.countryId, turn: save.turn,
      playerArmyBefore: 0, playerArmyAfter: 0, playerLoss: 0,
      enemyArmyBefore: war.enemyStrength, enemyArmyAfter: war.enemyStrength,
      enemyLoss: 0, planesLost: 0, result: 'peace', initiator: war.initiator,
    });
  }
  let working: GameSave = { ...save, wars, aiMilitary, enemyProvinceStrength, money, truces };
  for (const war of mapWars) {
    if (!wars.some(w => w.countryId === war.countryId)) {
      working = releaseCountryProvinces(working, war.countryId);
    }
  }
  enemyProvinceStrength = { ...working.enemyProvinceStrength };

  // 2) Anavatan takviyesi: rezerv, en zayıf eyalet garnizonuna sızar.
  // Bölge başına tavan: savaş ilanındaki garnizon payının GARRISON_CAP_MULT katı —
  // uzun savaşta garnizonlar sonsuz şişmez (rezerv anavatanda bekler).
  for (const war of working.wars) {
    if (war.warType !== 'harita' || war.startedTurn === working.turn) continue;
    const homeland = working.aiMilitary[war.countryId] ?? 0;
    if (homeland < 2000) continue;
    const { provIds, capDivisor } = reinforcementPool(working, war);
    if (provIds.length === 0) continue;
    const baseMil = getCountryStats(war.countryId, working.difficulty).military;
    const capPerRegion = Math.round(
      baseMil * GARRISON_SHARE_ON_WAR * GARRISON_CAP_MULT / Math.max(1, capDivisor)
    );
    const weakest = provIds.reduce((a, b) =>
      (enemyProvinceStrength[a] ?? 0) <= (enemyProvinceStrength[b] ?? 0) ? a : b);
    const room = capPerRegion - (enemyProvinceStrength[weakest] ?? 0);
    if (room <= 0) continue; // en zayıf garnizon bile tavanda: takviye durur
    const transfer = Math.min(Math.round(homeland * HOMELAND_REINFORCE_RATE), room);
    working.aiMilitary[war.countryId] = homeland - transfer;
    enemyProvinceStrength[weakest] = (enemyProvinceStrength[weakest] ?? 0) + transfer;
  }
  working = { ...working, enemyProvinceStrength };

  // 3) Graph kur, emirleri topla, TEK SEFERDE çöz
  const graph = buildWarGraph(working);
  const aiOrders = generateAiOrders(working, graph);
  const hMult = happinessMultiplier(working.happiness ?? 70);
  const result = resolveTurn(
    graph,
    { turn: working.turn, orders: [...playerOrders, ...aiOrders] },
    Math.random,
    { powerMult: { [PLAYER_ID]: hMult } }
  );

  // 4) Sonucu GameSave'e geri yaz
  const provinceUnits = { ...working.provinceUnits };
  const occupiedProvinces = { ...working.occupiedProvinces };
  const occupiedGarrisons = { ...working.occupiedGarrisons };
  enemyProvinceStrength = { ...working.enemyProvinceStrength };
  let capturedEnemyProvinces = [...(working.capturedEnemyProvinces ?? [])];

  const setMobileUnits = (id: string, army: Army) => {
    const next = { ...(provinceUnits[id] || {}) };
    delete next.asker; delete next.tank; delete next.ucak;
    if (army.asker > 0) next.asker = army.asker;
    if (army.tank > 0) next.tank = army.tank;
    if (army.ucak > 0) next.ucak = army.ucak;
    if (Object.keys(next).length > 0) provinceUnits[id] = next;
    else delete provinceUnits[id];
  };

  const warCountryName = (cid: string) =>
    working.wars.find(w => w.countryId === cid)?.countryName ?? countryName(cid);

  // Oyuncunun ülke(leri): bu bölgeler "kendi toprağı" mantığıyla işlenir
  const ownCountries = new Set<string>([working.playerCountryId, ...working.conqueredCountryIds]);

  for (const [id, p] of Object.entries(result.provinces)) {
    const regionCid = countryOfProvince(id);
    const isOwnTerritory = ownCountries.has(regionCid);
    if (isOwnTerritory) {
      if (p.ownerId === PLAYER_ID) {
        if (occupiedProvinces[id]) {
          delete occupiedProvinces[id];
          delete occupiedGarrisons[id];
          events.push({ type: 'liberation', message: `${regionName(id)} kurtarıldı!` });
        }
        setMobileUnits(id, p.army);
      } else {
        if (!occupiedProvinces[id]) {
          events.push({ type: 'occupation', message: `${warCountryName(p.ownerId)}, ${regionName(id)} bölgesini işgal etti!` });
        }
        occupiedProvinces[id] = p.ownerId;
        occupiedGarrisons[id] = armyPowerOf(p.army);
        setMobileUnits(id, emptyArmy());
      }
    } else {
      const cid = regionCid;
      if (!cid) continue;
      if (p.ownerId === PLAYER_ID) {
        if (!capturedEnemyProvinces.includes(id)) {
          capturedEnemyProvinces.push(id);
          events.push({ type: 'conquest', message: `${p.name} ele geçirildi!` });
        }
        delete enemyProvinceStrength[id];
        setMobileUnits(id, p.army);
      } else {
        if (capturedEnemyProvinces.includes(id)) {
          capturedEnemyProvinces = capturedEnemyProvinces.filter(x => x !== id);
          events.push({ type: 'battle', message: `${p.name} düşman eline geri geçti!` });
        }
        setMobileUnits(id, emptyArmy());
        enemyProvinceStrength[id] = armyPowerOf(p.army);
      }
    }
  }

  // 5) Muharebe raporları (modal için BattleReport biçimine çevrilir)
  for (const b of result.battles) {
    const playerIsAttacker = b.attackerId === PLAYER_ID;
    const atkLossPower = armyPowerOf(b.attackerLosses);
    const defLossPower = armyPowerOf(b.defenderLosses);
    const name = provinceDisplayName(b.provinceId);
    // Zayiat, gösterilen "savaş öncesi" güçle sınırlanır ve "sonrası" farktan türetilir:
    // öncesi savunma metriğinde (kilitli birlik %25, uçak 0 puan), zayiat ise taarruz
    // metriğinde (armyPowerOf: uçak 4000) ölçüldüğünden zayiat tabanı aşıp raporda
    // %100 üstü yüzde ve "3.1K → 0 ama zayiat 5.5K" gibi çelişkiler üretebiliyordu.
    const playerBefore = playerIsAttacker ? b.attackPower : b.defensePower;
    const enemyBefore = playerIsAttacker ? b.defensePower : b.attackPower;
    const playerLoss = Math.min(playerBefore, playerIsAttacker ? atkLossPower : defLossPower);
    const enemyLoss = Math.min(enemyBefore, playerIsAttacker ? defLossPower : atkLossPower);
    reports.push({
      countryName: name,
      countryId: b.provinceId,
      turn: working.turn,
      playerArmyBefore: playerBefore,
      playerArmyAfter: playerBefore - playerLoss,
      playerLoss,
      enemyArmyBefore: enemyBefore,
      enemyArmyAfter: enemyBefore - enemyLoss,
      enemyLoss,
      planesLost: playerIsAttacker ? b.attackerLosses.ucak : b.defenderLosses.ucak,
      result: b.outcome === 'meeting'
        ? 'meeting'
        : b.outcome === 'decisive'
          ? (playerIsAttacker ? 'conquest' : 'occupation')
          : b.outcome === 'repelled'
            ? (playerIsAttacker ? 'attack_failed' : 'repelled')
            : 'attrition',
      initiator: playerIsAttacker ? 'player' : 'ai',
    });
  }

  // 6) Savaş durumlarını güncelle: güç barları, fetih kontrolü
  let conqueredCountryIds = working.conqueredCountryIds;
  let conqueredEconomies = working.conqueredEconomies;
  let conqueredNames = working.conqueredNames;
  let aiEconomy = working.aiEconomy;
  const remainingWars: War[] = [];

  for (const war of working.wars) {
    if (war.warType !== 'harita') { remainingWars.push(war); continue; }

    const regs = countryRegions(war.countryId);
    const allCaptured = regs.length > 0 && regs.every(id => capturedEnemyProvinces.includes(id));

    if (allCaptured) {
      // FETİH: tüm bölgeler bizde — ülke topraklara katılır (conqueredCountryIds),
      // bölgeler ordularıyla olduğu yerde OYUNCUNUN olur; ekonomisi devralınır.
      conqueredCountryIds = [...conqueredCountryIds, war.countryId];
      const economy = getAiEconomy(working, war.countryId);
      conqueredEconomies = { ...conqueredEconomies, [war.countryId]: economy };
      conqueredNames = { ...conqueredNames, [war.countryId]: war.countryName };
      aiEconomy = { ...aiEconomy };
      delete (aiEconomy as Record<string, unknown>)[war.countryId];
      delete working.aiMilitary[war.countryId];
      const loot = Math.round(economy.income * 5);
      // money'e EKLE (working.money'den başlatma): aynı turda ikinci fetih
      // ilkinin ganimetini ezmesin, zorunlu barış bedeli de korunmuş kalsın
      money += loot;

      // Bölgeler artık conqueredCountryIds ile sahiplenildi: düşman/ele-geçirilen
      // işaretlerini temizle, birlikleri yerinde bırak.
      for (const rid of regs) {
        capturedEnemyProvinces = capturedEnemyProvinces.filter(x => x !== rid);
        delete enemyProvinceStrength[rid];
      }
      for (const [provId, occ] of Object.entries(occupiedProvinces)) {
        if (occ === war.countryId) { delete occupiedProvinces[provId]; delete occupiedGarrisons[provId]; }
      }
      events.push({
        type: 'conquest',
        message: `${war.countryName} fethedildi! Ganimet: +${formatMoney(loot)} · Devralınan gelir: +${formatMoney(economy.income)}/tur`,
      });
      continue;
    }

    // Devam eden savaş: güç barı ve son zayiat bilgisi güncellenir
    const remaining = countryRemainingStrength(
      { ...working, aiMilitary: working.aiMilitary, enemyProvinceStrength },
      war.countryId
    );
    const turnBattles = result.battles.filter(b => {
      const cid = countryOfProvince(b.provinceId);
      return cid === war.countryId || b.attackerId === war.countryId || b.defenderId === war.countryId;
    });
    let playerLoss = 0, enemyLoss = 0;
    for (const b of turnBattles) {
      if (b.attackerId === PLAYER_ID) {
        playerLoss += armyPowerOf(b.attackerLosses);
        enemyLoss += armyPowerOf(b.defenderLosses);
      } else {
        playerLoss += armyPowerOf(b.defenderLosses);
        enemyLoss += armyPowerOf(b.attackerLosses);
      }
    }
    remainingWars.push({
      ...war,
      enemyStrength: remaining,
      enemyMaxStrength: Math.max(war.enemyMaxStrength, remaining),
      lastPlayerLoss: playerLoss,
      lastEnemyLoss: enemyLoss,
    });
  }

  return {
    save: {
      ...working,
      money,
      provinceUnits,
      occupiedProvinces,
      occupiedGarrisons,
      enemyProvinceStrength,
      capturedEnemyProvinces,
      conqueredCountryIds,
      conqueredEconomies,
      conqueredNames,
      aiEconomy,
      wars: remainingWars,
      pendingOrders: [], // emirler tüketildi
    },
    events,
    reports,
  };
}
