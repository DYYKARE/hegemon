import { GameSave, TurnEvent, AiWar } from './types';
import { getCountryStats, DIFFICULTY_SETTINGS } from './countries';
import { computeTotalAttackPower } from './combat';
import { defaultAiEconomy, getAiEconomy } from './economy';
import { splitInvasionForce, countryName, invasionHasViableTarget } from './mapWar';
import { countryLandNeighbors, countryRegions } from './activeWorld';
import { relationsAttackMult, getRelation, pactActive, isAlly } from './diplomacy';

export { getAiEconomy };

// Barış büyümesi hedefi ~%25-30 / 50 tur: erken saldıran hâlâ avantajlı ama
// bekleyen oyuncu cezalandırılmaz. (Eski 0.005+%40 pay, 50 turda +%48 veriyordu.)
const MILITARY_GROWTH_BASE = 0.003;     // yatırımsız temel askeri büyüme %0.3/tur
const MILITARY_INVESTMENT_SHARE = 0.30; // gelirinin %30'u askeri harcama
const ECONOMY_INVESTMENT_SHARE = 0.30;  // gelirinin %30'u ekonomik yatırım (birikime)
const POWER_COST = 50_000;              // 1 güç puanının maliyeti ($, asker referansı)
const AI_INCOME_GROWTH = 0.003;         // %0.3/tur bileşik gelir büyümesi
const AI_POP_GROWTH_RATE = 0.001;       // %0.1/tur nüfus artışı (oyuncuyla aynı)
const MAX_GROWTH_MULTIPLIER = 2;        // taban gücün en fazla 2 katına çıkar
const BASE_AGGRESSION_CHANCE = 0.01;    // temel savaş açma ihtimali/tur
const MAX_AGGRESSION_MULTIPLIER = 3;
const MAX_CHANCE_PER_TURN = 0.15;       // tek ülkenin tur başına savaş açma tavanı
const MAX_SIMULTANEOUS_AI_WARS = 2;     // aynı anda en fazla bu kadar AI istilası (akbaba sınırı)

// --- AI ülkeler arası rekabet ---
// Tarihî/coğrafi rakip çiftler: aralarında savaş patlak verebilir.
const AI_RIVAL_PAIRS: [string, string][] = [
  ['300', '100'], // Yunanistan – Bulgaristan
  ['051', '031'], // Ermenistan – Azerbaycan
  ['364', '368'], // İran – Irak
  ['760', '368'], // Suriye – Irak
  ['268', '051'], // Gürcistan – Ermenistan
];
const AI_WAR_CHANCE = 0.005;      // çift başına tur başına patlak verme şansı
const AI_WAR_ATTRITION = 0.03;    // savaşan iki taraf da her tur gücünün %3'ünü yitirir
const AI_WAR_MAX_TURNS = 15;      // en geç bu kadar turda biter
const AI_WAR_SURRENDER = 0.5;     // taban gücünün altına düşen taraf pes eder

export function getAiMilitary(save: GameSave, countryId: string): number {
  return save.aiMilitary[countryId] ?? getCountryStats(countryId, save.difficulty).military;
}

// Bir ülkenin şu an AI-AI savaşında olup olmadığı (UI ve fırsat analizi için)
export function getAiWarOpponent(save: GameSave, countryId: string): string | null {
  const w = (save.aiWars || []).find(x => x.attackerId === countryId || x.defenderId === countryId);
  if (!w) return null;
  return w.attackerId === countryId ? w.defenderId : w.attackerId;
}

// --- Saldırı şansı (TEK formül: motor ve UI göstergesi aynı fonksiyonu kullanır) ---
// currentMilitary verilirse (motor, büyüme SONRASI değeri geçirir) o kullanılır;
// verilmezse kayıttaki güncel güç (UI, oyuncunun gördüğü değer).
export function attackChance(
  save: GameSave,
  countryId: string,
  playerPower: number,
  currentMilitary?: number
): number {
  const settings = DIFFICULTY_SETTINGS[save.difficulty];
  const military = currentMilitary ?? getAiMilitary(save, countryId);
  const strengthRatio = military / Math.max(1, playerPower);
  const happiness = save.happiness ?? 70;
  const weaknessMult = 1 + Math.max(0, (50 - happiness) / 50);
  const busyMult = save.wars.some(w => w.initiator === 'player') ? 1.5 : 1;
  const relMult = relationsAttackMult(getRelation(save, countryId));
  return Math.min(
    MAX_CHANCE_PER_TURN,
    BASE_AGGRESSION_CHANCE * settings.aggression
      * Math.min(MAX_AGGRESSION_MULTIPLIER, Math.max(0.2, strengthRatio))
      * weaknessMult * busyMult * relMult
  );
}

// UI göstergesi: bir komşunun bu tur savaş ilan etme riski + nedenleri.
// advanceAiCountries'teki koşulların birebir aynası — motor ve gösterge sapmaz.
export interface AttackRiskInfo {
  chance: number;    // 0..1, tur başına ilan olasılığı
  chance10: number;  // 10 turda birikimli olasılık
  level: 'yok' | 'dusuk' | 'orta' | 'yuksek';
  blocked?: string;  // doluysa şu an saldıramaz (neden metni)
  reasons: string[]; // riski şekillendiren etmenler (kısa, oyuncuya dönük)
}

export function attackRiskInfo(save: GameSave, countryId: string): AttackRiskInfo {
  const settings = DIFFICULTY_SETTINGS[save.difficulty];
  const none = (blocked: string): AttackRiskInfo =>
    ({ chance: 0, chance10: 0, level: 'yok', blocked, reasons: [] });

  if (save.conqueredCountryIds.includes(countryId)) return none('Fethedildi');
  if (save.wars.some(w => w.countryId === countryId)) return none('Zaten savaştasınız');
  if (save.turn <= settings.graceTurns)
    return none(`Hazırlık dönemi — ${settings.graceTurns - save.turn + 1} tur daha saldırı yok`);
  if ((save.truces[countryId] || 0) > save.turn)
    return none(`Ateşkes sürüyor (${save.truces[countryId] - save.turn} tur)`);
  if (pactActive(save, countryId))
    return none(`Saldırmazlık paktı (${(save.pacts?.[countryId] || 0) - save.turn} tur)`);
  if (isAlly(save, countryId)) return none('Müttefikin — saldırmaz');
  const opponent = getAiWarOpponent(save, countryId);
  if (opponent) return none(`${countryName(opponent)} ile savaşta — meşgul`);
  if (!invasionHasViableTarget(save, countryId))
    return none('Sınır savunman caydırıyor — taarruz eşiğine ulaşamaz');

  const playerPower = computeTotalAttackPower(save, 1);
  const chance = attackChance(save, countryId, playerPower);

  const reasons: string[] = [];
  const ratio = getAiMilitary(save, countryId) / Math.max(1, playerPower);
  if (ratio >= 1.5) reasons.push('ordusu seninkinden güçlü');
  else if (ratio <= 0.5) reasons.push('ordusu zayıf — çekiniyor');
  if ((save.happiness ?? 70) < 50) reasons.push('halkın mutsuz — zayıflık kokusu alıyor');
  if (save.wars.some(w => w.initiator === 'player')) reasons.push('başka cephede meşgulsün — fırsatçılık');
  const rel = getRelation(save, countryId);
  if (rel <= -30) reasons.push('ilişkiler düşmanca');
  else if (rel >= 30) reasons.push('ilişkiler dostane');

  const level = chance < 0.02 ? 'dusuk' : chance < 0.05 ? 'orta' : 'yuksek';
  return { chance, chance10: 1 - Math.pow(1 - chance, 10), level, reasons };
}

// Bir AI ülkesinin bu turki BEKLENEN askeri büyümesi (UI göstergesi).
// advanceAiCountries'teki büyüme formülünün birebir kopyası — motor ve gösterge
// sapmaz. Yalnız oyuncunun cephe komşuları her tur büyür; diğerleri için 0 döner.
export function aiMilitaryGrowthPerTurn(save: GameSave, countryId: string): number {
  const frontier = new Set(countryLandNeighbors(save.playerCountryId));
  for (const c of save.conqueredCountryIds) for (const n of countryLandNeighbors(c)) frontier.add(n);
  if (!frontier.has(countryId)) return 0;
  if (save.conqueredCountryIds.includes(countryId)) return 0;

  const base = getCountryStats(countryId, save.difficulty);
  const current = save.aiMilitary[countryId] ?? base.military;
  const eco = getAiEconomy(save, countryId);
  const powerBought = (eco.income * MILITARY_INVESTMENT_SHARE) / POWER_COST;
  // organik büyüme gelir bütçesiyle sınırlı — advanceAiCountries ile birebir
  const organicGrowth = Math.min(current * MILITARY_GROWTH_BASE, eco.income / POWER_COST);
  const garrisonMass = countryRegions(countryId)
    .reduce((sum, rid) => sum + (save.enemyProvinceStrength[rid] ?? 0), 0);
  const next = Math.min(
    Math.max(current, base.military * MAX_GROWTH_MULTIPLIER - garrisonMass),
    current + organicGrowth + powerBought
  );
  return Math.max(0, Math.round(next - current));
}

// Komşu ülkelerin ordularını büyütür, ekonomilerini geliştirir, kendi aralarında
// savaştırır; oyuncu zayıfken (mutsuzluk, açık cepheler) saldırma ihtimalleri artar.
export function advanceAiCountries(save: GameSave): { save: GameSave; events: TurnEvent[] } {
  const settings = DIFFICULTY_SETTINGS[save.difficulty];
  const events: TurnEvent[] = [];
  const aiMilitary = { ...save.aiMilitary };
  const aiEconomy = { ...(save.aiEconomy || {}) };
  const enemyProvinceStrength = { ...save.enemyProvinceStrength };
  const wars = [...save.wars];
  const relations = { ...(save.relations ?? {}) };
  let tradeDeals = [...(save.tradeDeals ?? [])];
  // Savaş ilan eden saldırganlara karşı müttefiklerin açacağı AI-AI savaşları
  const allyWarQueue: AiWar[] = [];
  // Oyuncu gücü: yurttaki birlikler + cephelerdeki ordular (cepheye sevkiyat caydırıcılığı düşürmez)
  const playerPower = computeTotalAttackPower(save, 1);

  const nameOf = (id: string) => countryName(id);

  // Oyuncunun cephe komşuları: kendi + fethedilen ülkelerin kara komşuları
  const frontier = new Set<string>();
  for (const n of countryLandNeighbors(save.playerCountryId)) frontier.add(n);
  for (const c of save.conqueredCountryIds) for (const n of countryLandNeighbors(c)) frontier.add(n);
  const neighborIds = [...frontier].filter(id =>
    id !== save.playerCountryId && !save.conqueredCountryIds.includes(id));

  // Fethedilen ülkelerin AI-AI savaşları düşer
  let aiWars: AiWar[] = (save.aiWars || []).filter(w =>
    !save.conqueredCountryIds.includes(w.attackerId)
    && !save.conqueredCountryIds.includes(w.defenderId));
  const atAiWar = new Set(aiWars.flatMap(w => [w.attackerId, w.defenderId]));

  // Fırsatçılık çarpanları (mutsuz halk, meşgul cephe, düşmanca ilişki)
  // attackChance içinde hesaplanır — motor ve UI göstergesi tek formül kullanır.
  // Aynı anda 2'den fazla AI istilası olmaz — dogpile eğlenceli değildir.
  let aiWarsVsPlayer = wars.filter(w => w.initiator === 'ai').length;

  for (const neighborId of neighborIds) {
    const neighbor = { id: neighborId, name: countryName(neighborId) };
    if (save.conqueredCountryIds.includes(neighbor.id)) continue;

    const base = getCountryStats(neighbor.id, save.difficulty);
    const current = aiMilitary[neighbor.id] ?? base.military;
    const eco = aiEconomy[neighbor.id] ?? defaultAiEconomy(neighbor.id, save.difficulty);

    // --- Ekonomik gelişim: gelir bileşik büyür; AI-AI savaşı büyümeyi yarılar ---
    const growthFactor = atAiWar.has(neighbor.id) ? 0.5 : 1;
    const newPop = Math.floor(eco.population * (1 + AI_POP_GROWTH_RATE));
    const newIncome = eco.income * (1 + AI_INCOME_GROWTH * growthFactor);
    const newInvestment = eco.investment + eco.income * ECONOMY_INVESTMENT_SHARE * growthFactor;

    aiEconomy[neighbor.id] = {
      population: newPop,
      investment: newInvestment,
      income: newIncome,
    };

    // --- Askeri büyüme: harcanan dolar güç puanına çevrilir ---
    // Tavan TOPLAM gücü (anavatan + eyalet garnizonları) sayar: savaşta anavatan
    // garnizonlara boşaldıkça yeniden dolup sonsuz güç pompalayamaz.
    // ORGANİK büyüme (%0.3/tur) GELİR BÜTÇESİYLE sınırlı: ordu bedava büyüyemez —
    // gelirin tamamı orduya aksa tur başına en çok income/POWER_COST güç alınır.
    // (K.Kore 10M gelirle +2400/tur bileşik büyüyor, oyuncu ekonomisi asla
    // yetişemiyordu — 2026-07-13. İran/Irak/Yunanistan gibi normal ekonomiler
    // bütçe tavanının altında kalır, büyümeleri DEĞİŞMEZ.)
    const powerBought = (eco.income * MILITARY_INVESTMENT_SHARE) / POWER_COST;
    const organicGrowth = Math.min(current * MILITARY_GROWTH_BASE, eco.income / POWER_COST);
    const garrisonMass = countryRegions(neighbor.id)
      .reduce((sum, rid) => sum + (enemyProvinceStrength[rid] ?? 0), 0);
    const homelandCap = base.military * MAX_GROWTH_MULTIPLIER - garrisonMass;
    aiMilitary[neighbor.id] = Math.min(
      Math.max(current, homelandCap), // tavan aşıldıysa büyüme durur, mevcut korunur
      current + organicGrowth + powerBought
    );

    // --- Saldırganlık (oyuncuya) ---
    // graceTurns "ilk N tur saldırısız" demektir; save.turn burada YENİ tur
    // numarasıdır (advanceTurn önce artırır) — N. turda da ilan edilemez.
    if (save.turn <= settings.graceTurns) continue;
    if (wars.some(w => w.countryId === neighbor.id)) continue;
    if ((save.truces[neighbor.id] || 0) > save.turn) continue;
    if (pactActive(save, neighbor.id)) continue;  // saldırmazlık paktı bağlar
    if (isAlly(save, neighbor.id)) continue;      // müttefik saldırmaz
    if (atAiWar.has(neighbor.id)) continue; // kendi savaşıyla meşgul
    if (aiWarsVsPlayer >= MAX_SIMULTANEOUS_AI_WARS) continue;
    // Taarruz eşiğini hiçbir sınır bölgesinde tutturamayacak istila "donuk savaş"
    // doğurur (ilan var, emir yok) — hiç ilan edilmez. attackRiskInfo aynı kontrolü
    // gösterir; motor ve gösterge sapmaz.
    if (!invasionHasViableTarget(save, neighbor.id)) continue;

    // Tek doğru formül attackChance'tedir (UI göstergesi de aynı fonksiyonu
    // kullanır); zayıflık/meşguliyet/ilişki çarpanları oradan gelir.
    const chance = attackChance(save, neighbor.id, playerPower, aiMilitary[neighbor.id]);

    if (Math.random() < chance) {
      // HARİTA savaşı: istila kuvveti ülkenin CEPHE bölgelerine yığılır
      // (tüm ülkeye seyrelmez; yığın başına tavan MIN_INVASION_SPREAD'li),
      // oradan sınır illerimize taarruz emirleri üretir. Yatırılamayan kısım
      // ve kalan ordu anavatan rezervinde kalır, cepheye takviye sızdırır.
      const invasionForce = aiMilitary[neighbor.id] * settings.invasionShare;
      const deposited = splitInvasionForce(save, enemyProvinceStrength, neighbor.id, invasionForce);
      aiMilitary[neighbor.id] = Math.max(0, aiMilitary[neighbor.id] - deposited);
      wars.push({
        countryId: neighbor.id,
        countryName: neighbor.name,
        enemyStrength: deposited,
        enemyMaxStrength: deposited,
        startedTurn: save.turn,
        lastPlayerLoss: 0,
        lastEnemyLoss: 0,
        initiator: 'ai',
        warType: 'harita',
      });
      aiWarsVsPlayer += 1;
      events.push({ type: 'invasion', message: `${neighbor.name} sana savaş ilan etti! Sınır illerine yığınak yapıyor.` });

      // Diplomasi: saldırgan artık düşman, varsa ticaret anlaşması bozulur
      relations[neighbor.id] = Math.min(relations[neighbor.id] ?? 0, -80);
      tradeDeals = tradeDeals.filter(id => id !== neighbor.id);

      // İttifak devreye girer: saldırganın kara komşusu olan müttefikler ona
      // cephe açar (AI-AI savaşı: saldırgan her tur yıpranır — gerçek destek).
      const attackerNeighbors = countryLandNeighbors(neighbor.id);
      for (const allyId of save.allies ?? []) {
        if (allyId === neighbor.id) continue;
        if (!attackerNeighbors.includes(allyId)) continue;
        if (atAiWar.has(allyId) || save.conqueredCountryIds.includes(allyId)) continue;
        if (allyWarQueue.some(w => w.attackerId === allyId)) continue;
        allyWarQueue.push({ attackerId: allyId, defenderId: neighbor.id, startedTurn: save.turn });
      }
    }
  }

  // --- AI-AI savaşları: yıpranma ve bitiş ---
  const survivingAiWars: AiWar[] = [];
  for (const w of aiWars) {
    const aBase = getCountryStats(w.attackerId, save.difficulty).military;
    const dBase = getCountryStats(w.defenderId, save.difficulty).military;
    aiMilitary[w.attackerId] = (aiMilitary[w.attackerId] ?? aBase) * (1 - AI_WAR_ATTRITION);
    aiMilitary[w.defenderId] = (aiMilitary[w.defenderId] ?? dBase) * (1 - AI_WAR_ATTRITION);

    const timedOut = save.turn - w.startedTurn >= AI_WAR_MAX_TURNS;
    const someoneBroke = aiMilitary[w.attackerId] < aBase * AI_WAR_SURRENDER
      || aiMilitary[w.defenderId] < dBase * AI_WAR_SURRENDER;

    if (timedOut || someoneBroke) {
      events.push({ type: 'peace', message: `${nameOf(w.attackerId)} – ${nameOf(w.defenderId)} savaşı sona erdi. İki ordu da yıprandı.` });
    } else {
      survivingAiWars.push(w);
    }
  }

  // --- Yeni AI-AI savaşları patlak verebilir ---
  if (save.turn > settings.graceTurns) {
    for (const [a, d] of AI_RIVAL_PAIRS) {
      const isBusy = (id: string) =>
        save.conqueredCountryIds.includes(id)
        || survivingAiWars.some(x => x.attackerId === id || x.defenderId === id)
        || wars.some(x => x.countryId === id);
      if (isBusy(a) || isBusy(d)) continue;
      if (Math.random() < AI_WAR_CHANCE) {
        survivingAiWars.push({ attackerId: a, defenderId: d, startedTurn: save.turn });
        events.push({ type: 'battle', message: `${nameOf(a)}, ${nameOf(d)}'e savaş ilan etti! İki komşu da yıpranacak.` });
      }
    }
  }

  // --- Müttefik desteği: oyuncuya saldırana müttefikler cephe açar ---
  for (const w of allyWarQueue) {
    const busy = survivingAiWars.some(x =>
      x.attackerId === w.attackerId || x.defenderId === w.attackerId);
    if (busy) continue;
    survivingAiWars.push(w);
    events.push({ type: 'battle', message: `🤝 Müttefikin ${nameOf(w.attackerId)}, ${nameOf(w.defenderId)}'e savaş açtı — saldırıya karşılık veriyor!` });
  }

  return {
    save: { ...save, aiMilitary, aiEconomy, enemyProvinceStrength, wars, aiWars: survivingAiWars, relations, tradeDeals },
    events,
  };
}
