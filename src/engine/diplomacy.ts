import { GameSave, TurnEvent } from './types';
import { getCountryStats } from './countries';
import { getAiEconomy, TRADE_INCOME_SHARE, formatMoney } from './economy';
import { countryLandNeighbors } from './activeWorld';
import { countryName } from './countryData';

// ai.getAiMilitary'nin kopyası — ai.ts bu modülü import ettiğinden (döngü
// olmaması için) buradan ai.ts'e bakılamaz; formül iki satır, sapma riski düşük.
function liveMilitary(save: GameSave, countryId: string): number {
  return save.aiMilitary[countryId] ?? getCountryStats(countryId, save.difficulty).military;
}

// --- İlişki ölçeği ---
export const RELATION_MIN = -100;
export const RELATION_MAX = 100;
// Her tur ilişki, duruma bağlı TABANA doğru en çok bu kadar kayar.
// Taban altındaysa toparlanma, üstündeyse soğuma — diplomatik jestler kalıcı
// değildir, durum (fetihler, anlaşmalar) kalıcıdır.
export const RELATION_DRIFT = 1;

// Tehdit algısı: her fetih tüm komşuların ilişki TABANINI düşürür (kalıcı) ve
// fetih ANINDA anlık düşüş yaşatır ("sıra bize gelecek" korkusu).
export const CONQUEST_FEAR_PER_CONQUEST = 12; // taban düşüşü / fetih
export const CONQUEST_FEAR_CAP = 5;           // en çok bu kadar fetih sayılır (taban −60)
export const CONQUEST_FEAR_INSTANT = 15;      // fetih anında komşulara anlık düşüş
export const WAR_NEIGHBOR_PENALTY = 15;       // savaş ilanında DİĞER komşulara anlık düşüş
export const PEACE_RELATION_GAIN = 20;        // barış imzalamak ilişkiyi biraz onarır

// İlişkinin AI saldırganlığına etkisi: +100 → ×0 (saldırmaz), 0 → ×1, −100 → ×2.
export function relationsAttackMult(relation: number): number {
  return 1 - relation / 100;
}

// --- Diplomatik eylem sabitleri ---
export const GIFT_RELATION_PER_INCOME = 3; // hediye = hedefin 1 turluk geliri → +3 ilişki
export const GIFT_MAX_GAIN = 20;           // tek hediyenin tavanı (para havuzuyla satın alınamaz)

export const PACT_DURATION = 25;        // saldırmazlık paktı süresi (tur)
export const PACT_MIN_RELATION = 20;    // pakt için gereken asgari ilişki
export const PACT_COST_INCOMES = 5;     // bedel: hedefin tur gelirinin katı
export const PACT_RELATION_GAIN = 10;

export const ALLIANCE_MIN_RELATION = 60;
export const ALLIANCE_COST_INCOMES = 10;
export const ALLIANCE_RELATION_GAIN = 15;
export const ALLIANCE_BASELINE_BONUS = 30;  // ittifak ilişki tabanını yükseltir
export const ALLIANCE_BREAK_RELATION = 30;  // ilişki bunun altına düşerse ittifak DAĞILIR

export const TRADE_MIN_RELATION = 0;
export const TRADE_COST_INCOMES = 1;       // kuruluş bedeli
export const TRADE_BASELINE_BONUS = 20;    // ticaret ilişki tabanını yükseltir

export const ULTIMATUM_POWER_RATIO = 2;     // haraç için gereken güç üstünlüğü
export const ULTIMATUM_TRIBUTE_INCOMES = 5; // haraç: hedefin tur gelirinin katı
export const ULTIMATUM_RELATION_PENALTY = 40;
export const ULTIMATUM_MIN_RELATION = -60;  // bundan düşmancaysa boyun eğmez, savaşı göze alır

const clampRelation = (r: number) => Math.max(RELATION_MIN, Math.min(RELATION_MAX, r));

export function getRelation(save: GameSave, countryId: string): number {
  return save.relations?.[countryId] ?? 0;
}

export function pactActive(save: GameSave, countryId: string): boolean {
  return (save.pacts?.[countryId] || 0) > save.turn;
}

export function isAlly(save: GameSave, countryId: string): boolean {
  return (save.allies ?? []).includes(countryId);
}

export function hasTradeDeal(save: GameSave, countryId: string): boolean {
  return (save.tradeDeals ?? []).includes(countryId);
}

// İlişkinin sürüklendiği taban: fetihler korkutur (kalıcı), anlaşmalar ısıtır.
export function relationBaseline(save: GameSave, countryId: string): number {
  const fear = -CONQUEST_FEAR_PER_CONQUEST
    * Math.min(CONQUEST_FEAR_CAP, save.conqueredCountryIds.length);
  const trade = hasTradeDeal(save, countryId) ? TRADE_BASELINE_BONUS : 0;
  const ally = isAlly(save, countryId) ? ALLIANCE_BASELINE_BONUS : 0;
  return clampRelation(fear + trade + ally);
}

export function relationLabel(r: number): { label: string; tone: 'dost' | 'notr' | 'dusman' } {
  if (r >= 60) return { label: 'Müttefik ruhu', tone: 'dost' };
  if (r >= 30) return { label: 'Dostane', tone: 'dost' };
  if (r > -30) return { label: 'Nötr', tone: 'notr' };
  if (r > -60) return { label: 'Soğuk', tone: 'dusman' };
  return { label: 'Düşmanca', tone: 'dusman' };
}

// Oyuncunun cephe komşuları: kendi + fethedilen ülkelerin kara komşuları
export function playerFrontierNeighbors(save: GameSave): string[] {
  const frontier = new Set<string>();
  for (const n of countryLandNeighbors(save.playerCountryId)) frontier.add(n);
  for (const c of save.conqueredCountryIds) for (const n of countryLandNeighbors(c)) frontier.add(n);
  return [...frontier].filter(id =>
    id !== save.playerCountryId && !save.conqueredCountryIds.includes(id));
}

// --- Tur ilerlemesi: drift, tehdit algısı, pakt bitişi, ittifak dağılması ---
// newConquests: bu tur fethedilen ülke sayısı (advanceTurn fark alarak geçirir).
export function advanceDiplomacy(save: GameSave, newConquests: number): { save: GameSave; events: TurnEvent[] } {
  const events: TurnEvent[] = [];
  const relations = { ...(save.relations ?? {}) };
  const pacts = { ...(save.pacts ?? {}) };
  let allies = [...(save.allies ?? [])];
  let tradeDeals = [...(save.tradeDeals ?? [])];

  // Fethedilen ülkelerle ilişki/anlaşma düşer (ülke artık yok)
  for (const id of save.conqueredCountryIds) {
    delete relations[id];
    delete pacts[id];
  }
  allies = allies.filter(id => !save.conqueredCountryIds.includes(id));
  tradeDeals = tradeDeals.filter(id => !save.conqueredCountryIds.includes(id));

  const frontier = playerFrontierNeighbors(save);

  // Fetih anı: tüm cephe komşularında anlık korku dalgası
  if (newConquests > 0) {
    for (const id of frontier) {
      relations[id] = clampRelation((relations[id] ?? 0) - CONQUEST_FEAR_INSTANT * newConquests);
    }
    events.push({ type: 'invasion', message: '🌍 Fethin komşuları ürküttü — bölgede sana karşı güven sarsıldı.' });
  }

  // Drift: izlenen tüm ülkeler tabana doğru kayar; eşik geçişleri uyarı üretir
  const tracked = new Set<string>([...frontier, ...Object.keys(relations), ...allies, ...tradeDeals]);
  const working: GameSave = { ...save, relations, pacts, allies, tradeDeals };
  for (const id of tracked) {
    if (save.conqueredCountryIds.includes(id) || id === save.playerCountryId) continue;
    const before = relations[id] ?? 0;
    const target = relationBaseline(working, id);
    const delta = Math.max(-RELATION_DRIFT, Math.min(RELATION_DRIFT, target - before));
    const after = clampRelation(before + delta);
    if (after !== before) relations[id] = after;

    // Eşik uyarısı: ilişki −40'ın altına İNERKEN bir kez haber ver — savaş
    // ilanı sürpriz değil, izlenebilir bir tırmanmanın sonucu olsun.
    if (before > -40 && after <= -40 && !save.wars.some(w => w.countryId === id)) {
      events.push({ type: 'invasion', message: `⚠️ ${countryName(id)} ile ilişkiler düşmanca seviyeye indi — saldırı riski artıyor.` });
    }
  }

  // İttifak, ilişki soğursa dağılır (genişlemen müttefiki de ürkütür)
  const survivingAllies: string[] = [];
  for (const id of allies) {
    if ((relations[id] ?? 0) < ALLIANCE_BREAK_RELATION) {
      events.push({ type: 'peace', message: `💔 ${countryName(id)} ittifakı feshetti — ilişkiler çok soğudu.` });
    } else {
      survivingAllies.push(id);
    }
  }

  // Pakt bitişi haberi (kayıt temizliği: geçmiş paktlar silinir)
  for (const [id, until] of Object.entries(pacts)) {
    if (until === save.turn) {
      events.push({ type: 'peace', message: `📜 ${countryName(id)} ile saldırmazlık paktı sona erdi.` });
    }
    if (until < save.turn) delete pacts[id];
  }

  return { save: { ...save, relations, pacts, allies: survivingAllies, tradeDeals }, events };
}

// --- Savaş/barış kancaları (combat.startWar / signPeace çağırır) ---

// Oyuncu savaş ilan etti: hedefle ilişki dibe vurur, tüm anlaşmalar bozulur,
// diğer komşular ürker (tehdit algısı — savaşan hegemon kimseye güven vermez).
export function applyWarDeclarationDiplomacy(save: GameSave, targetId: string): GameSave {
  const relations = { ...(save.relations ?? {}) };
  relations[targetId] = RELATION_MIN;
  for (const id of playerFrontierNeighbors(save)) {
    if (id === targetId) continue;
    relations[id] = clampRelation((relations[id] ?? 0) - WAR_NEIGHBOR_PENALTY);
  }
  const pacts = { ...(save.pacts ?? {}) };
  delete pacts[targetId];
  return {
    ...save,
    relations,
    pacts,
    allies: (save.allies ?? []).filter(id => id !== targetId), // ittifaka saldırı = ihanet
    tradeDeals: (save.tradeDeals ?? []).filter(id => id !== targetId),
  };
}

// (AI'nin oyuncuya savaş ilanındaki ilişki düşüşü ai.ts içinde yapılır —
// advanceAiCountries kendi kopyaları üstünde çalışır.)

// Barış imzalandı: ilişki biraz onarılır (−100 → −80: yara kalır)
export function applyPeaceDiplomacy(save: GameSave, countryId: string): GameSave {
  const relations = { ...(save.relations ?? {}) };
  relations[countryId] = clampRelation((relations[countryId] ?? RELATION_MIN) + PEACE_RELATION_GAIN);
  return { ...save, relations };
}

// --- Diplomatik eylemler (UI çağırır; para yetmez/koşul tutmazsa null) ---

export function giftRelationGain(save: GameSave, countryId: string, amount: number): number {
  const income = Math.max(1, getAiEconomy(save, countryId).income);
  return Math.min(GIFT_MAX_GAIN, Math.floor(GIFT_RELATION_PER_INCOME * amount / income));
}

export function sendGift(save: GameSave, countryId: string, amount: number): GameSave | null {
  if (amount <= 0 || amount > save.money) return null;
  if (save.conqueredCountryIds.includes(countryId)) return null;
  if (save.wars.some(w => w.countryId === countryId)) return null;
  const gain = giftRelationGain(save, countryId, amount);
  if (gain < 1) return null;
  const relations = { ...(save.relations ?? {}) };
  relations[countryId] = clampRelation((relations[countryId] ?? 0) + gain);
  return { ...save, money: save.money - amount, relations };
}

export function signPact(save: GameSave, countryId: string): GameSave | null {
  const cost = getAiEconomy(save, countryId).income * PACT_COST_INCOMES;
  if (cost > save.money) return null;
  if (getRelation(save, countryId) < PACT_MIN_RELATION) return null;
  if (save.wars.some(w => w.countryId === countryId)) return null;
  if (pactActive(save, countryId)) return null;
  const relations = { ...(save.relations ?? {}) };
  relations[countryId] = clampRelation((relations[countryId] ?? 0) + PACT_RELATION_GAIN);
  return {
    ...save,
    money: save.money - cost,
    relations,
    pacts: { ...(save.pacts ?? {}), [countryId]: save.turn + PACT_DURATION },
  };
}

export function formAlliance(save: GameSave, countryId: string): GameSave | null {
  const cost = getAiEconomy(save, countryId).income * ALLIANCE_COST_INCOMES;
  if (cost > save.money) return null;
  if (getRelation(save, countryId) < ALLIANCE_MIN_RELATION) return null;
  if (save.wars.some(w => w.countryId === countryId)) return null;
  if (isAlly(save, countryId)) return null;
  const relations = { ...(save.relations ?? {}) };
  relations[countryId] = clampRelation((relations[countryId] ?? 0) + ALLIANCE_RELATION_GAIN);
  return {
    ...save,
    money: save.money - cost,
    relations,
    allies: [...(save.allies ?? []), countryId],
  };
}

export function signTradeDeal(save: GameSave, countryId: string): GameSave | null {
  const cost = getAiEconomy(save, countryId).income * TRADE_COST_INCOMES;
  if (cost > save.money) return null;
  if (getRelation(save, countryId) < TRADE_MIN_RELATION) return null;
  if (save.wars.some(w => w.countryId === countryId)) return null;
  if (hasTradeDeal(save, countryId)) return null;
  return {
    ...save,
    money: save.money - cost,
    tradeDeals: [...(save.tradeDeals ?? []), countryId],
  };
}

// Ültimatom: ezici güç üstünlüğüyle haraç alınır — ilişkiye kalıcı yara.
// Zaten düşmanca (−60 altı) ülke boyun eğmez: parayı değil savaşı seçer.
export function sendUltimatum(save: GameSave, countryId: string, playerPower: number): GameSave | null {
  if (save.wars.some(w => w.countryId === countryId)) return null;
  if (isAlly(save, countryId) || pactActive(save, countryId)) return null;
  if (getRelation(save, countryId) <= ULTIMATUM_MIN_RELATION) return null;
  const theirMilitary = liveMilitary(save, countryId);
  if (playerPower < theirMilitary * ULTIMATUM_POWER_RATIO) return null;
  const tribute = Math.round(getAiEconomy(save, countryId).income * ULTIMATUM_TRIBUTE_INCOMES);
  const relations = { ...(save.relations ?? {}) };
  relations[countryId] = clampRelation((relations[countryId] ?? 0) - ULTIMATUM_RELATION_PENALTY);
  return { ...save, money: save.money + tribute, relations };
}

// --- UI durum özeti: panelin ihtiyaç duyduğu her şey tek çağrıda ---

export interface DiplomacyAction {
  cost: number;      // pozitif: oyuncu öder; ültimatomda alınacak haraç
  ok: boolean;
  reason?: string;   // ok=false ise kısa engel açıklaması
}

export interface DiplomacyStatus {
  relation: number;
  baseline: number;
  label: string;
  tone: 'dost' | 'notr' | 'dusman';
  pactTurnsLeft: number; // 0 = pakt yok
  ally: boolean;
  trade: boolean;
  tradeIncome: number;   // aktif ticaretin tur geliri
  actions: { pact: DiplomacyAction; alliance: DiplomacyAction; trade: DiplomacyAction; ultimatum: DiplomacyAction };
}

export function diplomacyStatus(save: GameSave, countryId: string, playerPower: number): DiplomacyStatus {
  const relation = getRelation(save, countryId);
  const { label, tone } = relationLabel(relation);
  const income = getAiEconomy(save, countryId).income;
  const atWar = save.wars.some(w => w.countryId === countryId);
  const theirMilitary = liveMilitary(save, countryId);

  const gate = (cost: number, checks: [boolean, string][]): DiplomacyAction => {
    for (const [failed, reason] of checks) if (failed) return { cost, ok: false, reason };
    return { cost, ok: true };
  };

  const pactCost = Math.round(income * PACT_COST_INCOMES);
  const allianceCost = Math.round(income * ALLIANCE_COST_INCOMES);
  const tradeCost = Math.round(income * TRADE_COST_INCOMES);
  const tribute = Math.round(income * ULTIMATUM_TRIBUTE_INCOMES);

  return {
    relation,
    baseline: relationBaseline(save, countryId),
    label,
    tone,
    pactTurnsLeft: Math.max(0, (save.pacts?.[countryId] || 0) - save.turn),
    ally: isAlly(save, countryId),
    trade: hasTradeDeal(save, countryId),
    tradeIncome: Math.round(income * TRADE_INCOME_SHARE),
    actions: {
      pact: gate(pactCost, [
        [atWar, 'savaştasınız'],
        [pactActive(save, countryId), 'pakt zaten aktif'],
        [relation < PACT_MIN_RELATION, `ilişki ${PACT_MIN_RELATION}+ olmalı`],
        [pactCost > save.money, 'hazine yetersiz'],
      ]),
      alliance: gate(allianceCost, [
        [atWar, 'savaştasınız'],
        [isAlly(save, countryId), 'zaten müttefik'],
        [relation < ALLIANCE_MIN_RELATION, `ilişki ${ALLIANCE_MIN_RELATION}+ olmalı`],
        [allianceCost > save.money, 'hazine yetersiz'],
      ]),
      trade: gate(tradeCost, [
        [atWar, 'savaştasınız'],
        [hasTradeDeal(save, countryId), 'anlaşma zaten aktif'],
        [relation < TRADE_MIN_RELATION, `ilişki ${TRADE_MIN_RELATION}+ olmalı`],
        [tradeCost > save.money, 'hazine yetersiz'],
      ]),
      ultimatum: gate(tribute, [
        [atWar, 'savaştasınız'],
        [isAlly(save, countryId) || pactActive(save, countryId), 'anlaşma varken olmaz'],
        [relation <= ULTIMATUM_MIN_RELATION, 'boyun eğmez — savaşı seçer'],
        [playerPower < theirMilitary * ULTIMATUM_POWER_RATIO, `${ULTIMATUM_POWER_RATIO}× güç üstünlüğü gerek`],
      ]),
    },
  };
}

// UI ipucu metni: hediye maliyet merdiveni
export function giftHint(save: GameSave, countryId: string): string {
  const income = getAiEconomy(save, countryId).income;
  return `${formatMoney(income)} hediye ≈ +${GIFT_RELATION_PER_INCOME} ilişki (tek seferde en çok +${GIFT_MAX_GAIN})`;
}
