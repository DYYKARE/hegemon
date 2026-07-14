// Graph tabanlı tur çözümleme motoru.
//
// SAF FONKSİYON sözleşmesi (Web Worker'a taşınabilirlik şartı):
//  - Girdiler asla mutate edilmez; yeni ProvinceMap üretilir.
//  - React'e, DOM'a, global state'e dokunmaz.
//  - Rastgelelik dışarıdan enjekte edilir (rng parametresi) — testte deterministik,
//    worker'da senkron kalır.
//
// Çözümleme fazları:
//  1. Emir doğrulama + birlik ayırma (kilitleme)
//  2. Muharebeler — TÜM güçler tur BAŞI anlık görüntüsünden hesaplanır (eşzamanlılık),
//     sonuçlar toplu uygulanır
//  3. MOVE varışları
//  4. Side-effect'ler: nüfus artışı + gelir
//  5. Tek TurnResolutionResult dönüşü

import {
  Army, BattleResult, MilitaryOrder, Province, ProvinceMap,
  TerrainType, TurnOrders, TurnResolutionResult,
} from './types';

// --- Denge sabitleri (bkz. docs/savas-matematigi.md — yeni bölüm eklenecek) ---

export const LAND_ATTACK: Record<'asker' | 'tank', number> = { asker: 1, tank: 150 };
export const LAND_DEFENSE: Record<'asker' | 'tank', number> = { asker: 1.5, tank: 80 };
export const FORT_DEFENSE = 900;        // kara_savunma başına savunma gücü
export const AIR_COMBAT_POWER = 2_500;  // uçak başına hava muharebe gücü
export const BOMBARDMENT_POWER = 4_000; // uçak başına yer bombardıman gücü
export const AA_UNIT_POWER = 2_500;     // AA bataryası başına güç
export const AIR_LOSS_RATE = 0.15;      // hava fazında uçak kayıp hızı

// Eşik modeli
export const DECISIVE_RATIO = 1.5;  // R >= 1.5 → il tek turda düşer
export const REPEL_RATIO = 0.8;     // R <= 0.8 → taarruz kırılır

export const DECISIVE_DEFENDER_LOSS = 0.8;  // kesin zaferde savunmacının imha oranı; kalan %20 çekilir
export const BASE_ATTRITION = 0.10;         // yıpratma savaşında taban hasar oranı (birlik sayısına uygulanır)
export const FAILED_ATTACKER_LOSS = 0.25;   // başarısız taarruzda saldıran kaybı
export const FAILED_DEFENDER_LOSS = 0.03;   // başarısız taarruzda savunan kaybı (minimum)
export const DECISIVE_ATTACKER_LOSS = 0.05; // kesin zafer bile bedava değil

// Emre bağlanan (kilitli) birlikler kaynak ilin savunmasına ancak bu çarpanla katılır.
export const COMMITTED_DEFENSE_FACTOR = 0.25;

// Karşılaşma muharebesi (Faz 1.5): A→B ve B→A taarruzları birbirinin yanından
// geçip "kale takası" yapamaz — kuvvetler önce SINIRDA çarpışır.
export const FIELD_WINNER_LOSS = 0.10; // sınırı yaran (kazanan) tarafın kaybı
export const FIELD_LOSER_LOSS = 0.60;  // kırılan tarafın kaybı; sağ kalan evine çekilir
export const FIELD_ATTRITION = 0.20;   // dengeli karşılaşmada taban kayıp (iki yönlü, √oran ölçekli)

// Arazi savunma çarpanları — Pdef bu çarpanla ölçeklenir
export const TERRAIN_DEFENSE_BONUS: Record<TerrainType, number> = {
  ova: 1.0, kiyi: 1.0, orman: 1.15, sehir: 1.25, dag: 1.4,
};

export const POP_GROWTH_RATE = 0.002; // tur başına nüfus artışı

// --- Army yardımcıları (hepsi saf) ---

export const EMPTY_ARMY: Army = { asker: 0, tank: 0, ucak: 0 };

const cloneArmy = (a: Army): Army => ({ asker: a.asker, tank: a.tank, ucak: a.ucak });

const addArmy = (a: Army, b: Army): Army => ({
  asker: a.asker + b.asker, tank: a.tank + b.tank, ucak: a.ucak + b.ucak,
});

const subArmy = (a: Army, b: Army): Army => ({
  asker: Math.max(0, a.asker - b.asker),
  tank: Math.max(0, a.tank - b.tank),
  ucak: Math.max(0, a.ucak - b.ucak),
});

const scaleArmy = (a: Army, f: number): Army => ({
  asker: Math.floor(a.asker * f), tank: Math.floor(a.tank * f), ucak: Math.floor(a.ucak * f),
});

const hasUnits = (a: Army): boolean => a.asker > 0 || a.tank > 0 || a.ucak > 0;

// Talebi mevcutla sınırla — emir, ilde olmayan birliği götüremez
const clampToAvailable = (req: Army, avail: Army): Army => ({
  asker: Math.min(Math.max(0, req.asker), avail.asker),
  tank: Math.min(Math.max(0, req.tank), avail.tank),
  ucak: Math.min(Math.max(0, req.ucak), avail.ucak),
});

// --- Güç hesapları ---

export function landAttackPower(a: Army): number {
  return a.asker * LAND_ATTACK.asker + a.tank * LAND_ATTACK.tank;
}

export function landDefensePower(a: Army): number {
  return a.asker * LAND_DEFENSE.asker + a.tank * LAND_DEFENSE.tank;
}

// Hava fazı: saldıranın uçakları, savunanın uçak + AA gücüne karşı üstünlük kurar.
// Etkinlik oranı bombardımanı kırpar; kaybedilen uçak sayısı da buradan çıkar.
// (Dışa açık: UI'daki emir önizlemesi aynı formülü kullanır — motor ve gösterge sapmaz.)
export function airSupport(attacker: Army, defender: Army, defenderAA: number): {
  bombardment: number;
  attackerPlanesLost: number;
} {
  if (attacker.ucak <= 0) return { bombardment: 0, attackerPlanesLost: 0 };
  const atkAir = attacker.ucak * AIR_COMBAT_POWER;
  const defAir = defender.ucak * AIR_COMBAT_POWER + defenderAA * AA_UNIT_POWER;
  const airEff = atkAir / (atkAir + defAir);
  const attackerPlanesLost = Math.floor(attacker.ucak * (1 - airEff) * AIR_LOSS_RATE);
  return {
    bombardment: (attacker.ucak - attackerPlanesLost) * BOMBARDMENT_POWER * airEff,
    attackerPlanesLost,
  };
}

// --- İç yapılar ---

// Doğrulanmış ve kaynağından AYRILMIŞ emir: birlikler artık "yolda/kilitli".
interface Commitment {
  order: MilitaryOrder;
  units: Army; // clamp edilmiş fiili kuvvet
}

// Aynı hedefe aynı tarafın yaptığı taarruzlar tek muharebede birleşir
interface BattleGroup {
  targetId: string;
  attackerId: string;
  commitments: Commitment[];
}

// --- Ana çözümleyici ---

export interface ResolveOptions {
  // Taraf bazlı güç çarpanı (ör. oyuncunun mutluluk çarpanı): Patk ve Pdef
  // hesaplanırken ilgili tarafın gücü bu katsayıyla ölçeklenir.
  powerMult?: Record<string, number>;
}

export function resolveTurn(
  currentProvinces: ProvinceMap,
  turnOrders: TurnOrders,
  rng: () => number = Math.random,
  options: ResolveOptions = {}
): TurnResolutionResult {
  const multOf = (ownerId: string) => options.powerMult?.[ownerId] ?? 1;
  // Taslak: her il ve iç objeleri kopyalanır — input dokunulmadan kalır
  const draft: ProvinceMap = {};
  for (const [id, p] of Object.entries(currentProvinces)) {
    draft[id] = { ...p, army: cloneArmy(p.army), defenses: { ...p.defenses }, neighbors: [...p.neighbors] };
  }

  const battles: BattleResult[] = [];
  const rejectedOrders: MilitaryOrder[] = [];
  const events: string[] = [];

  // ============ FAZ 1 — Emir doğrulama ve birlik kilitleme ============
  // Geçerli emrin birlikleri kaynaktan hemen düşülür; savunma hesabına
  // COMMITTED_DEFENSE_FACTOR üzerinden sınırlı katkı verirler (aşağıda).

  const moves: Commitment[] = [];
  const attackGroups = new Map<string, BattleGroup>(); // key: `${targetId}|${attackerId}`
  const committedByProvince: Record<string, Army> = {}; // kaynak il → kilitli kuvvet

  for (const order of turnOrders.orders) {
    const from = draft[order.from];
    const to = draft[order.to];

    // Hava akını: yalnız uçak içeren ATTACK emri MENZİL TANIMAZ — komşuluk aranmaz
    // (uçaklar üsten kalkıp herhangi bir düşman bölgesini bombalar). Kara birliği
    // içeren emir yalnız edge üstünde (bitişik bölgeye) yürüyebilir.
    const isAirRaid = order.type === 'ATTACK'
      && order.units.asker <= 0 && order.units.tank <= 0 && order.units.ucak > 0;

    const invalid =
      !from || !to ||
      from.ownerId !== order.issuedBy ||          // sadece kendi ilinden emir verilir
      (!isAirRaid && !from.neighbors.includes(order.to)) || // kara hareketi yalnız edge üstünde
      (order.type === 'ATTACK') !== (to.ownerId !== order.issuedBy); // ATTACK düşmana, MOVE dosta

    if (invalid) { rejectedOrders.push(order); continue; }

    const units = clampToAvailable(order.units, from.army);
    if (!hasUnits(units)) { rejectedOrders.push(order); continue; }

    // Kilitleme: birlikler ilden ayrılır
    from.army = subArmy(from.army, units);
    committedByProvince[order.from] = addArmy(committedByProvince[order.from] ?? EMPTY_ARMY, units);

    const commitment: Commitment = { order, units };
    if (order.type === 'MOVE') {
      moves.push(commitment);
    } else {
      const key = `${order.to}|${order.issuedBy}`;
      const group = attackGroups.get(key)
        ?? { targetId: order.to, attackerId: order.issuedBy, commitments: [] };
      group.commitments.push(commitment);
      attackGroups.set(key, group);
    }
  }

  // ============ FAZ 1.5 — Karşılaşma muharebeleri (kesişen taarruzlar) ============
  // X→Y ve Y→X aynı turda taarruz ederse iki ordu aynı sınırdan geçiyordur:
  // birbirinin yanından süzülüp şehirleri değiş tokuş edemezler. Kuvvetler önce
  // AÇIK ARAZİDE (tahkimat/arazi bonusu yok) çarpışır:
  //  - R ≥ 1.5  → kazanan %10 kayıpla taarruzuna DEVAM eder; kaybedenin %60'ı
  //               imha olur, sağ kalanı kaynağına çekilip TAM güçle savunur.
  //  - 0.8<R<1.5→ iki taraf da ağır yıpranır (FIELD_ATTRITION·√oran), İKİ taarruz
  //               da sınırda kilitlenir: sağ kalanlar evlerine döner.
  //  - Hava akınları kesişmez (üstten uçar); yalnız kara kuvvetli emirler çarpışır.
  {
    // Sağ kalanları kaynağına iade et; emri tüketilmiş say (grup temizliği aşağıda)
    const returnToSource = (c: Commitment, survivors: Army) => {
      draft[c.order.from].army = addArmy(draft[c.order.from].army, survivors);
      committedByProvince[c.order.from] = subArmy(committedByProvince[c.order.from] ?? EMPTY_ARMY, c.units);
      c.units = EMPTY_ARMY;
    };
    // Kazanan azalan kuvvetle yürür; kilit kaydından yalnız kayıplar düşülür
    const continueWith = (c: Commitment, survivors: Army) => {
      const losses = subArmy(c.units, survivors);
      committedByProvince[c.order.from] = subArmy(committedByProvince[c.order.from] ?? EMPTY_ARMY, losses);
      c.units = survivors;
    };

    const engaged = new Set<Commitment>();
    for (const g1 of attackGroups.values()) {
      for (const c1 of g1.commitments) {
        if (engaged.has(c1) || !hasUnits(c1.units)) continue;
        const X = c1.order.from, Y = c1.order.to;
        // Karşı yönde emir: Y'den X'e taarruz eden bir kuvvet var mı?
        let c2: Commitment | undefined;
        for (const g2 of attackGroups.values()) {
          if (g2.targetId !== X) continue;
          c2 = g2.commitments.find(c => c.order.from === Y && !engaged.has(c) && hasUnits(c.units));
          if (c2) break;
        }
        if (!c2) continue;
        const ground1 = c1.units.asker > 0 || c1.units.tank > 0;
        const ground2 = c2.units.asker > 0 || c2.units.tank > 0;
        if (!ground1 || !ground2) continue; // hava akını kesişmez
        engaged.add(c1); engaged.add(c2);

        const p1 = landAttackPower(c1.units) * multOf(c1.order.issuedBy);
        const p2 = landAttackPower(c2.units) * multOf(c2.order.issuedBy);
        const variance = 0.95 + rng() * 0.1;
        const R = p2 > 0 ? (p1 / p2) * variance : Number.POSITIVE_INFINITY;

        let loss1: number, loss2: number;
        if (R >= DECISIVE_RATIO) { loss1 = FIELD_WINNER_LOSS; loss2 = FIELD_LOSER_LOSS; }
        else if (R <= REPEL_RATIO) { loss1 = FIELD_LOSER_LOSS; loss2 = FIELD_WINNER_LOSS; }
        else {
          loss1 = Math.min(0.5, FIELD_ATTRITION * Math.sqrt(1 / R));
          loss2 = Math.min(0.5, FIELD_ATTRITION * Math.sqrt(R));
        }
        const losses1 = scaleArmy(c1.units, loss1);
        const losses2 = scaleArmy(c2.units, loss2);
        const surv1 = subArmy(c1.units, losses1);
        const surv2 = subArmy(c2.units, losses2);

        battles.push({
          provinceId: Y, // muharebe X↔Y sınırında — rapor kazananın hedefiyle adlanır
          attackerId: c1.order.issuedBy,
          defenderId: c2.order.issuedBy,
          attackPower: Math.round(p1),
          defensePower: Math.round(p2),
          ratio: Number(R.toFixed(2)),
          outcome: 'meeting',
          attackerLosses: losses1,
          defenderLosses: losses2,
        });
        events.push(`${draft[X].name} ↔ ${draft[Y].name} sınırında ordular karşılaştı (R=${R.toFixed(2)})`);

        if (R >= DECISIVE_RATIO) { continueWith(c1, surv1); returnToSource(c2, surv2); }
        else if (R <= REPEL_RATIO) { returnToSource(c1, surv1); continueWith(c2, surv2); }
        else { returnToSource(c1, surv1); returnToSource(c2, surv2); }
      }
    }
    // Tüketilen emirleri ve boşalan grupları ayıkla
    for (const [key, g] of [...attackGroups]) {
      g.commitments = g.commitments.filter(c => hasUnits(c.units));
      if (g.commitments.length === 0) attackGroups.delete(key);
    }
  }

  // ============ FAZ 2 — Muharebeler (eşzamanlı çözüm) ============
  // Tüm Patk/Pdef değerleri FAZ 1 sonrası anlık görüntüden hesaplanır;
  // sahiplik/ordu mutasyonları hesap bittikten sonra uygulanır. Böylece
  // A→B ve B→A karşılıklı taarruzları emir sırasından bağımsız ve adil çözülür.

  interface PendingResolution {
    battle: BattleResult;
    group: BattleGroup;
    survivorsByCommitment: Army[]; // taarruzdan sağ çıkanlar (kaynak başına)
    defenderRemnant: Army;         // savunandan geriye kalan
    captured: boolean;
  }
  const pending: PendingResolution[] = [];

  for (const group of attackGroups.values()) {
    const target = draft[group.targetId];

    // Birleşik taarruz kuvveti
    let force = EMPTY_ARMY;
    for (const c of group.commitments) force = addArmy(force, c.units);

    // Savunma kuvveti: garnizon TAM, o ilden emre bağlanmış (kilitli) birlikler KISITLI
    const committed = committedByProvince[group.targetId] ?? EMPTY_ARMY;
    const { bombardment, attackerPlanesLost } = airSupport(force, addArmy(target.army, committed), target.defenses.hava_savunma);

    const pAtk = (landAttackPower(force) + bombardment) * multOf(group.attackerId);
    const pDef = (
      landDefensePower(target.army)
      + landDefensePower(committed) * COMMITTED_DEFENSE_FACTOR
      + target.defenses.kara_savunma * FORT_DEFENSE
    ) * TERRAIN_DEFENSE_BONUS[target.terrain] * multOf(target.ownerId);

    // Küçük varyans: aynı R'de her savaş milimetrik aynı sonuçlanmasın (±%5)
    const variance = 0.95 + rng() * 0.1;
    const R = pDef > 0 ? (pAtk / pDef) * variance : Number.POSITIVE_INFINITY;

    let attackerLossRate: number;
    let defenderLossRate: number;
    let outcome: BattleResult['outcome'];
    let captured = false;

    // Toprağı yalnız KARA birliği tutabilir: sadece uçakla yapılan akın
    // (hava akını) bölgeyi ele geçiremez — üstün olsa bile ağır hasar verip döner.
    const hasGroundForce = force.asker > 0 || force.tank > 0;

    if (R >= DECISIVE_RATIO && hasGroundForce) {
      // Kesin Zafer: il düşer, savunmanın %80'i imha, %20'si çekilir
      outcome = 'decisive';
      captured = true;
      attackerLossRate = DECISIVE_ATTACKER_LOSS;
      defenderLossRate = DECISIVE_DEFENDER_LOSS;
    } else if (R > REPEL_RATIO) {
      // Yıpratma: il el değiştirmez. Şartname formülü: Zayiat = Taban Hasar * sqrt(R).
      // Savunan, saldıranın göreli gücüyle (R) yıpranır; saldıran da savunanın
      // göreli gücüyle (1/R) — aynı formülün iki yönlü uygulanışı.
      outcome = 'attrition';
      defenderLossRate = Math.min(0.5, BASE_ATTRITION * Math.sqrt(R));
      attackerLossRate = Math.min(0.5, BASE_ATTRITION * Math.sqrt(1 / R));
    } else {
      // Başarısız Taarruz: saldıran ağır, savunan minimum zayiat
      outcome = 'repelled';
      attackerLossRate = FAILED_ATTACKER_LOSS;
      defenderLossRate = FAILED_DEFENDER_LOSS;
    }

    // Zayiatlar: hava kaybı hava fazından, kara kaybı orana göre
    const attackerLosses: Army = {
      asker: Math.floor(force.asker * attackerLossRate),
      tank: Math.floor(force.tank * attackerLossRate),
      ucak: attackerPlanesLost,
    };
    const defenderTotal = addArmy(target.army, EMPTY_ARMY);
    const defenderLosses = scaleArmy(defenderTotal, defenderLossRate);

    const survivors = subArmy(force, attackerLosses);
    // Sağ kalanları katkı oranında kaynaklara dağıt (repelled/attrition dönüşü için)
    const forceTotalUnits = force.asker + force.tank + force.ucak || 1;
    const survivorsByCommitment = group.commitments.map(c => {
      const share = (c.units.asker + c.units.tank + c.units.ucak) / forceTotalUnits;
      return scaleArmy(survivors, share);
    });

    pending.push({
      battle: {
        provinceId: group.targetId,
        attackerId: group.attackerId,
        defenderId: target.ownerId,
        attackPower: Math.round(pAtk),
        defensePower: Math.round(pDef),
        ratio: Number(R.toFixed(2)),
        outcome,
        attackerLosses,
        defenderLosses,
      },
      group,
      survivorsByCommitment,
      defenderRemnant: subArmy(defenderTotal, defenderLosses),
      captured,
    });
  }

  // Sonuçları uygula. Aynı ili birden fazla taraf ele geçirdiyse en yüksek R kazanır.
  pending.sort((a, b) => b.battle.ratio - a.battle.ratio);
  const capturedThisTurn = new Set<string>();

  for (const res of pending) {
    const { battle, group, survivorsByCommitment, defenderRemnant } = res;
    const target = draft[battle.provinceId];

    if (res.captured && !capturedThisTurn.has(battle.provinceId)) {
      capturedThisTurn.add(battle.provinceId);

      // Savunma artığı (%20) dost komşuya çekilir; çekilecek yer yoksa imha olur
      const retreatId = target.neighbors.find(
        nId => draft[nId]?.ownerId === battle.defenderId && !capturedThisTurn.has(nId)
      );
      if (retreatId && hasUnits(defenderRemnant)) {
        draft[retreatId].army = addArmy(draft[retreatId].army, defenderRemnant);
        battle.retreatedTo = retreatId;
      }

      // Saldıran ordu bölgeye yerleşir; il el değiştirir
      target.ownerId = battle.attackerId;
      let occupying = EMPTY_ARMY;
      for (const s of survivorsByCommitment) occupying = addArmy(occupying, s);
      target.army = occupying;
      events.push(`${target.name} düştü — yeni sahibi: ${battle.attackerId}`);
    } else {
      // İl el değiştirmedi (attrition/repelled ya da başka taarruz ili zaten aldı):
      // savunan zayiatını yer, sağ kalan saldırganlar kaynak illerine döner
      target.army = subArmy(target.army, battle.defenderLosses);
      group.commitments.forEach((c, i) => {
        const back = survivorsByCommitment[i];
        if (hasUnits(back)) draft[c.order.from].army = addArmy(draft[c.order.from].army, back);
      });
      if (battle.outcome === 'repelled') {
        events.push(`${target.name} taarruzu kırıldı (R=${battle.ratio})`);
      }
    }

    battles.push(battle);
  }

  // ============ FAZ 3 — MOVE varışları ============
  // Hedef hâlâ dost ise birlikler varır; tur içinde düşman eline geçtiyse
  // emir "geri döner" (kaynağa iade).
  for (const move of moves) {
    const dest = draft[move.order.to];
    const arriveAt = dest.ownerId === move.order.issuedBy ? move.order.to : move.order.from;
    draft[arriveAt].army = addArmy(draft[arriveAt].army, move.units);
  }

  // ============ FAZ 4 — Side-effect'ler (nüfus + gelir) ============
  const incomeByOwner: Record<string, number> = {};
  for (const p of Object.values(draft)) {
    p.population = Math.floor(p.population * (1 + POP_GROWTH_RATE));
    incomeByOwner[p.ownerId] = (incomeByOwner[p.ownerId] ?? 0) + p.baseIncome;
  }

  // ============ FAZ 5 — Tek batch dönüş ============
  return { provinces: draft, battles, incomeByOwner, rejectedOrders, events };
}
