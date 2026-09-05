// Headless denge simülasyonu — Hegemon motoru Node'da koşulur.
// npx tsx sim.ts [1|2|3|4|5|all]
import fs from 'node:fs';
import path from 'node:path';
import * as topojson from 'topojson-client';

// localStorage stub (settings.ts / save.ts erişir)
const mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v; },
  removeItem: (k: string) => { delete mem[k]; },
};

const ROOT = new URL('..', import.meta.url).pathname;

import { setWorldGeo, countryRegions } from '../src/engine/activeWorld';
import { newGame, advanceTurn, loadSlot } from '../src/engine/save';
import { startWar, computeTotalAttackPower } from '../src/engine/combat';
import {
  queueAttackOrders, previewAttack, attackSources, countryRemainingStrength,
  retreatFromWar, warProvinceProgress, victoryAchieved,
} from '../src/engine/mapWar';
import { computeIncome, UNIT_COSTS, totalPopulation } from '../src/engine/economy';
import { sendUltimatum } from '../src/engine/diplomacy';
import { getAiMilitary } from '../src/engine/ai';
import type { GameSave } from '../src/engine/types';
import type { Army, Province, ProvinceMap } from '../src/engine/frontline/types';
import { resolveTurn } from '../src/engine/frontline/resolveTurn';

const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/countries-50m.json'), 'utf8'));
setWorldGeo(topojson.feature(world, world.objects.countries));

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
};

function header(t: string) { console.log('\n' + '='.repeat(70) + '\n' + t + '\n' + '='.repeat(70)); }

// ---------------------------------------------------------------------------
// SENARYO 1 — PASİF OYUNCU (Türkiye, orta): 120 tur hiçbir şey yapma
// ---------------------------------------------------------------------------
function scenarioPassive() {
  header('S1 PASİF (Türkiye · orta · 120 tur): hiçbir eylem yok');
  let s = newGame('orta', '792');
  let warsDeclared = 0; let occupiedMax = 0;
  for (let t = 0; t < 120; t++) {
    const r = advanceTurn(s);
    s = r.save;
    for (const e of r.events) if (e.message.includes('savaş ilan etti')) warsDeclared++;
    occupiedMax = Math.max(occupiedMax, Object.keys(s.occupiedProvinces).length);
    if ([10, 20, 40, 60, 80, 120].includes(s.turn)) {
      console.log(`tur ${String(s.turn).padStart(3)} | para ${fmt(s.money).padStart(7)} | gelir ${fmt(computeIncome(s)).padStart(7)} | mutluluk ${s.happiness.toFixed(0)} | nüfus ${fmt(totalPopulation(s))} | aktif savaş ${s.wars.length} | işgal ${Object.keys(s.occupiedProvinces).length}`);
    }
  }
  console.log(`AI savaş ilanı: ${warsDeclared} · en çok işgal edilen bölge: ${occupiedMax}`);
}

// ---------------------------------------------------------------------------
// SENARYO 2 — SAF EKONOMİ: her tur tüm parayı sanayiye dağıt (bölgelere eşit)
// ---------------------------------------------------------------------------
function scenarioEcon() {
  header('S2 SAF EKONOMİ (Türkiye · orta): tüm para sanayiye');
  let s = newGame('orta', '792');
  const regs = countryRegions('792');
  for (let t = 0; t < 120; t++) {
    const per = Math.floor(s.money / regs.length);
    if (per > 0) {
      const inv = { ...s.provinceInvestments };
      for (const rid of regs) inv[rid] = { ...(inv[rid] || {}), sanayi: (inv[rid]?.sanayi || 0) + per };
      s = { ...s, money: s.money - per * regs.length, provinceInvestments: inv };
    }
    s = advanceTurn(s).save;
    if ([10, 30, 50, 80, 120].includes(s.turn)) {
      console.log(`tur ${String(s.turn).padStart(3)} | gelir ${fmt(computeIncome(s)).padStart(7)}/tur | mutluluk ${s.happiness.toFixed(0)} | İran ordusu ${fmt(getAiMilitary(s, '364'))} | işgal ${Object.keys(s.occupiedProvinces).length} | savaş ${s.wars.length}`);
    }
  }
}

// ---------------------------------------------------------------------------
// SENARYO 3 — ERKEN RUSH (Ermenistan)
// ---------------------------------------------------------------------------
function buildArmy(s: GameSave, rid: string, units: Record<string, number>): GameSave {
  let cost = 0;
  for (const [u, n] of Object.entries(units)) cost += (UNIT_COSTS[u] || 0) * n;
  if (cost > s.money) throw new Error('para yetmez: ' + fmt(cost));
  const pu = { ...s.provinceUnits, [rid]: { ...(s.provinceUnits[rid] || {}) } };
  const inv = { ...s.provinceInvestments };
  for (const [u, n] of Object.entries(units)) pu[rid][u] = (pu[rid][u] || 0) + n;
  if (units.asker) {
    const pop = inv[rid]?.nufus || 0;
    if (units.asker > pop) throw new Error('nüfus yetmez');
    inv[rid] = { ...inv[rid], nufus: pop - units.asker };
  }
  return { ...s, money: s.money - cost, provinceUnits: pu, provinceInvestments: inv };
}

function driveAttacks(s: GameSave, cid: string): GameSave {
  const targets = countryRegions(cid)
    .filter(r => !(s.capturedEnemyProvinces ?? []).includes(r))
    .sort((a, b) => (s.enemyProvinceStrength[a] ?? 0) - (s.enemyProvinceStrength[b] ?? 0));
  const used = new Set<string>();
  for (const tgt of targets) {
    const sources = attackSources(s, tgt).filter(x => !used.has(x));
    if (sources.length === 0) continue;
    const commits: Record<string, Army> = {};
    for (const src of sources) {
      const u = s.provinceUnits[src];
      if (!u) continue;
      const a: Army = { asker: u.asker || 0, tank: u.tank || 0, ucak: u.ucak || 0 };
      if (a.asker + a.tank + a.ucak === 0) continue;
      commits[src] = a;
    }
    if (Object.keys(commits).length === 0) continue;
    const pv = previewAttack(s, tgt, commits);
    if (!pv || pv.outcomeAfter === 'repelled') continue;
    for (const k of Object.keys(commits)) used.add(k);
    s = queueAttackOrders(s, tgt, commits);
  }
  return s;
}

function scenarioRush() {
  header('S3 ERKEN RUSH (Türkiye · orta): $4.2B ordu → Ermenistan tur 1 savaş');
  let s = newGame('orta', '792');
  const armRegs = countryRegions('051');
  const myBorder = new Set<string>();
  for (const r of armRegs) for (const src of attackSources(s, r)) myBorder.add(src);
  const border = [...myBorder];
  console.log('sınır illeri:', border.join(', '), '· Ermenistan bölge sayısı:', armRegs.length);
  s = buildArmy(s, border[0], { tank: 600, asker: 20000 });
  s = startWar(s, '051', 'Ermenistan');
  console.log(`tur ${s.turn}: savaş ilan · düşman toplam ${fmt(countryRemainingStrength(s, '051'))}`);
  for (let t = 0; t < 20 && !s.conqueredCountryIds.includes('051'); t++) {
    s = driveAttacks(s, '051');
    s = advanceTurn(s).save;
    const prog = warProvinceProgress(s, '051');
    console.log(`tur ${String(s.turn).padStart(2)} | ele geçirilen ${prog.captured}/${prog.total} | düşman gücü ${fmt(countryRemainingStrength(s, '051'))} | ordumuz ${fmt(computeTotalAttackPower(s, 1))} | para ${fmt(s.money)}`);
  }
  console.log(`fetih: ${s.conqueredCountryIds.includes('051')} (tur ${s.turn}) · gelir ${fmt(computeIncome(s))}/tur · zafer: ${victoryAchieved(s)}`);
}

// ---------------------------------------------------------------------------
// SENARYO 4 — EXPLOIT: savaş ilanı + anında geri çekilme = ateşkes kalkanı?
// ---------------------------------------------------------------------------
function scenarioRetreatShield() {
  header('S4 REGRESYON — İlan + anında Geri Çekil ateşkes KALKANI vermemeli');
  let s = newGame('orta', '792');
  s = { ...s, turn: 20 };
  s = startWar(s, '364', 'İran');
  const instant = retreatFromWar(s, '364');
  const instantTruce = (instant.truces['364'] ?? 0) > instant.turn;
  console.log(`anında geri çekilme → ateşkes ${instantTruce ? 'VAR (❌ exploit açık!)' : 'yok (✅ beklenen)'}`);
  // 3+ tur süren gerçek savaşta ateşkes normal şekilde doğmalı
  const fought = retreatFromWar({ ...s, turn: s.turn + 3 }, '364');
  const foughtTruce = (fought.truces['364'] ?? 0) - fought.turn;
  console.log(`3 tur savaşılmış geri çekilme → ateşkes ${foughtTruce} tur ${foughtTruce === 15 ? '(✅ beklenen 15)' : '(❌ beklenen 15)'}`);
}

// ---------------------------------------------------------------------------
// SENARYO 5 — EXPLOIT: fethedilmiş ülkeye ültimatom (haraç)
// ---------------------------------------------------------------------------
function scenarioUltimatumConquered() {
  header('S5 REGRESYON — Fethedilmiş ülkeye ültimatom reddedilmeli');
  let s = newGame('orta', '792');
  s = { ...s, conqueredCountryIds: ['051'], money: 1000 };
  const r = sendUltimatum(s, '051', 10_000_000);
  if (r) console.log(`❌ EXPLOIT AÇIK: fethedilmiş Ermenistan'dan haraç alındı → para ${fmt(r.money)}`);
  else console.log('✅ motor reddetti (fethedilmiş ülkeden haraç yok)');
}

// ---------------------------------------------------------------------------
// SENARYO 6 — REGRESYON: kaynağı ve hedefi aynı turda düşen birlikler
// düşman garnizonuna KATILMAMALI (dost komşuya çekilmeli)
// ---------------------------------------------------------------------------
function scenarioReturnUnits() {
  header('S6 REGRESYON — Düşen kaynağa dönen birlikler düşmana katılmamalı');
  const P = 'player', E = 'enemy';
  const prov = (id: string, owner: string, army: Partial<Army>, neighbors: string[]): Province => ({
    id, name: id, ownerId: owner, neighbors, terrain: 'ova',
    army: { asker: 0, tank: 0, ucak: 0, ...army },
    defenses: { kara_savunma: 0, hava_savunma: 0 },
    population: 0, baseIncome: 0,
  });
  const graph: ProvinceMap = {
    A: prov('A', P, { asker: 1000 }, ['B', 'C', 'E5']),
    B: prov('B', P, { asker: 10 }, ['A', 'D']),
    C: prov('C', E, { asker: 500_000 }, ['A']),
    D: prov('D', E, { asker: 500_000 }, ['B']),
    E5: prov('E5', P, { asker: 10 }, ['A']),
  };
  const orders = [
    { id: 'm1', type: 'MOVE' as const, issuedBy: P, from: 'A', to: 'B', units: { asker: 1000, tank: 0, ucak: 0 } },
    { id: 'a1', type: 'ATTACK' as const, issuedBy: E, from: 'C', to: 'A', units: { asker: 400_000, tank: 0, ucak: 0 } },
    { id: 'a2', type: 'ATTACK' as const, issuedBy: E, from: 'D', to: 'B', units: { asker: 400_000, tank: 0, ucak: 0 } },
  ];
  const res = resolveTurn(graph, { turn: 1, orders }, () => 0.5);
  const aOwner = res.provinces.A.ownerId, bOwner = res.provinces.B.ownerId;
  const refugeArmy = res.provinces.E5.army.asker;
  console.log(`A sahibi: ${aOwner} · B sahibi: ${bOwner} (ikisi de düşman olmalı)`);
  console.log(`E5 (dost sığınak) asker: ${refugeArmy} → ${refugeArmy >= 1000 ? '✅ birlikler dosta çekildi' : '❌ birlikler kayıp/düşmana gitti'}`);
}

// ---------------------------------------------------------------------------
// SENARYO 7 — REGRESYON: eski HAVUZ savaşlı kayıt 'harita'ya göçmeli
// (havuz modeli söküldü — legacy alanlar atılır, cephe ordusu yurda döner,
// düşman direnci %70 garnizon + %30 anavatan olarak bölünür)
// ---------------------------------------------------------------------------
function scenarioPoolMigration() {
  header('S7 REGRESYON — Havuz savaşlı eski kayıt harita modeline göçer');
  const base = newGame('orta', '792');
  const legacySave = {
    ...base,
    wars: [{
      countryId: '364', countryName: 'İran',
      enemyStrength: 100_000, enemyMaxStrength: 120_000,
      startedTurn: 1, lastPlayerLoss: 0, lastEnemyLoss: 0,
      initiator: 'player', warType: 'topyekun',
      front: { asker: 5_000, tank: 20, ucak: 3 },
      deployedUnits: { 'tr-6': { asker: 1 } },
    }],
  };
  localStorage.setItem('hegemon_slot_test1', JSON.stringify(legacySave));
  localStorage.setItem('hegemon_slots_v1', JSON.stringify([{
    id: 'test1', countryId: '792', turn: 1, difficulty: 'orta',
    mapLayout: base.mapLayout, playerColor: '#1d4ed8', conquests: 0, updatedAt: Date.now(),
  }]));
  const migrated = loadSlot('test1');
  if (!migrated) { console.log('❌ kayıt yüklenemedi'); return; }
  const w = migrated.wars[0] as unknown as Record<string, unknown>;
  const garrisonSum = countryRegions('364')
    .reduce((t, r) => t + (migrated.enemyProvinceStrength[r] ?? 0), 0);
  const homeAsker = Object.values(migrated.provinceUnits).reduce((t, u) => t + (u.asker ?? 0), 0);
  console.log(`warType: ${w.warType} ${w.warType === 'harita' ? '✅' : '❌'}`);
  console.log(`legacy alanlar atıldı: ${!('front' in w) && !('provinces' in w) && !('deployedUnits' in w) ? '✅' : '❌'}`);
  console.log(`garnizonlar: ${fmt(garrisonSum)} (beklenen ~70K) ${Math.abs(garrisonSum - 70_000) < 100 ? '✅' : '❌'}`);
  console.log(`anavatan rezervi: ${fmt(migrated.aiMilitary['364'] ?? 0)} (beklenen 30K) ${migrated.aiMilitary['364'] === 30_000 ? '✅' : '❌'}`);
  console.log(`cephe ordusu yurda döndü: ${fmt(homeAsker)} asker ${homeAsker === 5_000 ? '✅' : '❌'}`);
}

const arg = process.argv[2] ?? 'all';
if (arg === 'all' || arg === '1') scenarioPassive();
if (arg === 'all' || arg === '2') scenarioEcon();
if (arg === 'all' || arg === '3') scenarioRush();
if (arg === 'all' || arg === '4') scenarioRetreatShield();
if (arg === 'all' || arg === '5') scenarioUltimatumConquered();
if (arg === 'all' || arg === '6') scenarioReturnUnits();
if (arg === 'all' || arg === '7') scenarioPoolMigration();
