import { GameSave, AiCountryEconomy, Difficulty } from './types';
import { getCountryStats } from './countries';
import { countryPopulation } from './countryData';
import { countryRegions } from './activeWorld';

// --- AI ülke ekonomisi yardımcıları ---
// (economy.ts'te durur: hem ai.ts hem combat.ts kullanır, döngüsel import oluşmaz)

// AI ülke başlangıç ekonomi değerleri
export function defaultAiEconomy(countryId: string, difficulty: Difficulty): AiCountryEconomy {
  const stats = getCountryStats(countryId, difficulty);
  return {
    population: Math.round(stats.military * 2.5), // askeri gücün ~2.5 katı nüfus tahmini
    investment: stats.income * 5,                 // başlangıç yatırım birikimi
    income: stats.income,
  };
}

// Bir AI ülkesinin GÜNCEL (büyümüş) ekonomisi
export function getAiEconomy(save: GameSave, countryId: string): AiCountryEconomy {
  return save.aiEconomy?.[countryId] ?? defaultAiEconomy(countryId, save.difficulty);
}

// Ticaret anlaşması: ortağın tur gelirinin bu payı her tur oyuncuya akar.
// (Sabit burada durur: computeIncome kullanır; diplomacy.ts buradan import eder —
// tersi yönde import döngü yaratırdı.)
// %5 → %3 (2026-07-15 denge): %5'te amorti 20 turdu — "herkesle hemen imzala"
// dominant stratejiydi. ~33 tur amortiyle ticaret hâlâ kârlı ama artık bir tercih.
export const TRADE_INCOME_SHARE = 0.03;

// Birim maliyetleri ($)
export const UNIT_COSTS: Record<string, number> = {
  asker: 50_000,
  tank: 5_000_000,
  ucak: 100_000_000,
  liman: 500_000_000,
  gemi: 200_000_000, // çıkarma gemisi — yalnız LİMANLI kıyı ilinde üretilir
  hava_savunma: 50_000_000,
  kara_savunma: 20_000_000,
};

// Tur başına bakım gideri ($): mobil birimler maliyetin %0.5'i,
// yapılar %0.2'si. Ordu beslemek artık ekonomik bir karardır.
export const UNIT_UPKEEP: Record<string, number> = {
  asker: 250,
  tank: 25_000,
  ucak: 500_000,
  liman: 1_000_000,
  gemi: 400_000,
  hava_savunma: 100_000,
  kara_savunma: 40_000,
};

export interface UpkeepBreakdown {
  home: number;   // birliklerin bakımı (tüm ordu illerde konuşludur)
  hunger: number; // iaşe açığından doğan EK asker bakımı (aç ordu pahalıya oturur)
  total: number;
}

export function computeUpkeep(save: GameSave): UpkeepBreakdown {
  let home = 0;
  for (const units of Object.values(save.provinceUnits)) {
    for (const [type, count] of Object.entries(units)) {
      home += (UNIT_UPKEEP[type] || 0) * count;
    }
  }
  // İaşe açığı: askerler tarımla beslenemiyorsa bakımları tam açlıkta 1.5 kata çıkar.
  // (Yalnız asker — araçlar yemek yemez.)
  const shortage = 1 - armyFoodRatio(save);
  let hunger = 0;
  if (shortage > 0) {
    let homeAsker = 0;
    for (const units of Object.values(save.provinceUnits)) homeAsker += units.asker || 0;
    hunger = Math.round(homeAsker * UNIT_UPKEEP.asker * HUNGER_UPKEEP_EXTRA * shortage);
  }
  return { home, hunger, total: home + hunger };
}

// Savaş yorgunluğu: her aktif savaş mutluluğu tur başına aşındırır
// (saldırı savaşı savunma savaşından ağırdır; toplam tavanlıdır).
// Denge noktası: hedef mutluluk − 10 × yorgunluk (drift %10 olduğundan).
export function warWeariness(wars: { initiator: 'player' | 'ai' }[]): number {
  return Math.min(3, wars.reduce((a, w) => a + (w.initiator === 'player' ? 0.8 : 0.4), 0));
}

// --- Terhis (ordu küçültme) ---
// Bakım sisteminin doğal tamamlayıcısı: barışta orduyu besleme yükünden kurtul.
// Askerler İL NÜFUSUNA GERİ DÖNER (insan kaybolmaz, vergi tabanına katılır);
// araç ve yapılar hurdaya ayrılır, maliyetin %25'i hazineye döner.
export const SALVAGE_RATE = 0.25;

export function disbandUnits(
  save: GameSave,
  provId: string,
  amounts: Record<string, number>
): GameSave {
  const units = save.provinceUnits[provId];
  if (!units) return save;

  const nextUnits = { ...units };
  let salvage = 0;
  let returnedPeople = 0;
  for (const [type, count] of Object.entries(amounts)) {
    const n = Math.min(count || 0, nextUnits[type] || 0);
    if (n <= 0) continue;
    nextUnits[type] -= n;
    if (nextUnits[type] <= 0) delete nextUnits[type];
    if (type === 'asker') returnedPeople += n;
    else salvage += (UNIT_COSTS[type] || 0) * n * SALVAGE_RATE;
  }
  if (returnedPeople === 0 && salvage === 0) return save;

  const provinceUnits = { ...save.provinceUnits };
  if (Object.keys(nextUnits).length > 0) provinceUnits[provId] = nextUnits;
  else delete provinceUnits[provId];

  let provinceInvestments = save.provinceInvestments;
  if (returnedPeople > 0) {
    const inv = { ...(save.provinceInvestments[provId] || {}) };
    inv.nufus = (inv.nufus || 0) + returnedPeople;
    provinceInvestments = { ...save.provinceInvestments, [provId]: inv };
  }

  return { ...save, money: save.money + Math.round(salvage), provinceUnits, provinceInvestments };
}

export const UNIT_LABELS: Record<string, string> = {
  asker: 'Asker',
  tank: 'Tank',
  ucak: 'Uçak',
  liman: 'Liman',
  gemi: 'Gemi',
  hava_savunma: 'Hava Savunma',
  kara_savunma: 'Kara Savunma',
};

// Yatırım getirileri (yatırılan $ başına tur başı $).
// Getiriler bilinçli olarak YAKIN: sanayi salt gelirde önde, tarımın ek işlevleri
// var (nüfus büyümesi + ordu iaşesi) — seçim "şu an neye ihtiyacım var" olsun.
export const INVESTMENT_RATES = {
  tarim: 0.01,   // %1 / tur
  sanayi: 0.015, // %1.5 / tur
};

// --- Yatırım doygunluğu (azalan getiri) ---
// Bir bölgenin tarım/sanayi kapasitesi sınırsız değildir: yatırım büyüdükçe marjinal
// getiri hiperbolik düşer. Efektif yatırım SOFT_CAP'te yarıya iner ve bölge başına
// rate×CAP getiriye asimptotik yaklaşır (sanayi: en çok $300M/tur/bölge).
// Erken oyunda (≤$2B/bölge) etkisi ihmal edilir; geç oyunda "tek bölgeye sonsuz para
// göm" sömürüsünü kapatır — gelir büyümesinin yolu YENİ bölgeler (fetih) olur.
export const INVESTMENT_SOFT_CAP = 20_000_000_000; // $/bölge (yarı verim noktası)
export function effectiveInvestment(amount: number): number {
  if (amount <= 0) return 0;
  return amount * INVESTMENT_SOFT_CAP / (INVESTMENT_SOFT_CAP + amount);
}

// --- Ordu İaşesi (tarımın gelir dışı işlevi) ---
// Sivil nüfus kendi kendine yeter; ORDU tarım ister: her asker ~3 kişilik gıda
// tüketir. Tarım talebi karşılamazsa asker bakımı tam açlıkta 1.5 katına çıkar
// ve mutluluk hafif aşınır — büyük işgal ordusu beslemek gerçek tarım yatırımı ister.
export const SOLDIER_FOOD_EQUIV = 3;      // asker başına kişi eşdeğeri gıda
export const HUNGER_UPKEEP_EXTRA = 0.5;   // tam açlıkta asker bakımına eklenen pay

export function totalAskerCount(save: GameSave): number {
  let n = 0;
  for (const units of Object.values(save.provinceUnits)) n += units.asker || 0;
  return n;
}

// Ordunun gıda arzı: işgal altında olmayan illerin efektif tarım toplamı
export function armyFoodSupply(save: GameSave): number {
  let farm = 0;
  for (const [provId, inv] of Object.entries(save.provinceInvestments)) {
    if (save.occupiedProvinces[provId]) continue;
    farm += effectiveInvestment(inv.tarim || 0);
  }
  return farm;
}

// Küçük profesyonel çekirdek ordu devletin mevcut gıda ekonomisinden beslenir:
// bu sayıya kadar asker tarım yatırımı istemez. (Yeni oyun 0 tarımla başlar —
// muafiyet yokken İLK 1000 asker bile iaşeyi %0'a düşürüp açlık cezası yiyordu;
// "ülke ordusuz ama tek eri bile besleyemiyor" mantıksızdı.)
export const FREE_ARMY_RATION = 25_000;

// Belirli asker sayısının gıda talebi ($ tarım cinsinden) — muafiyet üstü kısım
export function armyFoodDemand(askerCount: number): number {
  return Math.max(0, askerCount - FREE_ARMY_RATION) * SOLDIER_FOOD_EQUIV * FARM_FULL_FEED_PER_CAPITA;
}

// 1.0 = ordu tam besleniyor; 0'a düştükçe açlık büyür
export function armyFoodRatio(save: GameSave): number {
  const demand = armyFoodDemand(totalAskerCount(save));
  if (demand <= 0) return 1;
  return Math.min(1, armyFoodSupply(save) / demand);
}

export const POP_TAX_PER_CAPITA = 5;    // kişi başı TAM vergi kapasitesi $/tur (taxRate ile çarpılır)
// %20 vergiyle kişi başı 1$/tur → başlangıç geliri ~85M (fiyat dengesiyle uyumlu)
export const POP_GROWTH_RATE = 0.001;   // %0.1 / tur doğal artış
// $500 → $200 (2026-07-15 denge): $500'de vergi amortisi 500 turdu — hiç mantıklı
// değildi. $200'de ~200 tur: hâlâ salt gelir için kötü ama asıl işlevi olan
// "acil asker havuzu büyütme" makul fiyatlanır.
export const POP_COST_PER_PERSON = 200; // nüfus teşviki: 200$ = 1 kişi (insan = vergi + asker kaynağı)

// --- Tarım → nüfus büyümesi ---
// Tarım artık yalnız gelir değil, GIDA'dır: kişi başı tarım yatırımı arttıkça
// il nüfusu daha hızlı büyür. Tam beslenme (kişi başı $100 tarım) doğal artışı
// 4 katına çıkarır. Sanayi salt gelir, tarım insan+gelir — gerçek bir tercih doğar.
export const FARM_POP_BONUS_MAX = 0.003;      // tam beslenmede ek büyüme: +%0.3/tur
export const FARM_FULL_FEED_PER_CAPITA = 100; // kişi başı $100 tarım = tam bonus

export function popGrowthRate(inv: Record<string, number>): number {
  const pop = inv.nufus || 0;
  if (pop <= 0) return POP_GROWTH_RATE;
  const feedPerCapita = (inv.tarim || 0) / pop;
  return POP_GROWTH_RATE + FARM_POP_BONUS_MAX * Math.min(1, feedPerCapita / FARM_FULL_FEED_PER_CAPITA);
}

// HUD göstergesi: bu turki gerçek toplam nüfus artışı (tarım bonusu dahil)
export function totalPopulationGrowth(save: GameSave): number {
  let growth = 0;
  for (const [provId, inv] of Object.entries(save.provinceInvestments)) {
    if (save.occupiedProvinces[provId]) continue;
    growth += Math.floor((inv.nufus || 0) * popGrowthRate(inv));
  }
  return growth;
}

// --- Vergi & Mutluluk Sistemi ---
// Mutluluk yol bağımlı değil, DURUM bazlıdır: vergiyle ters orantılı bir hedefe
// her tur %10 yaklaşır. Böylece "vergiyi sıfırla, 100'e çık, geri yükselt" sömürüsü imkansız:
// vergiyi yükselttiğin an hedef düşer ve mutluluk oraya kayar.
export function happinessTarget(taxRate: number): number {
  return 100 - taxRate * 100; // %0 vergi → 100, %20 → 80, %50 → 50, %100 → 0
}

export function nextHappiness(current: number, taxRate: number): number {
  const target = happinessTarget(taxRate);
  return clampHappiness(current + (target - current) * 0.10);
}

export function clampHappiness(h: number): number {
  return Math.max(0, Math.min(100, h));
}

// Mutluluk → ordu güç çarpanı
// 0'da 0.6, 50'de 0.95, 70'te ~1.09, 100'de 1.3
export function happinessMultiplier(happiness: number): number {
  return 0.6 + (happiness / 100) * 0.7;
}

// Mutluluk emojisi
export function happinessEmoji(happiness: number): string {
  if (happiness >= 80) return '😊';
  if (happiness >= 60) return '🙂';
  if (happiness >= 40) return '😐';
  if (happiness >= 20) return '😟';
  return '😡';
}

export function totalPopulation(save: GameSave): number {
  return Object.values(save.provinceInvestments).reduce(
    (sum, inv) => sum + (inv.nufus || 0), 0);
}

// Fethedilen toprağa kalkınma yatırımı: %1.5/tur getiri.
// Yurttaki sanayiden (%2) biraz düşük — işgal edilmiş toprağı yönetmek zordur —
// ama devralınan ekonomiyi BÜYÜTMENİN tek yolu budur. Fetihle gelen yatırım
// birikimi de aynı oranda gelir üretir (onların fabrikaları artık senin).
export const CONQUERED_DEV_RATE = 0.015;

// Fethedilen halk da vergi öder: gerçek ülke nüfusu × kişi başı vergi × oyuncunun
// vergi oranı × yönetim verimi. İşgal yönetimi verimsizdir (%50) ama fetih böylece
// GERÇEK bir büyüme yolu olur: Ermenistan (~3M) +1-2M/tur verirken İran (~89M)
// hazineyi dönüştürür. Yumuşak yatırım tavanının işaret ettiği "büyümek için
// yeni toprak" tasarımının gelir ayağı budur.
export const CONQUERED_TAX_EFFICIENCY = 0.5;

export function conqueredTaxIncome(save: GameSave, countryId: string): number {
  return countryPopulation(countryId) * POP_TAX_PER_CAPITA
    * (save.taxRate ?? 0.20) * CONQUERED_TAX_EFFICIENCY;
}

// Fethedilen bir ülkenin tur başına gelir katkısı: devralınan (büyümüş) gelir
// + halkın vergisi + yatırım birikiminin getirisi. Eski kayıtlar taban gelire düşer.
export function conqueredCountryIncome(save: GameSave, countryId: string): number {
  const tax = conqueredTaxIncome(save, countryId);
  const eco = save.conqueredEconomies?.[countryId];
  if (!eco) return Math.round(getCountryStats(countryId, save.difficulty).income + tax);
  return Math.round(eco.income + tax + effectiveInvestment(eco.investment || 0) * CONQUERED_DEV_RATE);
}

// Fethedilen ülkeye kalkınma yatırımı yapar; para yetmiyorsa null döner.
export function investInConquered(save: GameSave, countryId: string, amount: number): GameSave | null {
  if (amount <= 0 || amount > save.money) return null;
  if (!save.conqueredCountryIds.includes(countryId)) return null;
  const eco = save.conqueredEconomies?.[countryId] ?? defaultAiEconomy(countryId, save.difficulty);
  return {
    ...save,
    money: save.money - amount,
    conqueredEconomies: {
      ...save.conqueredEconomies,
      [countryId]: { ...eco, investment: (eco.investment || 0) + amount },
    },
  };
}

// Bir bölgenin (il/eyalet) YEREL tur geliri: vergi + tarım + sanayi.
// TEK DOĞRU KAYNAK: computeIncome da, bölge/ülke detay panelleri de bu
// fonksiyondan okur — küresel ve yerel gösterge asla birbirinden sapamaz.
// İşgal altındaki bölgenin katkısı kesiktir (0 döner).
export function provinceLocalIncome(save: GameSave, provId: string): number {
  const inv = save.provinceInvestments[provId];
  if (!inv || save.occupiedProvinces[provId]) return 0;
  return (inv.nufus || 0) * POP_TAX_PER_CAPITA * (save.taxRate ?? 0.20)
    + effectiveInvestment(inv.tarim || 0) * INVESTMENT_RATES.tarim
    + effectiveInvestment(inv.sanayi || 0) * INVESTMENT_RATES.sanayi;
}

// Fethedilen ülkenin bölgelerine (eyaletlerine) yapılan YEREL yatırımların
// tur geliri. computeIncome bunu provinceInvestments döngüsünde zaten sayar;
// bu fonksiyon aynı rakamı ÜLKE DETAYINDA göstermek içindir.
export function conqueredRegionalIncome(save: GameSave, countryId: string): number {
  let total = 0;
  for (const rid of countryRegions(countryId)) {
    total += provinceLocalIncome(save, rid);
  }
  return Math.round(total);
}

// Fethedilen ülkenin GERÇEK toplam katkısı: devralınan ekonomi + halk vergisi
// + kalkınma birikimi + eyaletlerine yapılan yerel yatırımların geliri.
// (2026-07-15 düzeltmesi: eyalet yatırımı küresel gelire akıyordu ama ülke
// detayı conqueredCountryIncome'u gösterdiğinden yerelde "eski statik değer"
// kalıyordu — yerel katkı burada birleştirilerek UI tek kaynağa bağlandı.)
export function conqueredCountryTotalIncome(save: GameSave, countryId: string): number {
  return conqueredCountryIncome(save, countryId) + conqueredRegionalIncome(save, countryId);
}

// Tur başına toplam gelir: vergi + tarım + sanayi + fethedilen ülkeler.
// İşgal altındaki illerin katkısı kesilir. Bölge başına hesap
// provinceLocalIncome'dadır — panellerle aynı kaynak.
export function computeIncome(save: GameSave): number {
  let income = 0;
  for (const provId of Object.keys(save.provinceInvestments)) {
    income += provinceLocalIncome(save, provId);
  }
  for (const id of save.conqueredCountryIds) {
    income += conqueredCountryIncome(save, id);
  }
  // Ticaret anlaşmaları: ortağın canlı gelirinden pay (ülke fethedilirse zaten
  // conqueredCountryIncome'a döner; savaş ilanında anlaşma bozulur)
  for (const id of save.tradeDeals ?? []) {
    if (save.conqueredCountryIds.includes(id)) continue;
    income += getAiEconomy(save, id).income * TRADE_INCOME_SHARE;
  }
  return income;
}

// İşgal edilen ilin barış fidyesi: ilin TAM kapasite tur geliri × 30.
// Gelişmiş il (yüksek nüfus, tarım/sanayi yatırımı) çok daha pahalıya geri alınır.
export function provinceRansom(save: GameSave, provId: string): number {
  const inv = save.provinceInvestments[provId] || {};
  const fullIncome = (inv.nufus || 0) * POP_TAX_PER_CAPITA
    + effectiveInvestment(inv.tarim || 0) * INVESTMENT_RATES.tarim
    + effectiveInvestment(inv.sanayi || 0) * INVESTMENT_RATES.sanayi;
  return Math.round(fullIncome * 30);
}

export function formatMoney(val: number): string {
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1_000_000_000) return sign + '$' + (abs / 1_000_000_000).toFixed(1).replace('.0', '') + 'B';
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (abs >= 1_000) return sign + '$' + (abs / 1_000).toFixed(1).replace('.0', '') + 'K';
  return sign + '$' + Math.floor(abs).toString();
}

export function formatCount(c: number): string {
  if (c >= 1_000_000) return (c / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (c >= 1_000) return (c / 1_000).toFixed(1).replace('.0', '') + 'K';
  return Math.floor(c).toString();
}
