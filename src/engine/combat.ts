import { GameSave, War, TurnEvent, BattleReport, FrontForce } from './types';
import { getCountryStats } from './countries';
import { formatMoney, formatCount, happinessMultiplier, provinceRansom, getAiEconomy } from './economy';
import { BORDER_PROVINCES, PROVINCE_NAMES, NEIGHBOR_PROVINCES } from './geography';
import { initWarGarrisons, releaseCountryProvinces, isLandNeighbor } from './mapWar';
import { regionCountry } from './activeWorld';
import { applyWarDeclarationDiplomacy, applyPeaceDiplomacy, pactActive } from './diplomacy';

// --- Birim güç tabloları (bkz. docs/savas-matematigi.md) ---
export const LAND_ATTACK: Record<string, number> = { asker: 1, tank: 150 };
export const LAND_DEFENSE: Record<string, number> = { asker: 1.5, tank: 80, kara_savunma: 900 };
export const AIR_COMBAT_POWER = 2_500;  // uçak başına hava muharebe gücü
export const BOMBARDMENT_POWER = 4_000; // uçak başına bombardıman gücü
export const AA_UNIT_POWER = 2_500;     // hava savunma bataryası başına AA gücü

// AI ordusunun tek skoru bu paylarla yorumlanır
const AI_AIR_SHARE = 0.20;
const AI_AA_SHARE = 0.15;
const AI_FORT_SHARE = 0.10; // tahkimat payı: tank saldırısını keser (koz sistemi)

// Tur başına oranlar
const PLAYER_DAMAGE_RATE = 0.12; // saldıran, gücünün %12'si kadar direnci eritir
const ENEMY_DAMAGE_RATE = 0.06;  // düşman, kalan gücünün %6'sı kadar zayiat verdirir
const AIR_LOSS_RATE = 0.15;      // hava fazında uçak kayıp hızı
const STRUCTURE_WEAR = 0.25;     // savunma yapıları kayıp oranının çeyreğiyle yıpranır
const CONQUEST_INFANTRY_RATIO = 0.2; // fetih için gereken asker: hedef taban gücünün %20'si
const PILLAGE_RATE = 0.02;       // işgal edilecek il kalmayınca hazineden yağma/tur
const GARRISON_SHARE = 0.25;     // işgalde istila kuvvetinin bu payı ilde garnizon kalır (AYRILIR, kopyalanmaz)
const MAX_WAR_DURATION = 60;     // bu turdan sonra savaş zorunlu barışla kapanır
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

// --- Cephe ordusu yardımcıları ---
export const EMPTY_FRONT: FrontForce = { asker: 0, tank: 0, ucak: 0 };

export function frontOf(war: War): FrontForce {
  return war.front ?? EMPTY_FRONT;
}

export function frontHasUnits(front: FrontForce | undefined): boolean {
  return !!front && (front.asker > 0 || front.tank > 0 || front.ucak > 0);
}

export function frontLandAttack(front: FrontForce, hMult: number = 1): number {
  return (front.asker * LAND_ATTACK.asker + front.tank * LAND_ATTACK.tank) * hMult;
}

// Tam etki varsayımıyla cephe saldırı gücü (gösterge)
export function frontAttackPower(front: FrontForce, hMult: number = 1): number {
  return frontLandAttack(front, hMult) + front.ucak * BOMBARDMENT_POWER * hMult;
}

// HUD: yurttaki birlikler + tüm cephelerdeki ordular
export function computeTotalAttackPower(save: GameSave, hMult: number = 1): number {
  let total = computeAttackPower(save.provinceUnits, hMult);
  for (const war of save.wars) {
    if (war.front) total += frontAttackPower(war.front, hMult);
  }
  return total;
}

// Güç puanı cinsinden zayiatı cephedeki asker/tanka oransal dağıtır
function applyFrontCasualties(front: FrontForce, powerLoss: number): FrontForce {
  const landPower = front.asker * LAND_ATTACK.asker + front.tank * LAND_ATTACK.tank;
  if (powerLoss <= 0 || landPower <= 0) return front;
  const frac = Math.min(1, powerLoss / landPower);
  return {
    ...front,
    asker: Math.floor(front.asker * (1 - frac)),
    tank: Math.floor(front.tank * (1 - frac)),
  };
}

// Cephe ordusunun döneceği il: o cepheye bakan işgalsiz sınır ili, yoksa Ankara
function frontHomeProvinceId(countryId: string, occupied: Record<string, string>): string {
  const borders = BORDER_PROVINCES[countryId] ?? [];
  return borders.find(id => !occupied[id]) ?? borders[0] ?? 'tr-6';
}

function addFrontUnits(
  pu: GameSave['provinceUnits'],
  provId: string,
  front: FrontForce
): GameSave['provinceUnits'] {
  if (!frontHasUnits(front)) return pu;
  const units = { ...(pu[provId] || {}) };
  if (front.asker > 0) units.asker = (units.asker || 0) + front.asker;
  if (front.tank > 0) units.tank = (units.tank || 0) + front.tank;
  if (front.ucak > 0) units.ucak = (units.ucak || 0) + front.ucak;
  return { ...pu, [provId]: units };
}

// İllerden birlik alıp cepheye taşır — "orduyu savaşa gönderme" işleminin kendisi.
// Birlikler ilden düşülür; mevcut cephe ordusunun üzerine eklenir.
export function deployToFront(
  save: GameSave,
  countryId: string,
  deployment: Record<string, Partial<FrontForce>>
): GameSave {
  const warIdx = save.wars.findIndex(w => w.countryId === countryId);
  if (warIdx === -1) return save;
  const war = save.wars[warIdx];
  // AI'nin açtığı savaşta da cephe kurulabilir: KARŞI TAARRUZ (düşman anavatanını vurur)

  const pu = { ...save.provinceUnits };
  const front: FrontForce = { ...(war.front ?? EMPTY_FRONT) };

  // Deniz aşırı cephede sevkiyat liman kapasitesiyle sınırlıdır
  const overseas = isOverseas(countryId);
  let capacityLeft = overseas
    ? Math.max(0, expeditionCapacity(save.provinceUnits) - frontWeight(front))
    : Number.POSITIVE_INFINITY;

  for (const [provId, req] of Object.entries(deployment)) {
    const units = pu[provId];
    if (!units) continue;
    const next = { ...units };
    for (const key of ['asker', 'tank', 'ucak'] as const) {
      let take = Math.min(req[key] || 0, next[key] || 0);
      const weight = EXPEDITION_WEIGHT[key];
      // Ağırlığı 0 olan birimler (uçak) kapasiteden bağımsız uçar
      if (overseas && weight > 0) {
        take = Math.min(take, Math.floor(capacityLeft / weight));
      }
      if (take <= 0) continue;
      if (overseas && weight > 0) capacityLeft -= take * weight;
      next[key] -= take;
      if (next[key] <= 0) delete next[key];
      front[key] += take;
    }
    if (Object.keys(next).length > 0) pu[provId] = next;
    else delete pu[provId];
  }

  const wars = [...save.wars];
  wars[warIdx] = { ...war, front };
  return { ...save, provinceUnits: pu, wars };
}

// --- Deniz aşırı sefer (liman lojistiği) ---
// Kara sınırı olmayan ülkelere harekât liman gerektirir: her liman sınırlı
// bir sefer kuvveti taşıyabilir. Liman nihayet gerçek bir işleve kavuştu.
export const PORT_EXPEDITION_CAPACITY = 25_000; // liman başına taşıma kapasitesi (ağırlık puanı)
// Uçaklar gemiye binmez, UÇARAK gider — liman kapasitesi kullanmaz (ağırlık 0).
export const EXPEDITION_WEIGHT: Record<'asker' | 'tank' | 'ucak', number> = {
  asker: 1, tank: 25, ucak: 0,
};

export function isOverseas(countryId: string): boolean {
  return !NEIGHBOR_PROVINCES[countryId];
}

export function frontWeight(front: FrontForce): number {
  return front.asker * EXPEDITION_WEIGHT.asker
    + front.tank * EXPEDITION_WEIGHT.tank
    + front.ucak * EXPEDITION_WEIGHT.ucak;
}

export function expeditionCapacity(pu: GameSave['provinceUnits']): number {
  return countUnits(pu, 'liman') * PORT_EXPEDITION_CAPACITY;
}

// Cephedeki tüm orduyu geri çeker; birlikler sınır iline döner
export function withdrawFront(save: GameSave, countryId: string): GameSave {
  const warIdx = save.wars.findIndex(w => w.countryId === countryId);
  if (warIdx === -1) return save;
  const war = save.wars[warIdx];
  const front = war.front ?? EMPTY_FRONT;
  if (!frontHasUnits(front)) return save;

  const home = frontHomeProvinceId(countryId, save.occupiedProvinces);
  const pu = addFrontUnits(save.provinceUnits, home, front);
  const wars = [...save.wars];
  wars[warIdx] = { ...war, front: { ...EMPTY_FRONT } };
  return { ...save, provinceUnits: pu, wars };
}

export function findConnectingTurkishProvinces(
  save: GameSave,
  countryId: string,
  provinceId: string,
  warProvincesList?: { id: string; isConquered: boolean }[]
): string[] {
  const provs = NEIGHBOR_PROVINCES[countryId] || [];
  const visited = new Set<string>();
  const connectedTurkishProvs = new Set<string>();

  function dfs(currId: string) {
    if (visited.has(currId)) return;
    visited.add(currId);

    const info = provs.find(p => p.id === currId);
    if (!info) return;

    for (const neighbor of info.neighbors) {
      if (neighbor.startsWith('tr-')) {
        connectedTurkishProvs.add(neighbor);
      } else {
        // Eğer o ülkeye ait başka bir eyalet ise, fethedilip edilmediğine bakarız
        const isConquered = warProvincesList
          ? warProvincesList.find(p => p.id === neighbor)?.isConquered
          : false;

        if (isConquered) {
          dfs(neighbor);
        }
      }
    }
  }

  dfs(provinceId);
  return Array.from(connectedTurkishProvs);
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

  // Generic dünyada tüm savaşlar HARİTA (kara-graf): düşman ordusu bölge
  // garnizonlarına bölünür, muharebeler taarruz emirleriyle çözülür.
  const isMapWar = true;

  const war: War = {
    countryId,
    countryName,
    enemyStrength: strength,
    enemyMaxStrength: strength,
    startedTurn: save.turn,
    lastPlayerLoss: 0,
    lastEnemyLoss: 0,
    initiator: 'player',
    warType: isMapWar ? 'harita' : 'topyekun',
    front: { ...EMPTY_FRONT },
  };
  const next = { ...save, wars: [...save.wars, war] };
  return isMapWar ? initWarGarrisons(next, countryId) : next;
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

// Barışı imzalar: bedel ödenir/alınır, ateşkes başlar, cephe ordusu yurda döner.
// Bedelin içinde işgal edilen illerin FİDYESİ vardır — masada iller GERİ VERİLİR.
// (Zorunlu barışta fidye ödenmez, iller işgalcide kalır.) Bedel karşılanamıyorsa null döner.
export function signPeace(save: GameSave, countryId: string): GameSave | null {
  const war = save.wars.find(w => w.countryId === countryId);
  if (!war) return null;
  const cost = peaceTerms(save, war);
  if (cost > save.money) return null;

  // Harita savaşı: ele geçirilen eyaletler iade edilir, garnizonlar anavatana
  // döner, eyaletlerdeki birliklerimiz sınır iline çekilir. Bekleyen taarruz
  // emirleri de düşer (artık savaş yok).
  if (war.warType === 'harita') {
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
  }

  const home = frontHomeProvinceId(countryId, save.occupiedProvinces);
  const provinceUnits = addFrontUnits(save.provinceUnits, home, frontOf(war));

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
    provinceUnits,
    occupiedProvinces,
    occupiedGarrisons,
    wars: save.wars.filter(w => w.countryId !== countryId),
    truces: { ...save.truces, [countryId]: save.turn + TRUCE_DURATION },
  }, countryId);
}

// Zayiatı kara birimlerine (asker/tank) oransal dağıtır; savunma savaşında yapılar da yıpranır
function applyLandCasualties(
  provinceUnits: GameSave['provinceUnits'],
  powerLoss: number,
  wearStructures: boolean,
  targetProvinces?: string[]
): GameSave['provinceUnits'] {
  if (powerLoss <= 0) return provinceUnits;

  let provincesToProcess = Object.keys(provinceUnits);
  if (targetProvinces && targetProvinces.length > 0) {
    provincesToProcess = provincesToProcess.filter(p => targetProvinces.includes(p));
  }

  if (provincesToProcess.length === 0) return provinceUnits;

  let landPower = 0;
  for (const provId of provincesToProcess) {
    const units = provinceUnits[provId] || {};
    landPower += (units.asker || 0) * LAND_ATTACK.asker + (units.tank || 0) * LAND_ATTACK.tank;
  }

  if (landPower <= 0) return provinceUnits;
  const lossFraction = Math.min(1, powerLoss / landPower);

  const next = { ...provinceUnits };
  for (const provId of provincesToProcess) {
    const units = provinceUnits[provId];
    if (!units) continue;

    const nextUnits: Record<string, number> = {};
    for (const [type, count] of Object.entries(units)) {
      let remaining = count;
      if (type === 'asker' || type === 'tank') {
        remaining = Math.floor(count * (1 - lossFraction));
      } else if (wearStructures && (type === 'hava_savunma' || type === 'kara_savunma')) {
        remaining = Math.floor(count * (1 - lossFraction * STRUCTURE_WEAR));
      }
      if (remaining > 0) nextUnits[type] = remaining;
    }

    if (Object.keys(nextUnits).length > 0) {
      next[provId] = nextUnits;
    } else {
      delete next[provId];
    }
  }
  return next;
}

// Uçak kayıplarını illere oransal dağıtır
function applyPlaneLosses(
  provinceUnits: GameSave['provinceUnits'],
  planesLost: number
): GameSave['provinceUnits'] {
  if (planesLost <= 0) return provinceUnits;
  let remainingToLose = planesLost;
  const next: GameSave['provinceUnits'] = {};
  for (const [provId, units] of Object.entries(provinceUnits)) {
    const nextUnits = { ...units };
    if (nextUnits.ucak && remainingToLose > 0) {
      const lost = Math.min(nextUnits.ucak, remainingToLose);
      remainingToLose -= lost;
      nextUnits.ucak -= lost;
      if (nextUnits.ucak <= 0) delete nextUnits.ucak;
    }
    if (Object.keys(nextUnits).length > 0) next[provId] = nextUnits;
  }
  return next;
}

// Tüm aktif savaşları bir tur ilerletir
export function resolveWars(save: GameSave): { save: GameSave; events: TurnEvent[]; reports: BattleReport[] } {
  if (save.wars.length === 0) return { save, events: [], reports: [] };

  const events: TurnEvent[] = [];
  const reports: BattleReport[] = [];
  let provinceUnits = save.provinceUnits;
  let money = save.money;
  const aiMilitary = { ...save.aiMilitary };
  const aiEconomy = { ...(save.aiEconomy || {}) };
  const conquered = [...save.conqueredCountryIds];
  const conqueredEconomies = { ...(save.conqueredEconomies || {}) };
  const conqueredNames = { ...(save.conqueredNames || {}) };
  const occupiedProvinces = { ...save.occupiedProvinces };
  const occupiedGarrisons = { ...(save.occupiedGarrisons || {}) };
  const truces = { ...save.truces };
  const remainingWars: War[] = [];

  const hMult = happinessMultiplier(save.happiness ?? 70);

  // Fetih ortak işlemi: ülke topraklara katılır, işgalleri kalkar,
  // ülkenin O ANKİ (büyümüş) ekonomisi DEVRALINIR — tarım/sanayi yıkılmaz,
  // geliri artık her tur oyuncuya akar. Ganimet de gerçek zenginliğe göredir.
  // Sağ kalan cephe ordusu yurda döner.
  const completeConquest = (war: War, survivingFront: FrontForce) => {
    conquered.push(war.countryId);
    delete aiMilitary[war.countryId];
    for (const provId of Object.keys(occupiedProvinces)) {
      if (occupiedProvinces[provId] === war.countryId) {
        delete occupiedProvinces[provId];
        delete occupiedGarrisons[provId];
      }
    }
    const economy = getAiEconomy(save, war.countryId);
    conqueredEconomies[war.countryId] = economy;
    conqueredNames[war.countryId] = war.countryName;
    delete aiEconomy[war.countryId]; // artık AI değil; ölü kayıt bırakma
    const loot = Math.round(economy.income * 5);
    money += loot;
    // Sağ kalan ordu fethedilen toprakta konuşlu kalır (garnizon);
    // oradan yeni cephelere sevk edilebilir.
    provinceUnits = addFrontUnits(provinceUnits, war.countryId, survivingFront);
    events.push({ type: 'conquest', message: `${war.countryName} fethedildi! Ganimet: +${formatMoney(loot)} · Devralınan gelir: +${formatMoney(economy.income)}/tur · Ordu bölgede konuşlandı` });
  };

  for (const war of save.wars) {
    // Harita savaşları bu havuz çözücünün işi değil — resolveMapTurn halleder
    if (war.warType === 'harita') {
      remainingWars.push(war);
      continue;
    }

    // İlan turu: muharebe yok — oyuncuya cepheye ordu gönderme / savunma kurma şansı
    if (war.startedTurn === save.turn) {
      remainingWars.push(war);
      continue;
    }

    // Zorunlu barış: hiçbir savaş 60 turdan uzun süremez
    if (save.turn - war.startedTurn >= MAX_WAR_DURATION) {
      const f = war.enemyMaxStrength > 0 ? war.enemyStrength / war.enemyMaxStrength : 0;
      const base = getCountryStats(war.countryId, save.difficulty).income;
      const cost = Math.round(base * 10 * (f - 0.4));
      money = Math.max(0, money - Math.max(0, cost)) + Math.max(0, -cost);
      truces[war.countryId] = save.turn + TRUCE_DURATION;
      // Cephe ordusu yurda döner
      provinceUnits = addFrontUnits(
        provinceUnits,
        frontHomeProvinceId(war.countryId, occupiedProvinces),
        frontOf(war)
      );
      events.push({ type: 'peace', message: `${war.countryName} ile savaş yorgunluğu: zorunlu barış imzalandı. İşgal edilen yerler geri verilmedi.` });
      reports.push({
        countryName: war.countryName, countryId: war.countryId, turn: save.turn,
        playerArmyBefore: computeAttackPower(provinceUnits, hMult),
        playerArmyAfter: computeAttackPower(provinceUnits, hMult),
        playerLoss: 0, enemyArmyBefore: war.enemyStrength, enemyArmyAfter: war.enemyStrength,
        enemyLoss: 0, planesLost: 0, result: 'peace', initiator: war.initiator,
      });
      continue;
    }

    const variance = 0.8 + Math.random() * 0.4;

    // Düşman kompozisyonu: kalan gücün payları
    const enemyAir = war.enemyStrength * AI_AIR_SHARE;
    const enemyAA = war.enemyStrength * AI_AA_SHARE;

    if (war.initiator === 'ai') {
      // --- AI istilası: yurt savunması tüm hava gücü ve sınır ilindeki kara gücüyle yapılır ---
      const playerArmyBefore = computeAttackPower(provinceUnits, hMult);
      const invasion = war.enemyStrength;

      const borderList = BORDER_PROVINCES[war.countryId] ?? [];
      const target = borderList.find(id => !occupiedProvinces[id]) || borderList[0];

      let warAlive = true;
      let updatedWar: War = war;

      // İstila kuvveti kırıldıysa: il il kurtarma
      if (invasion <= 0) {
        const heldProvince = Object.entries(occupiedProvinces).find(([, occ]) => occ === war.countryId);
        if (heldProvince) {
          delete occupiedProvinces[heldProvince[0]];
          delete occupiedGarrisons[heldProvince[0]];
          events.push({ type: 'liberation', message: `${PROVINCE_NAMES[heldProvince[0]] ?? heldProvince[0]} kurtarıldı!` });
        } else {
          // Tüm iller geri alındı: savaş biter, düşman tazminat öder; cephe ordusu yurda döner
          const tribute = getCountryStats(war.countryId, save.difficulty).income * 2;
          money += tribute;
          aiMilitary[war.countryId] = Math.max(
            getCountryStats(war.countryId, save.difficulty).military * 0.5,
            (aiMilitary[war.countryId] ?? war.enemyMaxStrength) - war.enemyMaxStrength
          );
          provinceUnits = addFrontUnits(
            provinceUnits,
            frontHomeProvinceId(war.countryId, occupiedProvinces),
            frontOf(war)
          );
          events.push({ type: 'battle', message: `${war.countryName} saldırısı püskürtüldü! Tazminat: +${formatMoney(tribute)}` });
          reports.push({
            countryName: war.countryName, countryId: war.countryId, turn: save.turn,
            playerArmyBefore, playerArmyAfter: computeAttackPower(provinceUnits, hMult),
            playerLoss: 0, enemyArmyBefore: invasion, enemyArmyAfter: 0,
            enemyLoss: invasion, planesLost: 0, result: 'repelled', initiator: war.initiator,
          });
          warAlive = false;
        }
      } else {
        // Faz 1 — Hava savunması: yurttaki tüm uçaklar
        const planes = countUnits(provinceUnits, 'ucak');
        const playerAA = computeAAPower(provinceUnits);
        const playerAirPower = planes * AIR_COMBAT_POWER;
        const airEff = playerAirPower > 0 ? playerAirPower / (playerAirPower + enemyAA + enemyAir) : 0;
        const planesLost = Math.floor(planes * (1 - airEff) * AIR_LOSS_RATE);
        provinceUnits = applyPlaneLosses(provinceUnits, planesLost);
        const bombardment = (planes - planesLost) * BOMBARDMENT_POWER * airEff;

        const defAirEff = enemyAir > 0 ? enemyAir / (enemyAir + playerAA) : 0;
        const lossMultiplier = 1 + 0.5 * defAirEff;

        // Sadece hedeflenen sınır eyaletindeki kara savunma gücü katılır (uçaklar tüm ülkeden destek verir)
        const targetUnits = provinceUnits[target] || {};
        const landDefense = ((targetUnits.asker || 0) * LAND_DEFENSE.asker
          + (targetUnits.tank || 0) * LAND_DEFENSE.tank
          + (targetUnits.kara_savunma || 0) * LAND_DEFENSE.kara_savunma) * hMult;

        const defense = landDefense + bombardment;
        const playerLoss = Math.round(invasion * ENEMY_DAMAGE_RATE * variance * lossMultiplier);

        // Zayiat sadece hedeflenen sınır eyaletine yansır
        provinceUnits = applyLandCasualties(provinceUnits, playerLoss, true, [target]);

        if (defense >= invasion) {
          // Cephe tutuyor: istila kuvveti erir
          const enemyLoss = Math.round(defense * PLAYER_DAMAGE_RATE * variance);
          const newStrength = Math.max(0, invasion - enemyLoss);
          updatedWar = { ...war, enemyStrength: newStrength, lastPlayerLoss: playerLoss, lastEnemyLoss: enemyLoss };
          reports.push({
            countryName: war.countryName, countryId: war.countryId, turn: save.turn,
            playerArmyBefore, playerArmyAfter: computeAttackPower(provinceUnits, hMult),
            playerLoss, enemyArmyBefore: invasion, enemyArmyAfter: newStrength,
            enemyLoss, planesLost, result: newStrength <= 0 ? 'repelled' : 'ongoing', initiator: war.initiator,
          });
          if (newStrength <= 0) {
            events.push({ type: 'battle', message: `${war.countryName} istila kuvveti kırıldı! Ordumuz illeri geri alıyor.` });
          }
        } else {
          // Savunma yetersiz: sınır ilini işgal eder.
          // Garnizon istila kuvvetinden AYRILIR — aynı ordu iki yerde birden savaşamaz.
          let fieldForce = invasion;
          if (!occupiedProvinces[target]) {
            const garrison = Math.max(1, Math.round(invasion * GARRISON_SHARE));
            occupiedProvinces[target] = war.countryId;
            occupiedGarrisons[target] = garrison;
            fieldForce = Math.max(0, invasion - garrison);
            events.push({ type: 'occupation', message: `${war.countryName}, ${PROVINCE_NAMES[target] ?? target} ilini işgal etti! Garnizon Gücü: ${formatCount(garrison)}` });
          } else {
            const loot = Math.round(money * PILLAGE_RATE);
            money = Math.max(0, money - loot);
            events.push({ type: 'invasion', message: `${war.countryName} akınları hazineden ${formatMoney(loot)} yağmaladı!` });
          }
          updatedWar = { ...war, enemyStrength: fieldForce, lastPlayerLoss: playerLoss, lastEnemyLoss: 0 };
          reports.push({
            countryName: war.countryName, countryId: war.countryId, turn: save.turn,
            playerArmyBefore, playerArmyAfter: computeAttackPower(provinceUnits, hMult),
            playerLoss, enemyArmyBefore: invasion, enemyArmyAfter: fieldForce,
            enemyLoss: 0, planesLost, result: 'occupation', initiator: war.initiator,
          });
        }
      }

      // --- KARŞI TAARRUZ: cepheye sevk edilen ordu düşman ANAVATANINI vurur ---
      // Anavatan (aiMilitary) sıfırlanır ve cephede yeterli piyade varsa ülke fethedilir.
      if (warAlive && frontHasUnits(frontOf(updatedWar))) {
        const front = frontOf(updatedWar);
        const homeland = aiMilitary[war.countryId] ?? getCountryStats(war.countryId, save.difficulty).military;
        const baseMil = getCountryStats(war.countryId, save.difficulty).military;
        const infantryNeeded = Math.round(baseMil * CONQUEST_INFANTRY_RATIO);

        // Hava fazı — cephedeki uçaklar anavatan savunmasına karşı
        const hAir = homeland * AI_AIR_SHARE;
        const hAA = homeland * AI_AA_SHARE;
        const fAirPower = front.ucak * AIR_COMBAT_POWER;
        const fAirEff = fAirPower > 0 ? fAirPower / (fAirPower + hAA + hAir) : 0;
        const fPlanesLost = Math.floor(front.ucak * (1 - fAirEff) * AIR_LOSS_RATE);
        const fBombardment = (front.ucak - fPlanesLost) * BOMBARDMENT_POWER * fAirEff;
        const fDefAirEff = hAir > 0 ? hAir / (hAir + fAirPower) : 0;
        const fLossMult = 1 + 0.5 * fDefAirEff;

        // Kara fazı — tahkimat kozu ana modeldeki gibi tank saldırısını keser
        const hFort = homeland * AI_FORT_SHARE;
        const tankRaw = front.tank * LAND_ATTACK.tank * hMult;
        const tankEff = tankRaw > 0 ? 1 - 0.5 * Math.min(1, hFort / tankRaw) : 1;
        const attack = front.asker * LAND_ATTACK.asker * hMult + tankRaw * tankEff + fBombardment;

        const homelandLoss = Math.round(attack * PLAYER_DAMAGE_RATE * variance);
        const frontLoss = Math.round(homeland * ENEMY_DAMAGE_RATE * variance * fLossMult);
        const newFront = applyFrontCasualties(
          { ...front, ucak: Math.max(0, front.ucak - fPlanesLost) },
          frontLoss
        );
        const newHomeland = Math.max(0, homeland - homelandLoss);
        aiMilitary[war.countryId] = newHomeland;
        updatedWar = { ...updatedWar, front: newFront };

        if (newHomeland <= 0) {
          if (newFront.asker >= infantryNeeded) {
            completeConquest(updatedWar, newFront);
            reports.push({
              countryName: war.countryName, countryId: war.countryId, turn: save.turn,
              playerArmyBefore: frontAttackPower(front, hMult), playerArmyAfter: frontAttackPower(newFront, hMult),
              playerLoss: frontLoss, enemyArmyBefore: homeland, enemyArmyAfter: 0,
              enemyLoss: homeland, planesLost: fPlanesLost, result: 'conquest', initiator: war.initiator,
            });
            warAlive = false;
          } else {
            events.push({ type: 'battle', message: `${war.countryName} anavatan direnci kırıldı — fetih için cephede en az ${formatCount(infantryNeeded)} asker gerekli.` });
          }
        }
      }

      if (warAlive) remainingWars.push(updatedWar);
      continue;
    }

    // --- Oyuncu taarruzu: yalnız CEPHEDEKİ ordu savaşır ---
    const front = frontOf(war);
    const isIlIl = war.warType === 'il_il';
    const infantryNeeded = Math.round(war.enemyMaxStrength * CONQUEST_INFANTRY_RATIO);
    const frontBefore = frontAttackPower(front, hMult);

    // İl-il savaşta tüm eyaletler düşmüş, fetih cephede piyade bekliyor
    if (isIlIl && war.provinces && war.provinces.every(p => p.isConquered)) {
      if (front.asker >= infantryNeeded) {
        completeConquest(war, front);
        reports.push({
          countryName: war.countryName, countryId: war.countryId, turn: save.turn,
          playerArmyBefore: frontBefore, playerArmyAfter: frontBefore,
          playerLoss: 0, enemyArmyBefore: 0, enemyArmyAfter: 0,
          enemyLoss: 0, planesLost: 0, result: 'conquest', initiator: war.initiator,
        });
      } else {
        remainingWars.push(war);
        events.push({ type: 'battle', message: `${war.countryName} direnci kırıldı — fetih için cephede en az ${formatCount(infantryNeeded)} asker gerekli.` });
      }
      continue;
    }

    // Faz 1 — Hava muharebesi: cephedeki uçaklar
    const playerAirPower = front.ucak * AIR_COMBAT_POWER;
    const airEff = playerAirPower > 0 ? playerAirPower / (playerAirPower + enemyAA + enemyAir) : 0;
    const planesLost = Math.floor(front.ucak * (1 - airEff) * AIR_LOSS_RATE);
    const bombardment = (front.ucak - planesLost) * BOMBARDMENT_POWER * airEff;

    // Düşman hava üstünlüğü zayiatı artırır; cephedeki uçaklar hava şemsiyesi görevi görür
    const defAirEff = enemyAir > 0 ? enemyAir / (enemyAir + playerAirPower) : 0;
    const lossMultiplier = 1 + 0.5 * defAirEff;

    // Faz 2 — Kara muharebesi
    // Koz: düşman tahkimatı tank saldırısını %50'ye kadar keser (bkz. docs §2).
    // Tahkimatı ezmenin yolu bol tank (oran düşer) ya da bombardımandır.
    const enemyFort = war.enemyStrength * AI_FORT_SHARE;
    const tankAttackRaw = front.tank * LAND_ATTACK.tank * hMult;
    const tankEff = tankAttackRaw > 0 ? 1 - 0.5 * Math.min(1, enemyFort / tankAttackRaw) : 1;
    const landAttack = front.asker * LAND_ATTACK.asker * hMult + tankAttackRaw * tankEff;
    const attack = landAttack + bombardment;

    const currentEnemyStrength = isIlIl
      ? (war.provinces?.find(p => p.id === war.activeProvinceId)?.strength || 0)
      : war.enemyStrength;

    const enemyLoss = Math.round(attack * PLAYER_DAMAGE_RATE * variance);
    const playerLoss = Math.round(currentEnemyStrength * ENEMY_DAMAGE_RATE * variance * lossMultiplier);

    const newFront = applyFrontCasualties(
      { ...front, ucak: Math.max(0, front.ucak - planesLost) },
      playerLoss
    );
    const frontAfter = frontAttackPower(newFront, hMult);

    if (attack <= 0) {
      events.push({ type: 'battle', message: `${war.countryName} cephesinde ordu yok — "Birlik Konuşlandır" ile cepheye asker gönderin.` });
    }

    if (isIlIl && war.provinces && war.activeProvinceId) {
      const updatedProvinces = war.provinces.map(p => {
        if (p.id === war.activeProvinceId) {
          const newStr = Math.max(0, p.strength - enemyLoss);
          return { ...p, strength: newStr, isConquered: newStr <= 0 };
        }
        return p;
      });

      const targetProv = updatedProvinces.find(p => p.id === war.activeProvinceId)!;

      if (targetProv.isConquered) {
        events.push({ type: 'liberation', message: `${war.countryName} - ${targetProv.name} eyaleti ele geçirildi!` });

        // Bağlantılı sıradaki fethedilmemiş eyaleti bul
        const nextProv = updatedProvinces.find(p => {
          if (p.isConquered) return false;
          const conn = findConnectingTurkishProvinces(save, war.countryId, p.id, updatedProvinces);
          return conn.length > 0;
        });

        const allConquered = updatedProvinces.every(p => p.isConquered);

        if (allConquered && newFront.asker >= infantryNeeded) {
          completeConquest(war, newFront);
          reports.push({
            countryName: war.countryName, countryId: war.countryId, turn: save.turn,
            playerArmyBefore: frontBefore, playerArmyAfter: frontAfter,
            playerLoss, enemyArmyBefore: currentEnemyStrength, enemyArmyAfter: 0,
            enemyLoss: currentEnemyStrength, planesLost, result: 'conquest', initiator: war.initiator,
          });
        } else if (allConquered) {
          // Tüm eyaletler düştü ama bayrağı dikecek piyade cephede yok — savaş fetih bekliyor
          remainingWars.push({
            ...war,
            provinces: updatedProvinces,
            activeProvinceId: undefined,
            enemyStrength: 0,
            front: newFront,
            lastPlayerLoss: playerLoss,
            lastEnemyLoss: enemyLoss,
          });
          events.push({ type: 'battle', message: `${war.countryName} direnci kırıldı — fetih için cephede en az ${formatCount(infantryNeeded)} asker gerekli.` });
        } else {
          const nextActiveId = nextProv ? nextProv.id : updatedProvinces.find(p => !p.isConquered)?.id;

          remainingWars.push({
            ...war,
            provinces: updatedProvinces,
            activeProvinceId: nextActiveId,
            enemyStrength: updatedProvinces.reduce((sum, p) => sum + p.strength, 0),
            front: newFront,
            lastPlayerLoss: playerLoss,
            lastEnemyLoss: enemyLoss,
          });

          reports.push({
            countryName: `${war.countryName} (${targetProv.name})`, countryId: war.countryId, turn: save.turn,
            playerArmyBefore: frontBefore, playerArmyAfter: frontAfter,
            playerLoss, enemyArmyBefore: currentEnemyStrength, enemyArmyAfter: 0,
            enemyLoss: currentEnemyStrength, planesLost, result: 'ongoing', initiator: war.initiator,
          });
        }
      } else {
        remainingWars.push({
          ...war,
          provinces: updatedProvinces,
          enemyStrength: updatedProvinces.reduce((sum, p) => sum + p.strength, 0),
          front: newFront,
          lastPlayerLoss: playerLoss,
          lastEnemyLoss: enemyLoss,
        });

        reports.push({
          countryName: `${war.countryName} (${targetProv.name})`, countryId: war.countryId, turn: save.turn,
          playerArmyBefore: frontBefore, playerArmyAfter: frontAfter,
          playerLoss, enemyArmyBefore: currentEnemyStrength, enemyArmyAfter: targetProv.strength,
          enemyLoss, planesLost, result: 'ongoing', initiator: war.initiator,
        });
      }
    } else {
      // Topyekün savaş
      const newEnemyStrength = Math.max(0, war.enemyStrength - enemyLoss);
      if (newEnemyStrength <= 0) {
        if (newFront.asker >= infantryNeeded) {
          completeConquest(war, newFront);
          reports.push({
            countryName: war.countryName, countryId: war.countryId, turn: save.turn,
            playerArmyBefore: frontBefore, playerArmyAfter: frontAfter,
            playerLoss, enemyArmyBefore: war.enemyStrength, enemyArmyAfter: 0,
            enemyLoss: war.enemyStrength, planesLost, result: 'conquest', initiator: war.initiator,
          });
        } else {
          remainingWars.push({ ...war, enemyStrength: 0, front: newFront, lastPlayerLoss: playerLoss, lastEnemyLoss: enemyLoss });
          events.push({ type: 'battle', message: `${war.countryName} direnci kırıldı — fetih için cephede en az ${formatCount(infantryNeeded)} asker gerekli.` });
          reports.push({
            countryName: war.countryName, countryId: war.countryId, turn: save.turn,
            playerArmyBefore: frontBefore, playerArmyAfter: frontAfter,
            playerLoss, enemyArmyBefore: war.enemyStrength, enemyArmyAfter: 0,
            enemyLoss: war.enemyStrength, planesLost, result: 'ongoing', initiator: war.initiator,
          });
        }
      } else {
        remainingWars.push({ ...war, enemyStrength: newEnemyStrength, front: newFront, lastPlayerLoss: playerLoss, lastEnemyLoss: enemyLoss });
        reports.push({
          countryName: war.countryName, countryId: war.countryId, turn: save.turn,
          playerArmyBefore: frontBefore, playerArmyAfter: frontAfter,
          playerLoss, enemyArmyBefore: war.enemyStrength, enemyArmyAfter: newEnemyStrength,
          enemyLoss, planesLost, result: 'ongoing', initiator: war.initiator,
        });
      }
    }
  }

  return {
    save: { ...save, provinceUnits, money, aiMilitary, aiEconomy, conqueredCountryIds: conquered, conqueredEconomies, conqueredNames, occupiedProvinces, occupiedGarrisons, truces, wars: remainingWars },
    events,
    reports,
  };
}

// Kurtarma taarruzu hava desteği: garnizonun AA/hava payına karşı etkin
// bombardıman ve beklenen uçak kaybı (motor ve UI önizlemesi aynı formülü kullanır)
export function liberationAirSupport(garrison: number, planes: number): { bombardment: number; planesLost: number } {
  const enemyAA = garrison * AI_AA_SHARE;
  const enemyAir = garrison * AI_AIR_SHARE;
  const airPower = planes * AIR_COMBAT_POWER;
  const airEff = airPower > 0 ? airPower / (airPower + enemyAA + enemyAir) : 0;
  const planesLost = Math.floor(planes * (1 - airEff) * AIR_LOSS_RATE);
  return { bombardment: (planes - planesLost) * BOMBARDMENT_POWER * airEff, planesLost };
}

export function executeLiberateAttack(
  save: GameSave,
  provinceId: string,
  // sourceProvId -> birlikler. Asker/tank yalnız KOMŞU illerden gelir (UI zorlar);
  // uçaklar HER İLDEN katılabilir (hava unsurları menzil tanımaz).
  attackingUnits: Record<string, { asker?: number; tank?: number; ucak?: number }>
): { save: GameSave; playerLoss: number; enemyLoss: number; result: 'success' | 'failed' | 'invalid' } {
  const occupierId = save.occupiedProvinces[provinceId];
  const occupiedGarrisons = { ...(save.occupiedGarrisons || {}) };
  const occupiedProvinces = { ...save.occupiedProvinces };

  if (!occupierId) return { save, playerLoss: 0, enemyLoss: 0, result: 'invalid' };

  const initialGarrisonStrength = occupiedGarrisons[provinceId] ?? 50_000;
  const hMult = happinessMultiplier(save.happiness ?? 70);

  // Taahhüt edilen birlikler kaynak illerden AYRILIR — ordu hedefe yürür.
  // Başarıda kara birlikleri kurtarılan İLE konuşlanır; uçaklar üslerine döner;
  // başarısızlıkta sağ kalan herkes kaynağa döner.
  const nextProvinceUnits = { ...save.provinceUnits };
  const commits: { srcId: string; asker: number; tank: number; ucak: number }[] = [];
  let totalAsker = 0;
  let totalTank = 0;
  let totalUcak = 0;
  for (const [srcId, req] of Object.entries(attackingUnits)) {
    const src = nextProvinceUnits[srcId];
    if (!src) continue;
    const asker = Math.min(req.asker || 0, src.asker || 0);
    const tank = Math.min(req.tank || 0, src.tank || 0);
    const ucak = Math.min(req.ucak || 0, src.ucak || 0);
    if (asker <= 0 && tank <= 0 && ucak <= 0) continue;
    const nextSrc = { ...src };
    if (asker > 0) { nextSrc.asker -= asker; if (nextSrc.asker <= 0) delete nextSrc.asker; }
    if (tank > 0) { nextSrc.tank -= tank; if (nextSrc.tank <= 0) delete nextSrc.tank; }
    if (ucak > 0) { nextSrc.ucak -= ucak; if (nextSrc.ucak <= 0) delete nextSrc.ucak; }
    if (Object.keys(nextSrc).length > 0) nextProvinceUnits[srcId] = nextSrc;
    else delete nextProvinceUnits[srcId];
    commits.push({ srcId, asker, tank, ucak });
    totalAsker += asker;
    totalTank += tank;
    totalUcak += ucak;
  }

  // Hava fazı: garnizonun AA/hava payına karşı (ana muharebe modeliyle aynı)
  const { bombardment, planesLost } = liberationAirSupport(initialGarrisonStrength, totalUcak);

  const playerAttack = (totalAsker * LAND_ATTACK.asker + totalTank * LAND_ATTACK.tank) * hMult + bombardment;
  if (playerAttack <= 0) return { save, playerLoss: 0, enemyLoss: 0, result: 'invalid' };

  // Battle calculation
  const variance = 0.9 + Math.random() * 0.2;
  const enemyLoss = Math.round(playerAttack * PLAYER_DAMAGE_RATE * variance);
  const playerLossPower = Math.round(initialGarrisonStrength * ENEMY_DAMAGE_RATE * variance);

  // Zayiat: önce asker, kalan güç puanı tanka yansır (uçak kaybı hava fazında)
  let remainingLoss = playerLossPower;
  const lostAsker = Math.min(totalAsker, Math.max(0, Math.floor(remainingLoss / LAND_DEFENSE.asker)));
  remainingLoss -= lostAsker * LAND_DEFENSE.asker;
  const lostTank = remainingLoss > 0
    ? Math.min(totalTank, Math.max(0, Math.floor(remainingLoss / LAND_DEFENSE.tank)))
    : 0;
  const totalPlayerUnitsLost = lostAsker + lostTank + planesLost;
  const survAsker = totalAsker - lostAsker;
  const survTank = totalTank - lostTank;

  // Garnizon saha ordusundan AYRI bir havuzdur: buradaki hasar savaştaki
  // istila kuvvetini ETKİLEMEZ (çift sayım olmaz).
  const newGarrisonStrength = Math.max(0, initialGarrisonStrength - enemyLoss);

  let resultStatus: 'success' | 'failed' = 'failed';
  // Uçaklar her durumda üslerine döner (kayıplar sırayla düşülür)
  let remU = planesLost;
  const returnPlanes = () => {
    for (const c of commits) {
      const dU = Math.min(c.ucak, remU); remU -= dU;
      const backU = c.ucak - dU;
      if (backU <= 0) continue;
      const src = { ...(nextProvinceUnits[c.srcId] || {}) };
      src.ucak = (src.ucak || 0) + backU;
      nextProvinceUnits[c.srcId] = src;
    }
  };

  if (newGarrisonStrength <= 0) {
    // Kurtarıldı! Sağ kalan kara kuvveti kurtarılan ile konuşlanır.
    delete occupiedProvinces[provinceId];
    delete occupiedGarrisons[provinceId];
    if (survAsker > 0 || survTank > 0) {
      const dest = { ...(nextProvinceUnits[provinceId] || {}) };
      if (survAsker > 0) dest.asker = (dest.asker || 0) + survAsker;
      if (survTank > 0) dest.tank = (dest.tank || 0) + survTank;
      nextProvinceUnits[provinceId] = dest;
    }
    returnPlanes();
    resultStatus = 'success';
  } else {
    // Taarruz püskürtüldü: sağ kalanlar kaynak illerine geri çekilir
    occupiedGarrisons[provinceId] = newGarrisonStrength;
    let remA = lostAsker;
    let remT = lostTank;
    for (const c of commits) {
      const dA = Math.min(c.asker, remA); remA -= dA;
      const dT = Math.min(c.tank, remT); remT -= dT;
      const backA = c.asker - dA;
      const backT = c.tank - dT;
      if (backA <= 0 && backT <= 0) continue;
      const src = { ...(nextProvinceUnits[c.srcId] || {}) };
      if (backA > 0) src.asker = (src.asker || 0) + backA;
      if (backT > 0) src.tank = (src.tank || 0) + backT;
      nextProvinceUnits[c.srcId] = src;
    }
    returnPlanes();
  }

  return {
    save: {
      ...save,
      provinceUnits: nextProvinceUnits,
      occupiedProvinces,
      occupiedGarrisons,
    },
    playerLoss: totalPlayerUnitsLost,
    enemyLoss,
    result: resultStatus,
  };
}
