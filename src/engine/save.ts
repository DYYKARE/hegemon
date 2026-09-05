import { GameSave, TurnEvent, Difficulty, BattleReport, War } from './types';
import { computeIncome, computeUpkeep, popGrowthRate, nextHappiness, clampHappiness, warWeariness, defaultAiEconomy, armyFoodRatio } from './economy';
import { advanceAiCountries } from './ai';
import { advanceDiplomacy } from './diplomacy';
import { resolveMapTurn, splitForceToProvinces, GARRISON_SHARE_ON_WAR } from './mapWar';
import { loadSettings, MapLayout } from './settings';
import { buildActiveWorld, countryRegions } from './activeWorld';
import { countryPopulation, countryName } from './countryData';

// =============================================================================
// ÇOKLU KAYIT YUVASI (save slots) — 2026-07-17
// Eski tek anahtar (hegemon_save_v1) ilk erişimde bir yuvaya taşınır.
// Yapı: index (meta listesi) + yuva başına bir anahtar + aktif yuva imleci.
// Otomatik kayıt (GameUI her state değişiminde persistSave) AKTİF yuvaya yazar;
// "Yeni Oyun" artık kayıt SİLMEZ, yeni yuva açar.
// =============================================================================
const LEGACY_SAVE_KEY = 'hegemon_save_v1';
const SLOT_INDEX_KEY = 'hegemon_slots_v1';
const SLOT_PREFIX = 'hegemon_slot_';
const ACTIVE_SLOT_KEY = 'hegemon_active_slot';

export interface SaveSlotMeta {
  id: string;
  countryId: string;
  turn: number;
  difficulty: Difficulty;
  mapLayout: string;
  playerColor: string;
  conquests: number;
  updatedAt: number; // Date.now()
}

// Oyuncunun varsayılan toprak rengi (yeni oyunda seçmezse / eski kayıtta yoksa)
export const DEFAULT_PLAYER_COLOR = '#1d4ed8';

export function newGame(
  difficulty: Difficulty = 'orta',
  playerCountryId = '792',
  playerColor: string = DEFAULT_PLAYER_COLOR,
): GameSave {
  // Yeni oyun menüde seçilen harita düzeniyle başlar; dünya bu düzende kurulur
  const mapLayout = loadSettings().mapLayout;
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
    playerColor,
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
  // Fethedilen ülke adları: eski kayıtlar için ülke tablosundan geriye dönük doldur
  const conqueredNames = { ...(parsed.conqueredNames ?? {}) };
  for (const id of parsed.conqueredCountryIds ?? []) {
    if (!conqueredNames[id]) {
      conqueredNames[id] = countryName(id);
    }
  }
  // Kayıt kendi düzenini saklar; dünya bu düzende kurulur (parseSlot çağırır —
  // savaş göçü countryRegions'a baktığından dünya GÖÇTEN ÖNCE kurulmuş olmalı).
  const mapLayout: MapLayout = parsed.mapLayout === 'detayli' || parsed.mapLayout === 'gercek'
    ? parsed.mapLayout : 'basit';
  const base: GameSave = {
    ...parsed,
    mapLayout,
    playerCountryId: parsed.playerCountryId ?? '792',
    playerColor: parsed.playerColor ?? DEFAULT_PLAYER_COLOR,
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
    wars: (parsed.wars ?? []).map((w: any) => ({ initiator: 'player', ...w })),
  };
  return migratePoolWarsToMap(base);
}

// Eski havuz tabanlı savaşları harita (graph) modeline çevirir. Havuz modeli
// tamamen söküldü (2026-07-17): il_il eyalet güçleri garnizona, topyekun direnç
// eyaletlere bölünür; cephe ordusu oyuncunun işgalsiz bir bölgesine döner ve
// legacy alanlar (front/provinces/activeProvinceId/deployedUnits) atılır.
// Legacy alanlar artık War tipinde yok — okumalar `any` üzerinden yapılır.
function migratePoolWarsToMap(save: GameSave): GameSave {
  const legacy = (w: War) => w as unknown as {
    warType?: string;
    front?: { asker: number; tank: number; ucak: number };
    provinces?: { id: string; strength: number; isConquered: boolean }[];
  };
  const needsMigration = save.wars.some(w => {
    const l = legacy(w);
    return l.warType !== 'harita' || l.front || l.provinces;
  });
  if (!needsMigration) return save;

  const enemyProvinceStrength = { ...save.enemyProvinceStrength };
  const capturedEnemyProvinces = [...save.capturedEnemyProvinces];
  const provinceUnits = { ...save.provinceUnits };
  const aiMilitary = { ...save.aiMilitary };

  // Cephe ordusunun döneceği yurt bölgesi: işgalsiz ilk öz bölge
  const homeId = countryRegions(save.playerCountryId).find(id => !save.occupiedProvinces[id])
    ?? Object.keys(save.provinceInvestments)[0];

  const wars: War[] = save.wars.map(w => {
    const l = legacy(w);

    // Cephe ordusu (havuz modelinin gezici ordusu) yurda döner
    const front = l.front;
    if (homeId && front && (front.asker > 0 || front.tank > 0 || front.ucak > 0)) {
      const home = { ...(provinceUnits[homeId] || {}) };
      if (front.asker > 0) home.asker = (home.asker || 0) + front.asker;
      if (front.tank > 0) home.tank = (home.tank || 0) + front.tank;
      if (front.ucak > 0) home.ucak = (home.ucak || 0) + front.ucak;
      provinceUnits[homeId] = home;
    }

    if (l.warType === 'il_il' && l.provinces) {
      for (const p of l.provinces) {
        if (p.isConquered) {
          if (!capturedEnemyProvinces.includes(p.id)) capturedEnemyProvinces.push(p.id);
        } else {
          enemyProvinceStrength[p.id] = p.strength;
        }
      }
    } else if (l.warType !== 'harita') {
      splitForceToProvinces(enemyProvinceStrength, w.countryId, w.enemyStrength * GARRISON_SHARE_ON_WAR);
      aiMilitary[w.countryId] = Math.round(w.enemyStrength * (1 - GARRISON_SHARE_ON_WAR));
    }

    // Yalnız güncel War alanları kalır; legacy alanlar burada düşer
    return {
      countryId: w.countryId,
      countryName: w.countryName,
      enemyStrength: w.enemyStrength,
      enemyMaxStrength: w.enemyMaxStrength,
      startedTurn: w.startedTurn,
      lastPlayerLoss: w.lastPlayerLoss ?? 0,
      lastEnemyLoss: w.lastEnemyLoss ?? 0,
      initiator: w.initiator,
      warType: 'harita',
    };
  });

  return { ...save, wars, enemyProvinceStrength, capturedEnemyProvinces, provinceUnits, aiMilitary };
}

// --- Yuva altyapısı ---

function readIndex(): SaveSlotMeta[] {
  try {
    const raw = localStorage.getItem(SLOT_INDEX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeIndex(index: SaveSlotMeta[]): void {
  try {
    localStorage.setItem(SLOT_INDEX_KEY, JSON.stringify(index));
  } catch { /* depolama dolu — oyun kayıtsız sürer */ }
}

function slotMetaOf(id: string, save: GameSave): SaveSlotMeta {
  return {
    id,
    countryId: save.playerCountryId,
    turn: save.turn,
    difficulty: save.difficulty,
    mapLayout: save.mapLayout,
    playerColor: save.playerColor,
    conquests: save.conqueredCountryIds.length,
    updatedAt: Date.now(),
  };
}

// Eski tek anahtarlı kayıt varsa bir yuvaya taşı (bir kez; ilk erişimde çalışır)
function migrateLegacySlot(): void {
  try {
    const raw = localStorage.getItem(LEGACY_SAVE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    localStorage.removeItem(LEGACY_SAVE_KEY);
    if (parsed?.version !== 1 || !parsed.playerCountryId) return; // uyumsuz eski kayıt
    const id = `s${Date.now()}`;
    localStorage.setItem(SLOT_PREFIX + id, raw);
    writeIndex([slotMetaOf(id, parsed as GameSave), ...readIndex()]);
    localStorage.setItem(ACTIVE_SLOT_KEY, id);
  } catch { /* bozuk eski kayıt: yok say */ }
}

/** Tüm yuvaların metası — en son oynanmış önce. */
export function listSaveSlots(): SaveSlotMeta[] {
  migrateLegacySlot();
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

function parseSlot(id: string): GameSave | null {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed.playerCountryId) return null;
    // Dünya, kaydın düzeninde GÖÇTEN ÖNCE kurulur: havuz→harita savaş göçü
    // countryRegions'a bakar — dünya yokken boş dönüp göçü sessizce atlıyordu.
    const mapLayout: MapLayout = parsed.mapLayout === 'detayli' || parsed.mapLayout === 'gercek'
      ? parsed.mapLayout : 'basit';
    buildActiveWorld(mapLayout);
    return migrateSave(parsed);
  } catch {
    return null;
  }
}

/** Yuvayı yükler ve AKTİF yapar (otomatik kayıt artık ona yazar). */
export function loadSlot(id: string): GameSave | null {
  migrateLegacySlot();
  const save = parseSlot(id);
  if (save) {
    try { localStorage.setItem(ACTIVE_SLOT_KEY, id); } catch { /* imleçsiz sürer */ }
  }
  return save;
}

/** En son oynanan yuvayı yükler ("Devam Et"). */
export function loadSave(): GameSave | null {
  const latest = listSaveSlots()[0];
  return latest ? loadSlot(latest.id) : null;
}

/** Yuvayı ve metasını kalıcı siler. */
export function deleteSlot(id: string): void {
  localStorage.removeItem(SLOT_PREFIX + id);
  writeIndex(readIndex().filter(m => m.id !== id));
  if (localStorage.getItem(ACTIVE_SLOT_KEY) === id) localStorage.removeItem(ACTIVE_SLOT_KEY);
}

/**
 * Yeni oyunu YENİ bir yuvada başlatır — mevcut kayıtlara dokunmaz.
 * İlk kaydı hemen yazar ki oyuncu tek tur oynamadan çıksa da yuva listede olsun.
 */
export function startNewSlot(save: GameSave): void {
  migrateLegacySlot();
  const id = `s${Date.now()}`;
  try { localStorage.setItem(ACTIVE_SLOT_KEY, id); } catch { /* imleçsiz sürer */ }
  persistSave(save);
}

/** Aktif yuvaya yazar (otomatik kayıt her tur burayı çağırır) ve metayı tazeler. */
export function persistSave(save: GameSave): void {
  try {
    let id = localStorage.getItem(ACTIVE_SLOT_KEY);
    if (!id) { // imleç kaybolduysa (edge) yeni yuva aç — ilerleme asla ezilmez
      id = `s${Date.now()}`;
      localStorage.setItem(ACTIVE_SLOT_KEY, id);
    }
    localStorage.setItem(SLOT_PREFIX + id, JSON.stringify(save));
    const index = readIndex().filter(m => m.id !== id);
    index.unshift(slotMetaOf(id, save));
    writeIndex(index);
  } catch {
    // depolama dolu/erişilemez — oyun kayıtsız devam eder
  }
}

export function hasSave(): boolean {
  return listSaveSlots().length > 0;
}

/** TÜM kayıtları siler (yalnız testler ve tam sıfırlama için). */
export function clearAllSaves(): void {
  for (const m of readIndex()) localStorage.removeItem(SLOT_PREFIX + m.id);
  localStorage.removeItem(SLOT_INDEX_KEY);
  localStorage.removeItem(ACTIVE_SLOT_KEY);
  localStorage.removeItem(LEGACY_SAVE_KEY);
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
  if (money >= upkeep.total) {
    money -= upkeep.total;
  } else if (upkeep.total > 0) {
    const shortfall = 1 - money / upkeep.total; // ödenemeyen pay (0-1)
    money = 0;
    const lossFrac = Math.min(0.10, shortfall * 0.10);
    if (lossFrac > 0) {
      provinceUnits = desertUnits(provinceUnits, lossFrac);
      events.push({ type: 'battle', message: 'Hazine ordunun bakımını karşılayamıyor — birlikler firar ediyor!' });
    }
  }

  const afterEconomy: GameSave = {
    ...save,
    turn: save.turn + 1,
    money,
    provinceUnits,
    provinceInvestments,
    happiness: newHappiness,
  };

  // 5. AI ülkeleri güçlendir
  const aiResult = advanceAiCountries(afterEconomy);

  // 6. Savaşlar (tek model: harita): emir kuyruğu + graph muharebeleri TEK SEFERDE çözülür
  const mapResult = resolveMapTurn(aiResult.save);

  // 7. Diplomasi: ilişki drifti, fetih korkusu (bu tur fethedilenler sayılır),
  // pakt bitişi, ittifak dağılması, eşik uyarıları
  const newConquests = mapResult.save.conqueredCountryIds.length - save.conqueredCountryIds.length;
  const dipResult = advanceDiplomacy(mapResult.save, newConquests);

  return {
    // Hazine tur sonunda tam sayıya yuvarlanır: gelir hesapları kesirli dolar
    // üretebiliyor, küsurat kayıtta turlar boyu birikiyordu (kozmetik ama kirli).
    save: { ...dipResult.save, money: Math.round(dipResult.save.money) },
    events: [...events, ...aiResult.events, ...mapResult.events, ...dipResult.events],
    reports: mapResult.reports,
  };
}
