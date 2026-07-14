import { GameSave, TurnEvent, Difficulty, BattleReport } from './types';
import { computeIncome, computeUpkeep, popGrowthRate, nextHappiness, clampHappiness, warWeariness, defaultAiEconomy, armyFoodRatio } from './economy';
import { resolveWars } from './combat';
import { advanceAiCountries } from './ai';
import { advanceDiplomacy } from './diplomacy';
import { NEIGHBOR_COUNTRIES, BORDER_PROVINCES, applyMapLayout } from './geography';
import { resolveMapTurn, isLandNeighbor, splitForceToProvinces, GARRISON_SHARE_ON_WAR } from './mapWar';
import { loadSettings, MapLayout } from './settings';
import { buildActiveWorld, countryRegions } from './activeWorld';
import { countryPopulation } from './countryData';

const SAVE_KEY = 'hegemon_save_v1';

// 2024 il nüfusları (TÜİK'e yakın değerler) — yeni oyun başlangıcı
export const INITIAL_TURKEY_POPULATION: Record<string, number> = {
  "tr-1": 2274106, "tr-2": 632459, "tr-3": 736912, "tr-4": 571243, "tr-5": 396865,
  "tr-6": 5822802, "tr-7": 2688004, "tr-8": 174023, "tr-9": 1148164, "tr-10": 1250610,
  "tr-11": 228334, "tr-12": 283228, "tr-13": 359747, "tr-14": 320014, "tr-15": 273716,
  "tr-16": 3194720, "tr-17": 559383, "tr-18": 196531, "tr-19": 526282, "tr-20": 1051511,
  "tr-21": 1804880, "tr-22": 414714, "tr-23": 591497, "tr-24": 238622, "tr-25": 769085,
  "tr-26": 906617, "tr-27": 2154051, "tr-28": 450154, "tr-29": 77800, "tr-30": 284923,
  "tr-31": 1686043, "tr-32": 445325, "tr-33": 1916432, "tr-34": 15655924, "tr-35": 4462056,
  "tr-36": 274829, "tr-37": 378115, "tr-38": 1441523, "tr-39": 369347, "tr-40": 242944,
  "tr-41": 2079072, "tr-42": 2296347, "tr-43": 580701, "tr-44": 806156, "tr-45": 1468279,
  "tr-46": 1171298, "tr-47": 854716, "tr-48": 1021141, "tr-49": 399202, "tr-50": 308393,
  "tr-51": 365415, "tr-52": 763190, "tr-53": 345097, "tr-54": 1080080, "tr-55": 1368087,
  "tr-56": 331411, "tr-57": 218408, "tr-58": 634924, "tr-59": 1142451, "tr-60": 615711,
  "tr-61": 818023, "tr-62": 83645, "tr-63": 2143020, "tr-64": 391156, "tr-65": 1141015,
  "tr-66": 423886, "tr-67": 589688, "tr-68": 429069, "tr-69": 84366, "tr-70": 249464,
  "tr-71": 278335, "tr-72": 642874, "tr-73": 537762, "tr-74": 200788, "tr-75": 98335,
  "tr-76": 204100, "tr-77": 299313, "tr-78": 248014, "tr-79": 145826, "tr-80": 542157,
  "tr-81": 401011
};

export function newGame(difficulty: Difficulty = 'orta', playerCountryId = '792'): GameSave {
  // Yeni oyun menüde seçilen harita düzeniyle başlar; dünya bu düzende kurulur
  const mapLayout = loadSettings().mapLayout;
  applyMapLayout(mapLayout);
  buildActiveWorld(mapLayout);

  // Oyuncu ülkesinin bölgelerine nüfus dağıt (ülke toplamı / bölge sayısı, hafif varyans)
  const regions = countryRegions(playerCountryId);
  const totalPop = countryPopulation(playerCountryId);
  const provinceInvestments: GameSave['provinceInvestments'] = {};
  const perRegion = regions.length > 0 ? totalPop / regions.length : totalPop;
  regions.forEach((rid, i) => {
    // ±%40 varyans (deterministik, bölge sırasına göre) — büyük/küçük iller
    const v = 0.6 + ((i * 2654435761 >>> 0) % 1000) / 1250; // 0.6–1.4
    provinceInvestments[rid] = { nufus: Math.round(perRegion * v) };
  });

  return {
    mapLayout,
    playerCountryId,
    version: 1,
    difficulty,
    turn: 1,
    money: 4_200_000_000,
    provinceUnits: {},
    provinceInvestments,
    conqueredCountryIds: [],
    wars: [],
    aiMilitary: {},
    occupiedProvinces: {},
    occupiedGarrisons: {},
    truces: {},
    taxRate: 0.20,
    happiness: 70,
    aiEconomy: {},
    conqueredEconomies: {},
    conqueredNames: {},
    aiWars: [],
    relations: {},
    pacts: {},
    allies: [],
    tradeDeals: [],
    enemyProvinceStrength: {},
    capturedEnemyProvinces: [],
    pendingOrders: [],
  };
}

// Eski kayıtlarda eksik alanları tamamlar
function migrateSave(parsed: any): GameSave {
  // Devralınan ekonomiler: eski kayıtta fethedilmiş ülkeler için geriye dönük doldur
  // (o anki AI ekonomisi yoksa taban değerlerle — oyuncu gelir kaybetmez)
  const conqueredEconomies = { ...(parsed.conqueredEconomies ?? {}) };
  for (const id of parsed.conqueredCountryIds ?? []) {
    if (!conqueredEconomies[id]) {
      conqueredEconomies[id] = parsed.aiEconomy?.[id]
        ?? defaultAiEconomy(id, parsed.difficulty ?? 'orta');
    }
  }
  // Fethedilen ülke adları: eski kayıtlar için komşu listesinden geriye dönük doldur
  const conqueredNames = { ...(parsed.conqueredNames ?? {}) };
  for (const id of parsed.conqueredCountryIds ?? []) {
    if (!conqueredNames[id]) {
      conqueredNames[id] = NEIGHBOR_COUNTRIES.find(c => c.id === id)?.name ?? id;
    }
  }
  // Kayıt kendi düzenini saklar; dünya bu düzende kurulur (App.handleContinue çağırır).
  const mapLayout: MapLayout = parsed.mapLayout === 'detayli' || parsed.mapLayout === 'gercek'
    ? parsed.mapLayout : 'basit';
  applyMapLayout(mapLayout);
  const base: GameSave = {
    ...parsed,
    mapLayout,
    playerCountryId: parsed.playerCountryId ?? '792',
    conqueredEconomies,
    conqueredNames,
    difficulty: parsed.difficulty ?? 'orta',
    aiMilitary: parsed.aiMilitary ?? {},
    occupiedProvinces: parsed.occupiedProvinces ?? {},
    occupiedGarrisons: parsed.occupiedGarrisons ?? {},
    truces: parsed.truces ?? {},
    taxRate: parsed.taxRate ?? 0.20,
    happiness: parsed.happiness ?? 70,
    aiEconomy: parsed.aiEconomy ?? {},
    aiWars: parsed.aiWars ?? [],
    relations: parsed.relations ?? {},
    pacts: parsed.pacts ?? {},
    allies: parsed.allies ?? [],
    tradeDeals: parsed.tradeDeals ?? [],
    enemyProvinceStrength: parsed.enemyProvinceStrength ?? {},
    capturedEnemyProvinces: parsed.capturedEnemyProvinces ?? [],
    pendingOrders: parsed.pendingOrders ?? [],
    wars: (parsed.wars ?? []).map((w: any) => {
      // Eski "deployedUnits" filtresi kaldırıldı; birlikler zaten illerde durduğundan
      // kayıp olmaz — oyuncu yeni sistemde orduyu cepheye tekrar gönderir.
      const { deployedUnits: _legacy, ...rest } = w;
      const migrated = { initiator: 'player', ...rest };
      if (migrated.initiator === 'player' && !migrated.front) {
        migrated.front = { asker: 0, tank: 0, ucak: 0 };
      }
      return migrated;
    }),
  };
  return migrateLandWarsToMap(base);
}

// Eski havuz tabanlı KARA savaşlarını harita (graph) modeline çevirir:
// il_il eyalet güçleri garnizona, topyekun direnç eyaletlere bölünür;
// cephe ordusu sınır iline döner. Deniz aşırı savaşlar havuz modelinde kalır.
function migrateLandWarsToMap(save: GameSave): GameSave {
  const needsMigration = save.wars.some(w => w.warType !== 'harita' && isLandNeighbor(w.countryId));
  if (!needsMigration) return save;

  const enemyProvinceStrength = { ...save.enemyProvinceStrength };
  const capturedEnemyProvinces = [...save.capturedEnemyProvinces];
  const provinceUnits = { ...save.provinceUnits };
  const aiMilitary = { ...save.aiMilitary };

  const wars = save.wars.map(w => {
    if (w.warType === 'harita' || !isLandNeighbor(w.countryId)) return w;

    // Cephe ordusu sınır iline döner
    const front = w.front;
    if (front && (front.asker > 0 || front.tank > 0 || front.ucak > 0)) {
      const homeId = (BORDER_PROVINCES[w.countryId] ?? []).find(id => !save.occupiedProvinces[id])
        ?? (BORDER_PROVINCES[w.countryId] ?? [])[0] ?? 'tr-6';
      const home = { ...(provinceUnits[homeId] || {}) };
      if (front.asker > 0) home.asker = (home.asker || 0) + front.asker;
      if (front.tank > 0) home.tank = (home.tank || 0) + front.tank;
      if (front.ucak > 0) home.ucak = (home.ucak || 0) + front.ucak;
      provinceUnits[homeId] = home;
    }

    if (w.warType === 'il_il' && w.provinces) {
      for (const p of w.provinces) {
        if (p.isConquered) {
          if (!capturedEnemyProvinces.includes(p.id)) capturedEnemyProvinces.push(p.id);
        } else {
          enemyProvinceStrength[p.id] = p.strength;
        }
      }
    } else {
      splitForceToProvinces(enemyProvinceStrength, w.countryId, w.enemyStrength * GARRISON_SHARE_ON_WAR);
      aiMilitary[w.countryId] = Math.round(w.enemyStrength * (1 - GARRISON_SHARE_ON_WAR));
    }

    return {
      ...w,
      warType: 'harita' as const,
      provinces: undefined,
      activeProvinceId: undefined,
      front: { asker: 0, tank: 0, ucak: 0 },
    };
  });

  return { ...save, wars, enemyProvinceStrength, capturedEnemyProvinces, provinceUnits, aiMilitary };
}

export function loadSave(): GameSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return null;
    // Generic dünya modeli öncesi kayıtlar (playerCountryId yok, tr- id'li) uyumsuz —
    // temiz başlanır. buildActiveWorld çağıran taraf (App.handleContinue) düzeni kurar.
    if (!parsed.playerCountryId) return null;
    return migrateSave(parsed);
  } catch {
    return null;
  }
}

export function persistSave(save: GameSave): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // depolama dolu/erişilemez — oyun kayıtsız devam eder
  }
}

export function hasSave(): boolean {
  return loadSave() !== null;
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
}

// Firar: bakım ödenemeyince mobil birliklerin bir kısmı dağılır (yapılar kalır)
function desertUnits(
  provinceUnits: GameSave['provinceUnits'],
  lossFrac: number
): GameSave['provinceUnits'] {
  const next: GameSave['provinceUnits'] = {};
  for (const [provId, units] of Object.entries(provinceUnits)) {
    const nextUnits: Record<string, number> = {};
    for (const [type, count] of Object.entries(units)) {
      const remaining = (type === 'asker' || type === 'tank' || type === 'ucak')
        ? Math.floor(count * (1 - lossFrac))
        : count;
      if (remaining > 0) nextUnits[type] = remaining;
    }
    if (Object.keys(nextUnits).length > 0) next[provId] = nextUnits;
  }
  return next;
}

// Bir turu ilerletir: gelir − bakım, nüfus artışı, mutluluk (savaş yorgunluğu dahil),
// AI gelişimi ve savaş çözümlemesi
export function advanceTurn(save: GameSave): { save: GameSave; events: TurnEvent[]; reports: BattleReport[] } {
  const events: TurnEvent[] = [];

  // 1. Vergi geliri ve ordu bakım gideri
  const income = computeIncome(save);
  const upkeep = computeUpkeep(save);

  // 2. Mutluluk: vergi hedefine kayar; aktif savaşlar yorgunluk ekler.
  // Aç ordu da huzursuzluk yayar: iaşe açığı oranında (tam açlıkta −2/tur).
  const weariness = warWeariness(save.wars);
  const hungerPenalty = (1 - armyFoodRatio(save)) * 2;
  const newHappiness = clampHappiness(
    nextHappiness(save.happiness ?? 70, save.taxRate ?? 0.20) - weariness - hungerPenalty
  );

  // 3. Nüfus artışı — tarım yatırımı büyümeyi hızlandırır (gıda)
  const provinceInvestments: GameSave['provinceInvestments'] = {};
  for (const [provId, inv] of Object.entries(save.provinceInvestments)) {
    const pop = inv.nufus || 0;
    // İşgal altındaki illerde nüfus büyümez
    // Math.round: kayan nokta hatasıyla (1M × 1.001 = 1000999.99…) kişi kaybını önler
    provinceInvestments[provId] = pop > 0 && !save.occupiedProvinces[provId]
      ? { ...inv, nufus: Math.round(pop * (1 + popGrowthRate(inv))) }
      : inv;
  }

  // 4. Bakım ödemesi: hazine yetmezse birlikler firar eder (tur başına en çok %10)
  let money = save.money + income;
  let provinceUnits = save.provinceUnits;
  let wars = save.wars;
  if (money >= upkeep.total) {
    money -= upkeep.total;
  } else if (upkeep.total > 0) {
    const shortfall = 1 - money / upkeep.total; // ödenemeyen pay (0-1)
    money = 0;
    const lossFrac = Math.min(0.10, shortfall * 0.10);
    if (lossFrac > 0) {
      provinceUnits = desertUnits(provinceUnits, lossFrac);
      wars = wars.map(w => w.front ? {
        ...w,
        front: {
          asker: Math.floor(w.front.asker * (1 - lossFrac)),
          tank: Math.floor(w.front.tank * (1 - lossFrac)),
          ucak: Math.floor(w.front.ucak * (1 - lossFrac)),
        },
      } : w);
      events.push({ type: 'battle', message: 'Hazine ordunun bakımını karşılayamıyor — birlikler firar ediyor!' });
    }
  }

  const afterEconomy: GameSave = {
    ...save,
    turn: save.turn + 1,
    money,
    provinceUnits,
    wars,
    provinceInvestments,
    happiness: newHappiness,
  };

  // 5. AI ülkeleri güçlendir
  const aiResult = advanceAiCountries(afterEconomy);

  // 6. Deniz aşırı (havuz) savaşları çöz
  const warResult = resolveWars(aiResult.save);

  // 7. Harita savaşları: emir kuyruğu + graph muharebeleri TEK SEFERDE çözülür
  const mapResult = resolveMapTurn(warResult.save);

  // 8. Diplomasi: ilişki drifti, fetih korkusu (bu tur fethedilenler sayılır),
  // pakt bitişi, ittifak dağılması, eşik uyarıları
  const newConquests = mapResult.save.conqueredCountryIds.length - save.conqueredCountryIds.length;
  const dipResult = advanceDiplomacy(mapResult.save, newConquests);

  return {
    // Hazine tur sonunda tam sayıya yuvarlanır: gelir hesapları kesirli dolar
    // üretebiliyor, küsurat kayıtta turlar boyu birikiyordu (kozmetik ama kirli).
    save: { ...dipResult.save, money: Math.round(dipResult.save.money) },
    events: [...events, ...aiResult.events, ...warResult.events, ...mapResult.events, ...dipResult.events],
    reports: [...warResult.reports, ...mapResult.reports],
  };
}
