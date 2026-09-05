import { GameSave, War } from './types';
import { getCountryStats } from './countries';
import { provinceRansom } from './economy';
import { initWarGarrisons, releaseCountryProvinces } from './mapWar';
import { regionCountry } from './activeWorld';
import { applyWarDeclarationDiplomacy, applyPeaceDiplomacy, pactActive } from './diplomacy';

// --- Birim güç tabloları (bkz. docs/savas-matematigi.md) ---
// Muharebe çözümü frontline/resolveTurn'dedir; buradaki tablolar HUD/panel
// göstergeleri (toplam saldırı/savunma gücü) için tek kaynaktır.
export const LAND_ATTACK: Record<string, number> = { asker: 1, tank: 150 };
export const LAND_DEFENSE: Record<string, number> = { asker: 1.5, tank: 80, kara_savunma: 900 };
export const BOMBARDMENT_POWER = 4_000; // uçak başına bombardıman gücü
export const AA_UNIT_POWER = 2_500;     // hava savunma bataryası başına AA gücü

export const TRUCE_DURATION = 40; // barış anlaşması süresi (tur)

function countUnits(provinceUnits: GameSave['provinceUnits'], type: string): number {
  let total = 0;
  for (const units of Object.values(provinceUnits)) total += units[type] || 0;
  return total;
}

// Tam etki varsayımıyla saldırı gücü (HUD göstergesi; gerçek muharebede uçaklar airEff ile kırpılır)
export function computeAttackPower(pu: GameSave['provinceUnits'], hMult: number = 1): number {
  return (countUnits(pu, 'asker') * LAND_ATTACK.asker
    + countUnits(pu, 'tank') * LAND_ATTACK.tank
    + countUnits(pu, 'ucak') * BOMBARDMENT_POWER) * hMult;
}

export function computeDefensePower(pu: GameSave['provinceUnits'], hMult: number = 1): number {
  return (countUnits(pu, 'asker') * LAND_DEFENSE.asker
    + countUnits(pu, 'tank') * LAND_DEFENSE.tank
    + countUnits(pu, 'kara_savunma') * LAND_DEFENSE.kara_savunma) * hMult;
}

export function computeAAPower(pu: GameSave['provinceUnits']): number {
  return countUnits(pu, 'hava_savunma') * AA_UNIT_POWER;
}

// HUD: oyuncunun toplam saldırı gücü. (Havuz-savaş "cephe ordusu" söküldü —
// tüm birlikler illerde durur, savaş taarruz emirleriyle yürür.)
export function computeTotalAttackPower(save: GameSave, hMult: number = 1): number {
  return computeAttackPower(save.provinceUnits, hMult);
}

export function startWar(
  save: GameSave,
  countryId: string,
  countryName: string
): GameSave {
  if (!countryId) return save;
  // Fethedilmiş ülkeye savaş ilan edilemez: taban ordusu "hayalet" olarak dirilip
  // kendi bölgelerimize düşman garnizonu yazıyor, ülke aynı anda hem fethedilmiş
  // hem savaşta kalıyordu (2026-07-14 oyuncu testi — bayat panel butonuyla tetiklendi).
  if (save.conqueredCountryIds.includes(countryId)) return save;
  if (save.wars.some(w => w.countryId === countryId)) return save;
  if ((save.truces[countryId] || 0) > save.turn) return save;
  if (pactActive(save, countryId)) return save; // saldırmazlık paktı İKİ tarafı da bağlar

  // Diplomasi: hedefle ilişki dibe vurur, anlaşmalar bozulur, komşular ürker.
  // (İttifaka saldırı ihanettir: ittifak burada düşer, sonra savaş açılır.)
  save = applyWarDeclarationDiplomacy(save, countryId);

  const strength = save.aiMilitary[countryId] ?? getCountryStats(countryId, save.difficulty).military;

  // Tüm savaşlar HARİTA (kara-graf): düşman ordusu bölge garnizonlarına bölünür,
  // muharebeler taarruz emirleriyle çözülür. Denizaşırı hedeflere de aynı model
  // işler — çıkarma (gemi) ve hava akınları emir olarak verilir.
  const war: War = {
    countryId,
    countryName,
    enemyStrength: strength,
    enemyMaxStrength: strength,
    startedTurn: save.turn,
    lastPlayerLoss: 0,
    lastEnemyLoss: 0,
    initiator: 'player',
    warType: 'harita',
  };
  return initWarGarrisons({ ...save, wars: [...save.wars, war] }, countryId);
}

// --- Barış antlaşması ---
// Bedel mantığı: düşman ne kadar güçlü kaldıysa barış o kadar pahalı;
// dize getirdiysen (kalan güç < %40) o SANA öder.
// İşgal ettiği her il masada FİDYEYLE geri alınır: fidye = ilin tam kapasite
// tur geliri × 30 (gelişmiş il çok daha pahalı).
// Pozitif = oyuncu öder, negatif = oyuncuya ödenir.
export function occupiedRansomTotal(save: GameSave, countryId: string): number {
  let total = 0;
  for (const [provId, occupier] of Object.entries(save.occupiedProvinces)) {
    if (occupier === countryId) total += provinceRansom(save, provId);
  }
  return total;
}

export function peaceTerms(save: GameSave, war: War): number {
  const f = war.enemyMaxStrength > 0 ? war.enemyStrength / war.enemyMaxStrength : 0;
  const base = getCountryStats(war.countryId, save.difficulty).income;
  return Math.round(base * 10 * (f - 0.4)) + occupiedRansomTotal(save, war.countryId);
}

// Barışı imzalar: bedel ödenir/alınır, ateşkes başlar. Ele geçirilen eyaletler
// iade edilir, garnizonlar anavatana döner, eyaletlerdeki birliklerimiz yurda
// çekilir; bu ülkeyle ilgili bekleyen emirler düşer. Bedelin içinde işgal edilen
// illerin FİDYESİ vardır — masada iller GERİ VERİLİR. (Zorunlu barışta fidye
// ödenmez, iller işgalcide kalır.) Bedel karşılanamıyorsa null döner.
export function signPeace(save: GameSave, countryId: string): GameSave | null {
  const war = save.wars.find(w => w.countryId === countryId);
  if (!war) return null;
  const cost = peaceTerms(save, war);
  if (cost > save.money) return null;

  save = releaseCountryProvinces(save, countryId);
  save = {
    ...save,
    // Bu ülkeyle ilgili emirler düşer: hedef onun bölgesiyse YA DA onun işgal
    // ettiği bir bölgemizse (kurtarma emri). Generic bölge id'si {cid}-r{i}.
    pendingOrders: (save.pendingOrders ?? []).filter(o => {
      const cid = save.occupiedProvinces[o.to] ?? regionCountry(o.to);
      return cid !== countryId;
    }),
  };

  // Fidyesi ödenen iller kurtulur
  const occupiedProvinces = { ...save.occupiedProvinces };
  const occupiedGarrisons = { ...(save.occupiedGarrisons || {}) };
  for (const [provId, occupier] of Object.entries(save.occupiedProvinces)) {
    if (occupier === countryId) {
      delete occupiedProvinces[provId];
      delete occupiedGarrisons[provId];
    }
  }

  // Barış ilişkiyi biraz onarır (yara kalır ama tırmanma sıfırlanır)
  return applyPeaceDiplomacy({
    ...save,
    money: save.money - cost,
    occupiedProvinces,
    occupiedGarrisons,
    wars: save.wars.filter(w => w.countryId !== countryId),
    truces: { ...save.truces, [countryId]: save.turn + TRUCE_DURATION },
  }, countryId);
}
