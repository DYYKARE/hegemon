import React, { useState, useEffect, useRef } from 'react';
import { WorldMap } from './WorldMap';
import { Stepper } from './Stepper';
import { BattleReportModal } from './BattleReportModal';
import { Swords, Users, MapPin, Plane, Shield, Anchor, Rocket, Castle, Tractor, Factory, Play, Pause, FastForward, SkipForward, Menu, Flag, Save, LogOut, X, Check, DoorOpen, Power, Heart, Coins, Percent, BookOpen, Minus, Plus } from 'lucide-react';
import { GameSave, TurnEvent, War, BattleReport } from '../engine/types';
import { persistSave, advanceTurn } from '../engine/save';
import { UNIT_COSTS, UNIT_LABELS, INVESTMENT_RATES, POP_COST_PER_PERSON, computeIncome, computeUpkeep, totalPopulation, totalPopulationGrowth, warWeariness, formatMoney, formatCount, happinessMultiplier, happinessEmoji, getAiEconomy, conqueredCountryIncome, conqueredCountryTotalIncome, conqueredRegionalIncome, investInConquered, CONQUERED_DEV_RATE, disbandUnits, SALVAGE_RATE, effectiveInvestment, armyFoodRatio, armyFoodSupply, armyFoodDemand, totalAskerCount, INVESTMENT_SOFT_CAP, POP_TAX_PER_CAPITA, TRADE_INCOME_SHARE, popGrowthRate, POP_GROWTH_RATE, FARM_POP_BONUS_MAX } from '../engine/economy';
import { computeDefensePower, computeTotalAttackPower, computeAAPower, startWar, peaceTerms, signPeace, LAND_ATTACK, LAND_DEFENSE, BOMBARDMENT_POWER } from '../engine/combat';
import { DIFFICULTY_LABELS, getCountryStats } from '../engine/countries';
import { getAiMilitary, getAiWarOpponent, aiMilitaryGrowthPerTurn, attackRiskInfo } from '../engine/ai';
import { diplomacyStatus, sendGift, signPact, formAlliance, signTradeDeal, sendUltimatum, giftRelationGain, giftHint, giftRemainingThisTurn, pactActive, PACT_DURATION, TRADE_MIN_RELATION, PACT_MIN_RELATION, ALLIANCE_MIN_RELATION, GIFT_RELATION_PER_INCOME } from '../engine/diplomacy';
import { canOrderAttack, queueAttackOrders, cancelOrder, countryOfProvince, warProvinceProgress, provinceDisplayName, terrainOf, militiaDefense, getProvinceNeighbors, isPlayerRegion, foreignNeighborCountries, borderRegionsWith, allBorderRegions, canLaunchSeaInvasion, SHIP_CAPACITY, queueTransferOrder, committedUnits, buildBorderDefense, victoryAchieved, evaluateAnnexOffer, applyAnnexOffer, retreatFromWar, ANNEX_ACCEPT_THRESHOLD, RETREAT_HAPPINESS_COST, RETREAT_TRUCE_DURATION, RETREAT_TRUCE_MIN_WAR_TURNS } from '../engine/mapWar';
import { isCoastalRegion, countryRegions } from '../engine/activeWorld';
import { countryName, countryLandNeighborList } from '../engine/mapWar';
import { regionName } from '../engine/activeWorld';
import { Army } from '../engine/frontline/types';
import { AttackOrderModal } from './AttackOrderModal';
import { HowToPlay } from './HowToPlay';
import { exitApplication } from '../platform';

interface GameUIProps {
  initialSave: GameSave;
  onExitToMenu: () => void;
}

type Draft = Record<string, number | string>;

const EMPTY_UNIT_DRAFT: Draft = { asker: '', tank: '', ucak: '', liman: '', gemi: '', hava_savunma: '', kara_savunma: '' };

// HUD sayaçları sıçramak yerine yumuşakça akar (hazine/nüfus değişimleri hissedilir)
function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const [disp, setDisp] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const from = prevRef.current, to = value;
    prevRef.current = to;
    if (from === to) return;
    const t0 = performance.now(), dur = 550;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setDisp(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(Math.round(disp))}</>;
}

// Basılı tutunca hızlanarak tekrar eden buton davranışı (Stepper ile aynı his):
// dokun = 1 adım · 350ms bekle · 110ms'de bir tekrar · 10 tik sonra 4×.
// onClick korunur (klavye erişilebilirliği + otomasyon); pointer oturumunun
// bıraktığı sondaki click yutulur ki adım çift işlemesin. Buton basılıyken
// devre dışı kalırsa pointerup butona düşmez — window'daki tek seferlik
// pointerup dinleyicisi interval sızıntısını her koşulda keser.
function useHoldRepeat(fn: () => void) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const timer = useRef<number | undefined>(undefined);
  const inter = useRef<number | undefined>(undefined);
  const ticks = useRef(0);
  const viaPointer = useRef(false);

  const stop = () => {
    window.clearTimeout(timer.current);
    window.clearInterval(inter.current);
    inter.current = undefined;
    ticks.current = 0;
  };
  useEffect(() => stop, []); // unmount temizliği

  return {
    onPointerDown: () => {
      viaPointer.current = true;
      fnRef.current();
      window.addEventListener('pointerup', stop, { once: true });
      timer.current = window.setTimeout(() => {
        inter.current = window.setInterval(() => {
          ticks.current += 1;
          const mult = ticks.current > 10 ? 4 : 1;
          for (let i = 0; i < mult; i++) fnRef.current();
        }, 110);
      }, 350);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (viaPointer.current) { viaPointer.current = false; return; }
      fnRef.current();
    },
  };
}

// Üst bar detay popover'larının ortak satırı: sol etiket (+ opsiyonel alt açıklama),
// sağda hizalı monospace değer
function DetailRow({ label, value, color = 'text-slate-200', sub }: {
  label: React.ReactNode; value: React.ReactNode; color?: string; sub?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11px] text-slate-400 min-w-0">
        {label}
        {sub && <span className="block text-[9px] text-slate-600">{sub}</span>}
      </span>
      <span className={`text-[11px] font-mono whitespace-nowrap ${color}`}>{value}</span>
    </div>
  );
}

// Popover içi bölüm başlığı (GELİRLER / GİDERLER gibi)
function DetailSection({ title, color = 'text-slate-500', children }: {
  title: React.ReactNode; color?: string; children: React.ReactNode;
}) {
  return (
    <div className="mt-3 first:mt-0">
      <div className={`text-[10px] font-bold uppercase tracking-wide mb-1 ${color}`}>{title}</div>
      {children}
    </div>
  );
}

// Komşunun savaş açma riski — motorla AYNI formül (ai.attackRiskInfo):
// "ansızın saldırı" hissini bitiren öngörü göstergesi. Risk her tur panelde
// okunur; oyuncu tedbirini (tabya, pakt, hediye) savaştan ÖNCE alır.
const RISK_STYLES = {
  dusuk: { text: 'text-green-400', label: 'Düşük' },
  orta: { text: 'text-yellow-400', label: 'Orta' },
  yuksek: { text: 'text-red-400', label: 'Yüksek' },
} as const;

function AttackRiskLine({ save, countryId }: { save: GameSave; countryId: string }) {
  const risk = attackRiskInfo(save, countryId);
  if (risk.blocked) {
    return (
      <div className="bg-slate-950/60 rounded p-2 border border-slate-800 text-[10px] flex justify-between gap-2">
        <span className="text-slate-400 shrink-0">🛡️ Saldırı riski:</span>
        <span className="text-blue-300 text-right">{risk.blocked}</span>
      </div>
    );
  }
  const s = RISK_STYLES[risk.level as keyof typeof RISK_STYLES];
  return (
    <div className="bg-slate-950/60 rounded p-2 border border-slate-800 text-[10px]">
      <div className="flex justify-between">
        <span className="text-slate-400">🎯 Saldırı riski:</span>
        <span className={`font-bold ${s.text}`}>
          {s.label} · ~%{(risk.chance * 100).toFixed(1)}/tur · 10 turda ~%{Math.round(risk.chance10 * 100)}
        </span>
      </div>
      {risk.reasons.length > 0 && (
        <p className="text-[9px] text-slate-500 mt-1 pt-1 border-t border-slate-800/60">
          {risk.reasons.join(' · ')}
        </p>
      )}
    </div>
  );
}

// İkili ilişkiler paneli: ilişki barı, aktif anlaşmalar, diplomatik eylemler.
// key={countryId} ile kullanılır — hedef değişince hediye taslağı sıfırlanır.
function DiplomacyPanel({ save, setSave, countryId, armyPower }: {
  save: GameSave;
  setSave: React.Dispatch<React.SetStateAction<GameSave>>;
  countryId: string;
  armyPower: number;
}) {
  const st = diplomacyStatus(save, countryId, armyPower);
  const income = getAiEconomy(save, countryId).income;
  const [giftAmount, setGiftAmount] = useState(0);
  // Ültimatom iki dokunuşlu onay (geri alınamaz: ilişki −40 kalıcı yara)
  const [ultConfirm, setUltConfirm] = useState(false);
  const ultTimer = useRef<number | undefined>(undefined);
  const giftGain = giftAmount > 0 ? giftRelationGain(save, countryId, giftAmount) : 0;
  const giftAffordable = giftAmount > 0 && giftAmount <= save.money && giftGain >= 1;
  const toneText = st.tone === 'dost' ? 'text-green-400' : st.tone === 'dusman' ? 'text-red-400' : 'text-slate-300';
  const barColor = st.tone === 'dost' ? 'bg-green-500' : st.tone === 'dusman' ? 'bg-red-500' : 'bg-slate-400';
  const apply = (fn: (s: GameSave) => GameSave | null) => setSave(prev => fn(prev) ?? prev);

  // Engeli EYLEME çevrilebilir bilgiye dönüştür: oyuncu "neden olmuyor"la
  // birlikte "ne yaparsam olur"u ve mevcut durumunu görsün.
  const theirMil = getAiMilitary(save, countryId);
  const blockText = (reason?: string): string => {
    if (!reason) return '';
    if (reason.includes('ilişki') && reason.includes('olmalı')) {
      return `${reason} — şu an ${st.relation > 0 ? '+' : ''}${st.relation}. 🎁 Hediyeyle ısıtabilirsin`;
    }
    if (reason === 'hazine yetersiz') return `hazine yetersiz — kasada ${formatMoney(save.money)} var`;
    if (reason.includes('güç üstünlüğü')) {
      return `${reason} — senin gücün ${formatCount(armyPower)}, onunki ${formatCount(theirMil)}`;
    }
    return reason;
  };
  // Ticaretin kendini ödeme süresi: "pahalı mı" sorusunun tek bakışlık cevabı
  const tradeAmorti = st.tradeIncome > 0 ? Math.ceil(st.actions.trade.cost / st.tradeIncome) : 0;

  const actionRows: {
    icon: string; label: string; sub: string; cost: string;
    ok: boolean; reason?: string; active?: boolean; activeText?: string;
    minRelation?: number; run: () => void;
  }[] = [
    {
      icon: '📦', label: 'Ticaret Anlaşması',
      sub: `her tur +${formatMoney(st.tradeIncome)} gelir · kendini ~${tradeAmorti} turda öder, sonrası kâr`,
      cost: formatMoney(st.actions.trade.cost), ok: st.actions.trade.ok, reason: st.actions.trade.reason,
      active: st.trade, activeText: `aktif · +${formatMoney(st.tradeIncome)}/tur`,
      minRelation: TRADE_MIN_RELATION,
      run: () => apply(s => signTradeDeal(s, countryId)),
    },
    {
      icon: '🕊️', label: `Saldırmazlık Paktı`,
      sub: `${PACT_DURATION} tur boyunca İKİ TARAF da saldıramaz — bu sınırı güvene alıp ordunu başka cepheye taşırsın`,
      cost: formatMoney(st.actions.pact.cost), ok: st.actions.pact.ok, reason: st.actions.pact.reason,
      active: st.pactTurnsLeft > 0, activeText: `aktif · ${st.pactTurnsLeft} tur kaldı`,
      minRelation: PACT_MIN_RELATION,
      run: () => apply(s => signPact(s, countryId)),
    },
    {
      icon: '🤝', label: 'İttifak',
      sub: 'kalıcı: asla saldırmaz + SANA savaş açana o da cephe açar — en güçlü caydırıcılık',
      cost: formatMoney(st.actions.alliance.cost), ok: st.actions.alliance.ok, reason: st.actions.alliance.reason,
      active: st.ally, activeText: 'müttefik',
      minRelation: ALLIANCE_MIN_RELATION,
      run: () => apply(s => formAlliance(s, countryId)),
    },
    {
      icon: '💰',
      label: ultConfirm ? 'Ültimatom — Emin misin?' : 'Ültimatom',
      sub: ultConfirm
        ? 'ikinci dokunuş haracı keser · ilişki −40 KALICI yara'
        : `gözdağıyla tek seferlik ${formatMoney(st.actions.ultimatum.cost)} haraç — savaşsız para, ama ilişki −40 kalıcı düşer (düşmanlaşır)`,
      cost: `+${formatMoney(st.actions.ultimatum.cost)}`, ok: st.actions.ultimatum.ok, reason: st.actions.ultimatum.reason,
      run: () => {
        if (!ultConfirm) {
          setUltConfirm(true);
          window.clearTimeout(ultTimer.current);
          ultTimer.current = window.setTimeout(() => setUltConfirm(false), 3000);
          return;
        }
        window.clearTimeout(ultTimer.current);
        setUltConfirm(false);
        apply(s => sendUltimatum(s, countryId, armyPower));
      },
    },
  ];

  return (
    <div className="flex flex-col gap-1.5 bg-slate-950/60 p-2 rounded border border-slate-800">
      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">🌐 DİPLOMASİ</span>

      {/* İlişki barı: −100 (düşman) .. +100 (müttefik) */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-400">İlişki:</span>
        <span className={`font-bold ${toneText}`}>{st.label} ({st.relation > 0 ? '+' : ''}{st.relation})</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
        <div className={`h-full transition-all ${barColor}`} style={{ width: `${Math.round((st.relation + 100) / 2)}%` }} />
      </div>
      {st.baseline !== st.relation && (
        <span className="text-[9px] text-slate-500">
          Doğal seyir: {st.baseline > st.relation ? 'ısınıyor' : 'soğuyor'} → {st.baseline > 0 ? '+' : ''}{st.baseline}
          {st.baseline < 0 && ' (fetihlerin komşuları ürkütüyor)'}
        </span>
      )}

      {/* Hediye: ilişkiyi anında ısıtır, tavanı var */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
        <Stepper
          value={giftAmount}
          step={Math.max(10_000_000, Math.round(income / 4))}
          format={formatMoney}
          onStep={(d: number) => setGiftAmount(v => Math.max(0, v + d))}
        />
        <button
          onClick={() => { apply(s => sendGift(s, countryId, giftAmount)); setGiftAmount(0); }}
          disabled={!giftAffordable}
          className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors shrink-0 ${
            giftAffordable
              ? 'bg-green-900/40 hover:bg-green-800/60 text-green-300 border-green-900/50'
              : 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
          }`}
        >
          🎁 Hediye{giftGain > 0 ? ` (+${giftGain})` : ''}
        </button>
      </div>
      <span className="text-[9px] text-slate-500">{giftHint(save, countryId)}</span>

      {/* Anlaşmalar / eylemler */}
      {actionRows.map(row => {
        if (row.active) {
          return (
            <div key={row.label} className="flex items-center justify-between py-1 px-1.5 bg-blue-900/30 border border-blue-800/50 rounded text-[10px] text-blue-300">
              <span>{row.icon} {row.label}</span>
              <span className="font-mono">{row.activeText}</span>
            </div>
          );
        }
        if (row.ok) {
          return (
            <button
              key={row.label}
              onClick={row.run}
              className="flex flex-col items-stretch py-1 px-1.5 rounded text-[10px] border text-left bg-slate-800/80 hover:bg-slate-700 text-slate-200 border-slate-700 press-fx"
            >
              <span className="flex justify-between">
                <span>{row.icon} {row.label}</span>
                <span className="font-mono text-amber-300">{row.cost}</span>
              </span>
              <span className="text-[9px] text-slate-500">{row.sub}</span>
            </button>
          );
        }
        // KİLİTLİ satır: fayda yine görünür; engel + "nasıl açılır" birlikte.
        // (div — disabled button içindeki kısayol dokunuş alamazdı)
        const relBlocked = row.minRelation !== undefined && st.relation < row.minRelation
          && !!row.reason?.includes('ilişki');
        const kalanTavan = giftRemainingThisTurn(save, countryId);
        const gap = relBlocked ? row.minRelation! - st.relation : 0;
        const hedefKazanc = Math.min(gap, kalanTavan);
        const gerekenTutar = hedefKazanc > 0
          ? Math.ceil(hedefKazanc * income / GIFT_RELATION_PER_INCOME)
          : 0;
        return (
          <div
            key={row.label}
            title={row.reason}
            className="flex flex-col items-stretch py-1 px-1.5 rounded text-[10px] border text-left bg-slate-800/40 text-slate-500 border-slate-800"
          >
            <span className="flex justify-between">
              <span>{row.icon} {row.label}</span>
              <span className="font-mono text-slate-500">{row.cost}</span>
            </span>
            <span className="text-[9px] text-slate-500">{row.sub}</span>
            <span className="text-[9px] text-amber-400/90 mt-0.5">⛔ {blockText(row.reason)}</span>
            {relBlocked && (
              hedefKazanc > 0 ? (
                <button
                  onClick={() => setGiftAmount(gerekenTutar)}
                  title={`Hediye kutusuna ${formatMoney(gerekenTutar)} yazar (+${hedefKazanc} ilişki) — göndermek için 🎁 Hediye'ye bas`}
                  className="mt-1 self-start px-2 py-1 rounded text-[9px] font-medium border border-green-900/60 bg-green-950/50 hover:bg-green-900/60 text-green-300 hit-target-sm press-fx"
                >
                  🎁 Gereken hediyeyi hazırla — {formatMoney(gerekenTutar)} (+{hedefKazanc}
                  {hedefKazanc < gap ? ` · kalan ${gap - hedefKazanc} gelecek tura` : ` → eşik tamam`})
                </button>
              ) : (
                <span className="text-[9px] text-slate-500 mt-0.5">
                  🎁 bu turun hediye tavanı doldu — kalan {gap} puan için gelecek tur tekrar dene
                </span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// Artı/eksi butonlarının adım büyüklükleri (birimler adet, yatırımlar $)
const UI_STEPS: Record<string, number> = {
  asker: 1000, tank: 10, ucak: 5, liman: 1, gemi: 1, hava_savunma: 10, kara_savunma: 10,
  tarim: 50_000_000, sanayi: 50_000_000, nufus: 50_000_000,
};

export function GameUI({ initialSave, onExitToMenu }: GameUIProps) {
  const [save, setSave] = useState<GameSave>(initialSave);
  const [events, setEvents] = useState<TurnEvent[]>([]);
  const [battleReports, setBattleReports] = useState<BattleReport[]>([]);
  // Haritadaki tek seferlik muharebe flaşları (tur sonu çatışma bölgeleri)
  const [mapFlash, setMapFlash] = useState<{ ids: string[]; seq: number } | null>(null);

  const [selectedTarget, setSelectedTarget] = useState<{id: string, name: string, isProvince?: boolean} | null>(null);
  const [showInvestmentMenu, setShowInvestmentMenu] = useState(false);
  const [showArmyMenu, setShowArmyMenu] = useState(false);
  const [showBorderMenu, setShowBorderMenu] = useState(false);
  const [borderDraft, setBorderDraft] = useState<Draft>({ kara_savunma: '', hava_savunma: '' });
  // Ordu Çağır: seçili ile DİĞER illerden mobil birlik toplama paneli
  // (eski iki-tıklamalı "transfer"in yerini aldı — hedef zaten seçili il,
  // kaynaklar listeden işaretlenir, tür filtreleri neyin çağrılacağını belirler)
  const [showGatherMenu, setShowGatherMenu] = useState(false);
  // Tür filtreleri — varsayılan İŞARETLİ: kara = asker+tank, hava = uçak
  const [gatherFilters, setGatherFilters] = useState({ kara: true, hava: true });
  // Çağrı yapılacak kaynak iller (il id → dahil mi)
  const [selectedSourceProvinces, setSelectedSourceProvinces] = useState<Record<string, boolean>>({});
  // Hassas seçim: il başına ELLE miktar — tanımlıysa o ilden "tümü" yerine
  // yalnız bu kadar çağrılır (stepper'larla ayarlanır, serbest mevcutla sınırlı)
  const [gatherCustom, setGatherCustom] = useState<Record<string, Army>>({});
  // Hangi il satırının miktar ayar stepper'ları açık
  const [gatherExpanded, setGatherExpanded] = useState<Record<string, boolean>>({});
  const [armyDraft, setArmyDraft] = useState<Draft>(EMPTY_UNIT_DRAFT);
  const [investmentDraft, setInvestmentDraft] = useState<Draft>({ tarim: '', sanayi: '', nufus: '' });
  const [activeFilters, setActiveFilters] = useState<string[]>(['asker', 'tank', 'ucak', 'liman', 'hava_savunma', 'kara_savunma', 'tarim', 'sanayi', 'nufus']);
  const [autoPlaySpeed, setAutoPlaySpeed] = useState<number | null>(null);
  const [showPauseMenu, setShowPauseMenu] = useState(false);
  // Nasıl Oynanır rehberi: oyuna ilk girişte otomatik açılır, menüden tekrar açılabilir
  const [showGuide, setShowGuide] = useState(!initialSave.guideSeen);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [dismissedWarKeys, setDismissedWarKeys] = useState<string[]>([]);
  const [dismissedBannerKeys, setDismissedBannerKeys] = useState<string[]>([]);
  const [showTaxPanel, setShowTaxPanel] = useState(false);
  // Vergi ayar hassasiyeti (yüzde puan) — slider ve +/− butonları bu adımı kullanır
  const [taxStep] = useState(0.5);
  // Üst bar detay popover'ı: aynı anda tek panel açık olabilir (null = hepsi kapalı)
  const [activeStatPanel, setActiveStatPanel] = useState<'hazine' | 'nufus' | 'ordu' | null>(null);
  const toggleStatPanel = (panel: 'hazine' | 'nufus' | 'ordu') =>
    setActiveStatPanel(prev => (prev === panel ? null : panel));
  useEffect(() => {
    if (!activeStatPanel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveStatPanel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeStatPanel]);
  const [showWarConfirm, setShowWarConfirm] = useState(false);
  const [preModalAutoPlaySpeed, setPreModalAutoPlaySpeed] = useState<number | null>(null);
  // Taarruz emri modalı: hedef il (işgal altındaki TR ili veya düşman eyaleti)
  const [attackTarget, setAttackTarget] = useState<{ id: string; name: string } | null>(null);
  const [victoryDismissed, setVictoryDismissed] = useState(false);
  const [defeatDismissed, setDefeatDismissed] = useState(false);
  const [showDisbandMenu, setShowDisbandMenu] = useState(false);
  const [disbandDraft, setDisbandDraft] = useState<Draft>(EMPTY_UNIT_DRAFT);
  const [devInvestDraft, setDevInvestDraft] = useState<Draft>({ tutar: '' }); // fethedilen toprağa kalkınma yatırımı

  // Tek anahtarlı kayıt: her state değişiminde bütün oyun tek JSON olarak yazılır
  useEffect(() => {
    persistSave(save);
  }, [save]);

  // Fonksiyonel güncelleme: hızlı ardışık turlarda state kaybı olmaz.
  // Raporlar updater içinde set edilmez (React updater'ları saf olmalı);
  // ref'e bırakılır, save değişince effect işler.
  const pendingReportsRef = useRef<BattleReport[] | null>(null);
  const autoPlaySpeedRef = useRef(autoPlaySpeed);
  useEffect(() => { autoPlaySpeedRef.current = autoPlaySpeed; }, [autoPlaySpeed]);

  const nextTurn = () => {
    setSave(prev => {
      const result = advanceTurn(prev);
      pendingReportsRef.current = result.reports;
      // Tur özeti şeridi: "sessiz" turlarda bile oyuncuya nabız verir
      // (10 olaysız tur üst üste gelebiliyor — 2026-07-15 pacing testi)
      pendingSummaryRef.current = {
        turn: result.save.turn,
        money: result.save.money - prev.money,
        happy: (result.save.happiness ?? 70) - (prev.happiness ?? 70),
        pop: totalPopulation(result.save) - totalPopulation(prev),
      };
      return result.save;
    });
  };
  const pendingSummaryRef = useRef<{ turn: number; money: number; happy: number; pop: number } | null>(null);
  const [turnSummary, setTurnSummary] = useState<{ turn: number; money: number; happy: number; pop: number } | null>(null);
  useEffect(() => {
    if (!pendingSummaryRef.current) return;
    setTurnSummary(pendingSummaryRef.current);
    pendingSummaryRef.current = null;
  }, [save]);

  useEffect(() => {
    const reports = pendingReportsRef.current;
    pendingReportsRef.current = null;
    if (!reports || reports.length === 0) return;
    // Çatışma yaşanan bölgelerde harita flaşı (countryId harita savaşında bölge id'sidir)
    const flashIds = [...new Set(reports
      .filter(r => r.result !== 'peace' && r.countryId.includes('-'))
      .map(r => r.countryId))];
    if (flashIds.length > 0) setMapFlash({ ids: flashIds, seq: save.turn });
    // Modal yalnız SAVAŞ BİTİREN olaylarda açılır (fetih/püskürtme/barış) —
    // bunlar tek seferliktir. Her tur tekrarlanan işgal/yağma ("occupation") ve
    // "devam ediyor" turları modal açmaz; bildirimler + savaş kartları yeterli.
    const important = reports.filter(r =>
      r.result === 'conquest' || r.result === 'repelled' || r.result === 'peace'
      || r.result === 'occupation' || r.result === 'attack_failed'
      // Oyuncunun kendi taarruzunun yıpratma sonucu da geri bildirimdir;
      // AI'nin rutin yıpratmaları modal açmaz (bildirim yorgunluğu)
      || (r.result === 'attrition' && r.initiator === 'player'));
    if (important.length === 0) return;
    setBattleReports(important);
    if (autoPlaySpeedRef.current !== null) {
      setPreModalAutoPlaySpeed(autoPlaySpeedRef.current);
      setAutoPlaySpeed(null);
    }
  }, [save]);

  const handleCloseBattleReports = () => {
    setBattleReports([]);
    if (preModalAutoPlaySpeed !== null) {
      setAutoPlaySpeed(preModalAutoPlaySpeed);
      setPreModalAutoPlaySpeed(null);
    }
  };

  // Olayları state farkından türet (StrictMode güvenli — motor olayları çift sayılabilir)
  const prevSaveRef = useRef(save);
  useEffect(() => {
    const prev = prevSaveRef.current;
    prevSaveRef.current = save;
    if (prev === save) return;
    const newEvents: TurnEvent[] = [];

    // Yeni savaş ilanları (AI)
    for (const war of save.wars) {
      if (war.initiator === 'ai' && !prev.wars.some(w => w.countryId === war.countryId)) {
        newEvents.push({ type: 'invasion', message: `${war.countryName} sana savaş ilan etti!` });
      }
    }

    // AI ülkeler arası savaşlar (başlayan/biten)
    {
      const nameOf = (id: string) => countryName(id);
      const aiWarKey = (w: { attackerId: string; defenderId: string; startedTurn: number }) =>
        `${w.attackerId}-${w.defenderId}-${w.startedTurn}`;
      const prevAiWars = prev.aiWars || [];
      const curAiWars = save.aiWars || [];
      for (const w of curAiWars) {
        if (!prevAiWars.some(p => aiWarKey(p) === aiWarKey(w))) {
          newEvents.push({ type: 'battle', message: `⚡ ${nameOf(w.attackerId)}, ${nameOf(w.defenderId)}'e savaş ilan etti! İki ordu da yıpranacak.` });
        }
      }
      for (const w of prevAiWars) {
        if (!curAiWars.some(p => aiWarKey(p) === aiWarKey(w))) {
          newEvents.push({ type: 'peace', message: `${nameOf(w.attackerId)} – ${nameOf(w.defenderId)} savaşı sona erdi.` });
        }
      }
    }

    // Yeni savaş (oyuncu ilanı): oynanış ipucu göster
    for (const war of save.wars) {
      if (war.initiator === 'player'
        && !prev.wars.some(w => w.countryId === war.countryId)) {
        newEvents.push({ type: 'battle', message: `⚔️ ${war.countryName} ile savaş başladı — haritada düşman illerine dokunup Taarruz Emri ver. Emirler tur sonunda işlenir.` });
      }
    }

    // Ele geçirilen / kaybedilen düşman eyaletleri
    const prevCaptured = new Set(prev.capturedEnemyProvinces ?? []);
    for (const provId of save.capturedEnemyProvinces ?? []) {
      if (!prevCaptured.has(provId)) {
        newEvents.push({ type: 'conquest', message: `${provinceDisplayName(provId)} ele geçirildi!` });
      }
    }

    // İl işgalleri ve kurtarmalar
    for (const [provId, occupier] of Object.entries(save.occupiedProvinces)) {
      if (!prev.occupiedProvinces[provId]) {
        newEvents.push({ type: 'occupation', message: `${countryName(occupier)}, ${regionName(provId)} bölgesini işgal etti!` });
      }
    }
    for (const provId of Object.keys(prev.occupiedProvinces)) {
      if (!save.occupiedProvinces[provId] && save.wars.some(w => w.countryId === prev.occupiedProvinces[provId])) {
        newEvents.push({ type: 'liberation', message: `${regionName(provId)} kurtarıldı!` });
      }
    }

    // Biten savaşlar: fetih / barış / püskürtme
    for (const war of prev.wars) {
      if (save.wars.some(w => w.countryId === war.countryId)) continue;
      if (save.conqueredCountryIds.includes(war.countryId) && !prev.conqueredCountryIds.includes(war.countryId)) {
        const gained = conqueredCountryIncome(save, war.countryId);
        newEvents.push({ type: 'conquest', message: `${war.countryName} fethedildi! Ganimet: +${formatMoney(gained * 5)} · Devralınan gelir: +${formatMoney(gained)}/tur` });
      } else if ((save.truces[war.countryId] || 0) > (prev.truces[war.countryId] || 0)) {
        newEvents.push({ type: 'peace', message: `${war.countryName} ile barış imzalandı.` });
      } else if (war.initiator === 'ai') {
        newEvents.push({ type: 'battle', message: `${war.countryName} saldırısı püskürtüldü!` });
      }
    }

    // AI barış talebi (simetri): süren harita savaşında düşmanın ilhak-kabul
    // eşiği BU TUR aşıldıysa düşman kendisi barış ister — karar matrisi iki
    // taraf için de aynı gerçeği okur, oyuncu teklifin geçeceğini haber alır.
    for (const war of save.wars) {
      if (!prev.wars.some(w => w.countryId === war.countryId)) continue;
      const power = computeTotalAttackPower(save, happinessMultiplier(save.happiness ?? 70));
      const now = evaluateAnnexOffer(save, war.countryId, power);
      const before = evaluateAnnexOffer(prev, war.countryId, power);
      const readyNow = !!now && now.accepted && now.capturedCount > 0;
      const readyBefore = !!before && before.accepted && before.capturedCount > 0;
      if (readyNow && !readyBefore) {
        newEvents.push({
          type: 'peace',
          message: `🕊️ ${war.countryName} barış istiyor — ele geçirdiğin ${now!.capturedCount} bölgeyi ilhak etmeni kabul etmeye hazır (savaş kartı → İlhakla Bitir).`,
        });
      }
    }

    if (newEvents.length > 0) {
      setEvents(e => [...e, ...newEvents].slice(-4));
    }
  }, [save]);

  useEffect(() => {
    if (autoPlaySpeed !== null) {
      const interval = setInterval(nextTurn, autoPlaySpeed);
      return () => clearInterval(interval);
    }
  }, [autoPlaySpeed]);

  // Kesinti güvenliği: uygulama arka plana alınınca (gelen arama, sekme/uygulama
  // değişimi) otomatik oynatma DURUR — oyuncu dönünce turlar habersiz akmış olmaz.
  // Kayıt zaten her turda yazıldığından veri kaybı riski ayrıca yoktur.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setAutoPlaySpeed(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Olay bildirimleri birkaç saniye sonra kaybolsun
  useEffect(() => {
    if (events.length === 0) return;
    const timer = setTimeout(() => setEvents(prev => prev.slice(1)), 5000);
    return () => clearTimeout(timer);
  }, [events]);

  // "Kaydedildi" onayı kısa süre görünür
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const handleManualSave = () => {
    persistSave(save);
    setJustSaved(true);
  };

  const income = computeIncome(save);
  const upkeep = computeUpkeep(save);
  const netIncome = income - upkeep.total;
  // Ordu iaşesi: asker varken HUD'da görünür; %100 altı = tarım yetmiyor
  const askerTotal = totalAskerCount(save);
  const foodRatio = armyFoodRatio(save);
  const population = totalPopulation(save);
  const popGrowth = totalPopulationGrowth(save);
  const hMult = happinessMultiplier(save.happiness ?? 70);
  const armyPower = computeTotalAttackPower(save, hMult); // yurt + cephelerdeki ordular
  const defensePower = computeDefensePower(save.provinceUnits, hMult);

  const warKey = (w: { countryId: string; startedTurn: number }) => `${w.countryId}-${w.startedTurn}`;
  const visibleWars = save.wars.filter(w => !dismissedWarKeys.includes(warKey(w)));
  const underInvasion = visibleWars.some(w => w.initiator === 'ai');
  const dismissWar = (w: { countryId: string; startedTurn: number }) => {
    setDismissedWarKeys(prev => [...prev, warKey(w)]);
  };

  // Kayıttaki savaşlar bittiğinde artık gerekmeyen dismiss anahtarlarını temizle (sızıntıyı önler)
  useEffect(() => {
    setDismissedWarKeys(prev => {
      const activeKeys = new Set(save.wars.map(warKey));
      const next = prev.filter(k => activeKeys.has(k));
      return next.length === prev.length ? prev : next;
    });
  }, [save.wars]);

  const dismissBanner = (key: string) => {
    setDismissedBannerKeys(prev => prev.includes(key) ? prev : [...prev, key]);
  };

  // Durum düzelip aynı uyarı tekrar geçerli olduğunda (ör. cephe boşalır, sonra yeniden dolar,
  // sonra tekrar boşalır) kullanıcı yeniden uyarılsın diye: koşul geçersiz olur olmaz
  // ilgili dismiss anahtarını kaldır.
  useEffect(() => {
    const stillRelevantKeys = new Set<string>();
    if (save.money + income < upkeep.total) stillRelevantKeys.add('upkeep');
    if (save.wars.some(w => w.initiator === 'player') && armyPower <= 0) stillRelevantKeys.add('noarmy');
    if (underInvasion && defensePower <= 0) stillRelevantKeys.add('nodefense');
    setDismissedBannerKeys(prev => {
      const next = prev.filter(k => stillRelevantKeys.has(k));
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save.wars, armyPower, defensePower, underInvasion, save.turn, save.money, income, upkeep.total]);

  const toggleFilter = (filterId: string) => {
    setActiveFilters(prev =>
      prev.includes(filterId) ? prev.filter(id => id !== filterId) : [...prev, filterId]
    );
  };

  // selectedTarget.isProvince TIKLAMA anının anlık görüntüsüdür; tur sonunda
  // sahiplik değişince (fetih, işgal, kurtarma) bayatlar. Bayat bayrak, fethedilen
  // bölgeyi "düşman eyaleti" paneline düşürüp fethedilmiş ülkeye SAVAŞ İLAN ET
  // butonu gösteriyordu (2026-07-14 oyuncu testi). Panel açıkken kayıt her
  // değiştiğinde bayrak kayıttan yeniden türetilir — panel ve tüm handler'lar
  // (üretim/yatırım isProvince'e bakar) tutarlı kalır.
  useEffect(() => {
    if (!selectedTarget || !selectedTarget.id.includes('-r')) return; // ülke seçimi: bayrak anlamsız
    const own = isPlayerRegion(save, selectedTarget.id) || !!save.occupiedProvinces[selectedTarget.id];
    if (own !== !!selectedTarget.isProvince) {
      setSelectedTarget(t => (t ? { ...t, isProvince: own } : t));
    }
  }, [save, selectedTarget]);

  // --- Play-test köprüsü (yalnız DEV) ---
  // Otomatik test koşucusu (src/test/playtest.ts) state okuyup yazabilsin ve
  // panel açtırabilsin diye dar bir yüzey. import.meta.env.DEV koşulu sayesinde
  // prod build'e girmez; window'a yalnız geliştirmede takılır.
  const testBridgeRef = useRef<{ save: GameSave; select: (id: string, name: string, isProvince?: boolean) => void } | null>(null);
  useEffect(() => {
    testBridgeRef.current = { save, select: handleTargetSelect };
  });
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__hegemonTest = {
      getSave: () => testBridgeRef.current!.save,
      setSave,
      selectTarget: (id: string, name: string, isProvince?: boolean) =>
        testBridgeRef.current!.select(id, name, isProvince),
      // E2E zafer testi kara komşularını sabit listelemek yerine motordan alır
      // (zafer koşulu tam bu listeye bakar — mapWar.victoryAchieved)
      getLandNeighbors: () =>
        countryLandNeighborList(testBridgeRef.current!.save.playerCountryId),
    };
    return () => { delete (window as unknown as Record<string, unknown>).__hegemonTest; };
  }, []);

  const handleTargetSelect = (id: string, name: string, isProvince?: boolean) => {
    setSelectedTarget({id, name, isProvince});
    setShowInvestmentMenu(false);
    setShowArmyMenu(false);
    setShowGatherMenu(false);
    setShowDisbandMenu(false);
    setShowBorderMenu(false);
    setArmyDraft(EMPTY_UNIT_DRAFT);
    setDisbandDraft(EMPTY_UNIT_DRAFT);
    setInvestmentDraft({ tarim: '', sanayi: '', nufus: '' });
    setDevInvestDraft({ tutar: '' });
    setBorderDraft({ kara_savunma: '', hava_savunma: '' });
  };

  const parseDraft = (draft: Draft): Record<string, number> => {
    const parsed: Record<string, number> = {};
    for (const [key, value] of Object.entries(draft)) {
      const num = parseInt(value.toString());
      if (!isNaN(num) && num > 0) parsed[key] = num;
    }
    return parsed;
  };

  // --- Yatırım: girilen tutarlar $ cinsindendir ---
  const investmentCost = Object.values(parseDraft(investmentDraft)).reduce((a, b) => a + b, 0);

  const handleProduceInvestment = () => {
    if (!selectedTarget?.isProvince) return;
    const amounts = parseDraft(investmentDraft);
    const totalCost = Object.values(amounts).reduce((a, b) => a + b, 0);
    if (totalCost === 0 || totalCost > save.money) return;

    setSave(prev => {
      const provinceInvestments = { ...prev.provinceInvestments };
      // Tarım/sanayi YEREL yatırımdır (seçili ile işlenir)
      const current = { ...(provinceInvestments[selectedTarget.id] || {}) };
      if (amounts.tarim) current.tarim = (current.tarim || 0) + amounts.tarim;
      if (amounts.sanayi) current.sanayi = (current.sanayi || 0) + amounts.sanayi;
      provinceInvestments[selectedTarget.id] = current;

      // Nüfus teşviki ÜLKE GENELİNE dağıtılır (mevcut nüfusla orantılı, işgal
      // altındakiler hariç): her ilin asker havuzu büyür, tek il şişmez.
      if (amounts.nufus) {
        const people = Math.floor(amounts.nufus / POP_COST_PER_PERSON);
        const ids = Object.keys(provinceInvestments).filter(id => !prev.occupiedProvinces[id]);
        const totalPop = ids.reduce((a, id) => a + (provinceInvestments[id].nufus || 0), 0);
        let assigned = 0;
        for (const id of ids) {
          const share = totalPop > 0
            ? Math.floor(people * ((provinceInvestments[id].nufus || 0) / totalPop))
            : Math.floor(people / Math.max(1, ids.length));
          if (share <= 0) continue;
          provinceInvestments[id] = { ...provinceInvestments[id], nufus: (provinceInvestments[id].nufus || 0) + share };
          assigned += share;
        }
        // Yuvarlama küsuratı seçili ile
        const rem = people - assigned;
        if (rem > 0) {
          const c = { ...provinceInvestments[selectedTarget.id] };
          c.nufus = (c.nufus || 0) + rem;
          provinceInvestments[selectedTarget.id] = c;
        }
      }

      return { ...prev, money: prev.money - totalCost, provinceInvestments };
    });
    setInvestmentDraft({ tarim: '', sanayi: '', nufus: '' });
    setShowInvestmentMenu(false);
  };

  // --- Ordu üretimi: birim başı maliyet, mevcuda EKLENİR ---
  // Zorunlu askerlik: asker İL NÜFUSUNDAN (fethedilen ülkede YEREL NÜFUSTAN) alınır.
  const selectedIsConquered = !!selectedTarget && !selectedTarget.isProvince
    && save.conqueredCountryIds.includes(selectedTarget.id);
  // Ele geçirilen düşman bölgesi: kendi ilimiz gibi yönetilir (üretim/transfer),
  // yalnız asker devşirilemez — yerel halk bizim için savaşmaz
  const selectedIsCapturedProv = !!selectedTarget
    && save.capturedEnemyProvinces.includes(selectedTarget.id);
  const armyAmounts = parseDraft(armyDraft);
  const armyCost = Object.entries(armyAmounts).reduce(
    (sum, [unit, count]) => sum + (UNIT_COSTS[unit] || 0) * count, 0);
  const recruitPool = !selectedTarget ? 0
    : selectedTarget.isProvince
      ? (save.provinceInvestments[selectedTarget.id]?.nufus || 0)
      : selectedIsConquered
        ? Math.floor(save.conqueredEconomies?.[selectedTarget.id]?.population || 0)
        : 0;
  const armyRecruitsExceedPop = (armyAmounts.asker || 0) > recruitPool;

  const handleProduceArmy = () => {
    if (!selectedTarget) return;
    if (!selectedTarget.isProvince && !selectedIsConquered && !selectedIsCapturedProv) return;
    const amounts = parseDraft(armyDraft);
    // Deniz kısıtı güvencesi (UI kilidi + motor tarafı): kıyısız ile liman/gemi yazılmaz
    if (!isCoastalRegion(selectedTarget.id)) { delete amounts.liman; delete amounts.gemi; }
    else if ((save.provinceUnits[selectedTarget.id]?.liman || 0) <= 0) delete amounts.gemi;
    const totalCost = Object.entries(amounts).reduce(
      (sum, [unit, count]) => sum + (UNIT_COSTS[unit] || 0) * count, 0);
    if (totalCost === 0 || totalCost > save.money) return;

    setSave(prev => {
      const recruits = amounts.asker || 0;
      const current = { ...(prev.provinceUnits[selectedTarget.id] || {}) };
      for (const [unit, count] of Object.entries(amounts)) {
        current[unit] = (current[unit] || 0) + count;
      }

      // Fethedilen ülkede: asker yerel nüfustan toplanır
      if (!selectedTarget.isProvince) {
        const eco = prev.conqueredEconomies?.[selectedTarget.id];
        const pop = Math.floor(eco?.population || 0);
        if (recruits > pop) return prev;
        return {
          ...prev,
          money: prev.money - totalCost,
          provinceUnits: { ...prev.provinceUnits, [selectedTarget.id]: current },
          conqueredEconomies: recruits > 0 && eco
            ? { ...prev.conqueredEconomies, [selectedTarget.id]: { ...eco, population: pop - recruits } }
            : prev.conqueredEconomies,
        };
      }

      const pop = prev.provinceInvestments[selectedTarget.id]?.nufus || 0;
      if (recruits > pop) return prev; // ilin nüfusu bu kadar askeri karşılayamaz

      // Askere alınanlar il nüfusundan düşer
      const provinceInvestments = recruits > 0
        ? {
            ...prev.provinceInvestments,
            [selectedTarget.id]: {
              ...(prev.provinceInvestments[selectedTarget.id] || {}),
              nufus: pop - recruits,
            },
          }
        : prev.provinceInvestments;

      return {
        ...prev,
        money: prev.money - totalCost,
        provinceUnits: { ...prev.provinceUnits, [selectedTarget.id]: current },
        provinceInvestments,
      };
    });
    setArmyDraft(EMPTY_UNIT_DRAFT);
    setShowArmyMenu(false);
  };

  // --- Ordu Çağır ---
  // Seçili İLE, işaretli kaynak illerden filtreye uyan TÜM serbest mobil birlikler
  // için MOVE emirleri kuyruklanır. Anlık ışınlama değil: tur sonunda varır,
  // yolda geçen tur birlikler kilitlidir (kaynağı %25 verimle savunur).

  // Bir kaynağın SERBEST mobil birlikleri: başka emre bağlı olanlar düşülür;
  // aynı hedefe bekleyen MOVE emri düzenleme sayılır (Çağır onu değiştirir),
  // o emirdeki birlikler serbest kabul edilir.
  const gatherFreeUnits = (srcId: string, targetId: string): Army => {
    const units = save.provinceUnits[srcId] || {};
    const lockedAll = committedUnits(save, srcId);
    const sameRoute = (save.pendingOrders ?? []).find(o =>
      o.type === 'MOVE' && o.from === srcId && o.to === targetId);
    const free = (k: 'asker' | 'tank' | 'ucak') =>
      Math.max(0, (units[k] || 0) - Math.max(0, (lockedAll[k] || 0) - (sameRoute?.units[k] || 0)));
    return { asker: free('asker'), tank: free('tank'), ucak: free('ucak') };
  };

  // Tür filtreleri: işareti kalkan grup çağrıya ve toplama HİÇ girmez
  const applyGatherFilters = (a: Army): Army => ({
    asker: gatherFilters.kara ? a.asker : 0,
    tank: gatherFilters.kara ? a.tank : 0,
    ucak: gatherFilters.hava ? a.ucak : 0,
  });

  // Bir ilin çağrıya katkısı — TEK doğru kaynak (liste, toplam ve emirler
  // aynı hesabı okur): elle miktar girildiyse o (serbest mevcutla ve tür
  // filtreleriyle sınırlı), girilmediyse filtreye uyan TÜM serbest birlikler.
  const gatherContribution = (srcId: string, targetId: string): Army => {
    const free = gatherFreeUnits(srcId, targetId);
    const custom = gatherCustom[srcId];
    if (custom) {
      return {
        asker: gatherFilters.kara ? Math.min(custom.asker, free.asker) : 0,
        tank: gatherFilters.kara ? Math.min(custom.tank, free.tank) : 0,
        ucak: gatherFilters.hava ? Math.min(custom.ucak, free.ucak) : 0,
      };
    }
    return applyGatherFilters(free);
  };

  const handleGatherArmy = () => {
    if (!selectedTarget) return;
    const targetId = selectedTarget.id;
    const calls = Object.entries(selectedSourceProvinces)
      .filter(([, on]) => on)
      .map(([srcId]) => ({ srcId, units: gatherContribution(srcId, targetId) }))
      .filter(c => c.units.asker + c.units.tank + c.units.ucak > 0);
    if (calls.length === 0) return;
    setSave(prev => calls.reduce((s, c) => queueTransferOrder(s, c.srcId, targetId, c.units), prev));
    setShowGatherMenu(false);
  };

  // Ordu Listeleme Paneli: tür filtreleri (üstte) + kaynak il listesi +
  // "Tüm Birlikler" ve filtrelerle senkron dinamik toplam (altta)
  const renderGatherMenu = () => {
    if (!selectedTarget) return null;
    const targetId = selectedTarget.id;
    const sources = Object.keys(save.provinceUnits)
      .filter(id => id !== targetId && isPlayerRegion(save, id))
      .map(id => {
        const free = gatherFreeUnits(id, targetId);
        const filtered = applyGatherFilters(free);
        const callable = gatherContribution(id, targetId); // elle miktar varsa onu okur
        return {
          id, name: provinceDisplayName(id), free, callable,
          freeTotal: free.asker + free.tank + free.ucak,
          filteredTotal: filtered.asker + filtered.tank + filtered.ucak,
          callableTotal: callable.asker + callable.tank + callable.ucak,
        };
      })
      .filter(s => s.freeTotal > 0) // mobil birliği olmayan iller listelenmez
      .sort((a, b) => b.callableTotal - a.callableTotal || b.freeTotal - a.freeTotal);

    const enabled = sources.filter(s => s.filteredTotal > 0);
    const selected = enabled.filter(s => selectedSourceProvinces[s.id]);
    const total = selected.reduce((t, s) => ({
      asker: t.asker + s.callable.asker,
      tank: t.tank + s.callable.tank,
      ucak: t.ucak + s.callable.ucak,
    }), { asker: 0, tank: 0, ucak: 0 });
    const totalCount = total.asker + total.tank + total.ucak;
    const totalPower = (total.asker * LAND_ATTACK.asker + total.tank * LAND_ATTACK.tank
      + total.ucak * BOMBARDMENT_POWER) * hMult;
    const allSelected = enabled.length > 0 && selected.length === enabled.length;
    const filterLabel = [gatherFilters.kara && 'Kara', gatherFilters.hava && 'Hava']
      .filter(Boolean).join('/') || 'tür seçilmedi';

    const toggleAll = (on: boolean) => {
      const next: Record<string, boolean> = {};
      for (const s of enabled) next[s.id] = on;
      setSelectedSourceProvinces(next);
    };

    // Tür sayacı: filtre dışıysa soluk + üstü çizili ("çağrılamaz" işareti)
    const UnitCount = ({ on, label, value }: { on: boolean; label: string; value: number }) => (
      <span
        className={on ? 'text-slate-300' : 'text-slate-600 line-through'}
        title={on ? undefined : 'Filtre dışı — çağrılmaz'}
      >{label}{formatCount(value)}</span>
    );

    return (
      <div className="flex flex-col gap-1.5 w-full min-h-0">
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider shrink-0">
          ORDU ÇAĞIR &rarr; {selectedTarget.name}
        </span>
        <span className="text-[9px] text-purple-300/80 shrink-0">
          🔁 Tur sonunda varır — yoldaki birlikler kaynağı %25 verimle savunur. Savunma yapıları ve gemiler sabittir, taşınamaz.
        </span>

        {/* Tür filtreleri: liste ve toplam anlık güncellenir */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 shrink-0 bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-purple-500 cursor-pointer"
              checked={gatherFilters.kara}
              onChange={e => setGatherFilters(f => ({ ...f, kara: e.target.checked }))}
            />
            🪖 Kara unsurları <span className="text-slate-500">(asker · tank)</span>
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-purple-500 cursor-pointer"
              checked={gatherFilters.hava}
              onChange={e => setGatherFilters(f => ({ ...f, hava: e.target.checked }))}
            />
            ✈️ Hava unsurları <span className="text-slate-500">(uçak)</span>
          </label>
        </div>

        {/* Kaynak il listesi */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col -mr-1 pr-1">
          {sources.length === 0 && (
            <span className="text-[10px] text-slate-500 py-2">Çağrılabilir birliği olan başka il yok.</span>
          )}
          {sources.map(s => {
            const disabled = s.filteredTotal === 0;
            const custom = gatherCustom[s.id];
            const expanded = !!gatherExpanded[s.id];
            return (
              <div key={s.id} className={`rounded ${disabled ? 'opacity-40' : 'hover:bg-slate-800/40'}`}>
                <div className="flex items-center gap-2 py-1 px-1">
                  <label className={`flex items-center gap-2 flex-1 min-w-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      className="accent-purple-500 shrink-0 cursor-pointer"
                      disabled={disabled}
                      checked={!disabled && !!selectedSourceProvinces[s.id]}
                      onChange={e => setSelectedSourceProvinces(p => ({ ...p, [s.id]: e.target.checked }))}
                    />
                    <span className="text-xs text-slate-200 truncate">{s.name}</span>
                  </label>
                  <span className="text-[9px] font-mono flex gap-1.5 shrink-0">
                    {custom ? (
                      <span className="text-purple-300" title="Elle ayarlandı — ✎ ile değiştir">
                        seçilen: {s.callable.asker > 0 && `🪖${formatCount(s.callable.asker)} `}
                        {s.callable.tank > 0 && `🛡️${formatCount(s.callable.tank)} `}
                        {s.callable.ucak > 0 && `✈️${formatCount(s.callable.ucak)}`}
                        {s.callableTotal === 0 && '—'}
                      </span>
                    ) : (
                      <>
                        {s.free.asker > 0 && <UnitCount on={gatherFilters.kara} label="🪖" value={s.free.asker} />}
                        {s.free.tank > 0 && <UnitCount on={gatherFilters.kara} label="🛡️" value={s.free.tank} />}
                        {s.free.ucak > 0 && <UnitCount on={gatherFilters.hava} label="✈️" value={s.free.ucak} />}
                      </>
                    )}
                    {disabled && <span className="text-amber-500/80">filtre dışı</span>}
                  </span>
                  {/* Hassas seçim: bu ilden hangi birimden KAÇ tane çağrılacağı */}
                  <button
                    onClick={() => {
                      if (disabled) return;
                      if (!expanded) {
                        if (!custom) setGatherCustom(p => ({ ...p, [s.id]: { ...s.callable } }));
                        setSelectedSourceProvinces(p => ({ ...p, [s.id]: true }));
                      }
                      setGatherExpanded(p => ({ ...p, [s.id]: !expanded }));
                    }}
                    disabled={disabled}
                    title="Bu ilden kaç birim çağrılacağını elle ayarla"
                    className={`shrink-0 px-2.5 py-1 rounded text-[11px] border hit-target-sm press-fx ${
                      expanded || custom
                        ? 'bg-purple-900/50 text-purple-200 border-purple-700/60'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    ✎
                  </button>
                </div>
                {expanded && !disabled && (
                  <div className="pl-6 pr-1 pb-1.5 flex flex-col gap-1 border-l border-purple-900/40 ml-2.5">
                    {([['asker', '🪖 Asker', gatherFilters.kara], ['tank', '🛡️ Tank', gatherFilters.kara], ['ucak', '✈️ Uçak', gatherFilters.hava]] as const)
                      .filter(([k]) => s.free[k] > 0)
                      .map(([k, lbl, on]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className={`text-[10px] ${on ? 'text-slate-400' : 'text-slate-600 line-through'}`}>
                            {lbl} <span className="text-slate-600">· serbest {formatCount(s.free[k])}</span>
                          </span>
                          <Stepper
                            value={on ? Math.min(custom?.[k] ?? s.callable[k], s.free[k]) : 0}
                            step={Math.min(UI_STEPS[k], Math.max(1, s.free[k]))}
                            format={formatCount}
                            onStep={delta => setGatherCustom(p => {
                              const cur = p[s.id] ?? { ...s.callable };
                              const next = Math.max(0, Math.min(s.free[k], (cur[k] ?? 0) + delta));
                              return { ...p, [s.id]: { ...cur, [k]: next } };
                            })}
                          />
                        </div>
                      ))}
                    <button
                      onClick={() => {
                        setGatherCustom(p => { const n = { ...p }; delete n[s.id]; return n; });
                        setGatherExpanded(p => ({ ...p, [s.id]: false }));
                      }}
                      className="self-end text-[10px] text-slate-400 hover:text-slate-200 underline px-2 py-1 hit-target-sm press-fx"
                    >
                      elle seçimi bırak — tümünü çağır
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Tüm Birlikler + filtrelere senkron dinamik toplam */}
        <div className="border-t border-slate-700/60 pt-1.5 shrink-0">
          <label className={`flex items-center gap-2 py-0.5 select-none ${enabled.length === 0 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              className="accent-purple-500 cursor-pointer"
              checked={allSelected}
              disabled={enabled.length === 0}
              onChange={e => toggleAll(e.target.checked)}
            />
            <span className="text-xs font-medium text-slate-200 flex-1">Tüm Birlikler</span>
            <span className="text-[9px] text-slate-500">{selected.length}/{enabled.length} il</span>
          </label>
          <div className="flex items-baseline justify-between text-[10px] font-mono">
            <span className="text-slate-400">Toplam Seçilen ({filterLabel}):</span>
            <span className="text-purple-300">
              {totalCount > 0
                ? <>🪖{formatCount(total.asker)} · 🛡️{formatCount(total.tank)} · ✈️{formatCount(total.ucak)}</>
                : '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between text-[10px] font-mono">
            <span className="text-slate-400">Saldırı gücü (mutluluk dahil):</span>
            <span className="text-red-400">{totalCount > 0 ? formatCount(totalPower) : '—'}</span>
          </div>
        </div>

        <div className="flex gap-2 mt-1 shrink-0">
          <button
            onClick={() => setShowGatherMenu(false)}
            className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium border border-slate-600 transition-colors press-fx"
          >
            İptal
          </button>
          <button
            onClick={handleGatherArmy}
            disabled={totalCount === 0}
            className={`flex-1 py-1 rounded text-xs font-medium border press-fx ${
              totalCount > 0
                ? 'bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border-purple-900/50'
                : 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
            }`}
          >
            Orduyu Çağır{selected.length > 0 ? ` (${selected.length} il)` : ''}
          </button>
        </div>
      </div>
    );
  };

  // Geri alınamaz eylemler için İKİ DOKUNUŞLU onay: ilk dokunuş butonu
  // "Emin misin?"e çevirir, 3 sn içindeki ikinci dokunuş çalıştırır. Modal'dan
  // hafif, mobil dostu. (Çocuk-persona testi: onaysız savaş ilanı + onaysız
  // barış = iki yanlış tıkla −$720M ve 40 tur ateşkes — 2026-07-15.)
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const confirmTimer = useRef<number | undefined>(undefined);
  const confirmTap = (key: string, run: () => void) => {
    if (confirmKey === key) {
      window.clearTimeout(confirmTimer.current);
      setConfirmKey(null);
      run();
      return;
    }
    setConfirmKey(key);
    window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => setConfirmKey(null), 3000);
  };

  const handleDeclareWar = () => {
    if (!selectedTarget?.id || selectedTarget.isProvince) return;
    setShowWarConfirm(true);
  };

  const confirmDeclareWar = () => {
    if (!selectedTarget?.id || selectedTarget.isProvince) return;
    const { id, name } = selectedTarget;
    setSave(prev => startWar(prev, id, name));
    setShowWarConfirm(false);
  };

  // Taarruz emrini kuyruğa yaz — state hemen değişmez, tur sonunda işlenir
  const handleQueueAttack = (commits: Record<string, Army>) => {
    if (!attackTarget) return;
    const targetId = attackTarget.id;
    setSave(prev => queueAttackOrders(prev, targetId, commits));
    setAttackTarget(null);
  };

  const handleSignPeace = (countryId: string) => {
    confirmTap(`peace-${countryId}`, () => setSave(prev => signPeace(prev, countryId) ?? prev));
  };

  // Barış butonu etiketi ve durumu (iki dokunuşlu onay: ilk dokunuşta etiket değişir)
  const peaceInfo = (war: War) => {
    const cost = peaceTerms(save, war);
    const affordable = cost <= save.money;
    const confirming = confirmKey === `peace-${war.countryId}`;
    const label = confirming
      ? (cost > 0 ? `Emin misin? ${formatMoney(cost)} ödenecek` : 'Emin misin? Tekrar dokun')
      : cost > 0
        ? `Barış: ${formatMoney(cost)} öde`
        : cost < 0
          ? `Barış: ${formatMoney(-cost)} al`
          : 'Barış (bedelsiz)';
    return { cost, affordable, label, confirming };
  };

  // Stepper'dan gelen +/- deltalarını taslağa uygular (0 ve opsiyonel üst sınır arasında)
  const stepDraft = (setter: React.Dispatch<React.SetStateAction<Draft>>, field: string, max?: number) => (delta: number) => {
    setter(prev => {
      const cur = parseInt(prev[field]?.toString() || '0') || 0;
      const next = Math.max(0, Math.min(max ?? Number.MAX_SAFE_INTEGER, cur + delta));
      return { ...prev, [field]: next };
    });
  };

  const selectedWar = selectedTarget && !selectedTarget.isProvince
    ? save.wars.find(w => w.countryId === selectedTarget.id) : undefined;
  const selectedConquered = selectedTarget && !selectedTarget.isProvince
    && save.conqueredCountryIds.includes(selectedTarget.id);

  // Vergi oranı değiştirme — kayan nokta hatası birikmesin diye yüzde puan
  // üzerinden tek ondalığa yuvarlanır (%0–%100 aralığına sıkıştırılır)
  const taxPct = Math.round((save.taxRate ?? 0.20) * 1000) / 10;
  const handleTaxChange = (newPct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newPct * 10) / 10));
    setSave(prev => ({ ...prev, taxRate: clamped / 100 }));
  };
  // prev-tabanlı: basılı tutmadaki hızlı ardışık çağrılar doğru birikir
  // (render'daki taxPct'e bağlansaydı aynı karedeki adımlar birbirini ezerdi)
  const adjustTax = (deltaPct: number) => {
    setSave(prev => {
      const cur = Math.round((prev.taxRate ?? 0.20) * 1000) / 10;
      const next = Math.max(0, Math.min(100, Math.round((cur + deltaPct) * 10) / 10));
      return { ...prev, taxRate: next / 100 };
    });
  };
  // Vergi −/+ butonları: basılı tutunca hızlanarak tekrar (mobil hassas ayar)
  const taxMinusHold = useHoldRepeat(() => adjustTax(-taxStep));
  const taxPlusHold = useHoldRepeat(() => adjustTax(taxStep));

  // Yatırım menüsü — kendi illeri VE ele geçirilen (ilhak edilen) bölgelerde
  // ortak kullanılır: ilhak edilen toprak da tarım/sanayi ile gelir üretebilsin
  // (yatırımlar provinceInvestments'a yazılır, computeIncome zaten sayar).
  const renderInvestmentMenu = () => selectedTarget && (
    <div className="flex flex-col gap-1.5 w-full min-h-0">
      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5 shrink-0">YATIRIM YAP ($)</span>

      {/* Canlı durum: oyuncu tarımın gelir dışı işlevini (ordu iaşesi) burada görür */}
      {(() => {
        const food = armyFoodRatio(save);
        const hungry = food < 0.999;
        return (
          <div className={`flex justify-between items-center px-2 py-1 rounded border shrink-0 text-[10px] ${
            hungry ? 'bg-red-950/40 border-red-900/50 text-red-300' : 'bg-slate-950/60 border-slate-800 text-slate-400'
          }`}>
            <span>🌾 Ordu iaşesi</span>
            <span className="font-mono">%{Math.round(food * 100)}{hungry ? ' — asker bakımı artıyor' : ''}</span>
          </div>
        );
      })()}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 -mr-1 pr-1">
      {[
        { id: 'tarim', label: 'Tarım', hint: 'Gelir + gıda: nüfusu büyütür, ORDUYU besler. Aç ordu pahalıya oturur.' },
        { id: 'sanayi', label: 'Sanayi', hint: 'Salt gelir — en yüksek getirili yatırım.' },
        { id: 'nufus', label: 'Nüfus Teşviki', hint: `${POP_COST_PER_PERSON}$ = 1 kişi · ÜLKE GENELİNE dağıtılır (her ilin asker havuzu büyür)` },
      ].map(type => {
        const inv = save.provinceInvestments[selectedTarget.id] || {};
        const inputAmount = parseInt(investmentDraft[type.id]?.toString() || '0') || 0;
        let currentLine = '';
        let previewLine = '';
        if (type.id === 'nufus') {
          currentLine = `Nüfus: ${formatCount(inv.nufus || 0)}`;
          if (inputAmount > 0) previewLine = `+${formatCount(Math.floor(inputAmount / POP_COST_PER_PERSON))} kişi · ülke geneline`;
        } else {
          const rate = INVESTMENT_RATES[type.id as 'tarim' | 'sanayi'];
          // Motorla aynı doygunluk eğrisi: gösterge gerçek getiriden sapmaz
          const raw = inv[type.id] || 0;
          const effCur = effectiveInvestment(raw);
          // Doluluk: bu bölgedeki kovanın ne kadarı dolu — %50'de yarı verim,
          // yüksekse parayı BAŞKA bölgeye taşı sinyali
          const fullness = Math.round(raw / (raw + INVESTMENT_SOFT_CAP) * 100);
          currentLine = `Üretim: ${formatMoney(effCur * rate)}/tur · doluluk %${fullness}${fullness >= 60 ? ' ⚠️ başka bölgeye yatır' : ''}`;
          if (inputAmount > 0) {
            const effNext = effectiveInvestment((inv[type.id] || 0) + inputAmount);
            previewLine = `→ ${formatMoney(effNext * rate)}/tur`;
          }
        }

        return (
          <div key={type.id} className="flex flex-col gap-0.5 mb-1 bg-slate-900/50 p-1.5 rounded border border-slate-800/50">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1">
                <span className="text-xs text-slate-300 block">{type.label}</span>
                <span className="text-[9px] text-slate-500">{type.hint}</span>
              </div>
              <Stepper
                value={investmentDraft[type.id] || 0}
                step={UI_STEPS[type.id]}
                format={formatMoney}
                onStep={stepDraft(setInvestmentDraft, type.id)}
              />
            </div>
            <div className="flex justify-between items-center text-[10px] mt-0.5">
              <span className="text-slate-500">{currentLine}</span>
              {previewLine && <span className="text-green-400 font-mono">{previewLine}</span>}
            </div>
          </div>
        );
      })}
      </div>

      {investmentCost > 0 && (
        <div className="flex justify-between items-center text-xs px-1 mb-1 shrink-0">
          <span className="text-slate-400">Toplam Maliyet:</span>
          <span className={`font-mono font-bold ${save.money >= investmentCost ? 'text-green-400' : 'text-red-400'}`}>
            {formatMoney(investmentCost)}
          </span>
        </div>
      )}
      <div className="flex gap-2 mt-1 shrink-0">
        <button
          onClick={() => { setShowInvestmentMenu(false); setInvestmentDraft({ tarim: '', sanayi: '', nufus: '' }); }}
          className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium border border-slate-600 transition-colors"
        >
          İptal
        </button>
        <button
          onClick={handleProduceInvestment}
          disabled={investmentCost === 0 || investmentCost > save.money}
          className={`flex-1 py-1 rounded text-xs font-medium border transition-colors ${
            investmentCost > 0 && investmentCost <= save.money
              ? 'bg-green-900/40 hover:bg-green-800/60 text-green-300 border-green-900/50'
              : 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
          }`}
        >
          Yatırım Yap
        </button>
      </div>
    </div>
  );

  // Ordu üretim menüsü — Türk illeri ve fethedilen ülkelerde ortak kullanılır
  // --- Sınır Hattı Savunması ---
  // Sınır ilinden açılırsa HEDEFLİ mod: tıklanan ilin yabancı komşu ülkelerine
  // sınır olan tüm illere kurar (Şanlıurfa → Suriye hattı). İç ilden açılırsa
  // TÜM SINIRLAR modu: elimizdeki bütün sınır illerine kurar — özellik hangi
  // ülke seçilirse seçilsin, hangi ile tıklanırsa tıklansın erişilebilir.
  const borderCids = selectedTarget && isPlayerRegion(save, selectedTarget.id)
    ? foreignNeighborCountries(save, selectedTarget.id) : [];
  const borderCountryNames = borderCids.map(cid => countryName(cid)).join(', ');
  const borderRegions = borderCids.length > 0
    ? borderRegionsWith(save, borderCids)
    : (selectedTarget && isPlayerRegion(save, selectedTarget.id) ? allBorderRegions(save) : []);
  const borderLabel = borderCids.length > 0 ? `${borderCountryNames} Sınırına` : 'Tüm Sınır Hattına';
  const borderAmounts = parseDraft(borderDraft);
  const borderPerRegionCost = (borderAmounts.kara_savunma || 0) * UNIT_COSTS.kara_savunma
    + (borderAmounts.hava_savunma || 0) * UNIT_COSTS.hava_savunma;
  const borderTotalCost = borderPerRegionCost * borderRegions.length;

  // Kurulum tek kaynaktan (mapWar.buildBorderDefense): maliyet ve bölge listesi
  // AYNI anda hesaplanır — render ile tıklama arasında tur ilerlese bile ödeme
  // uygulanan birimlerle asla sapmaz. Kurulan iller haritada flaşla gösterilir.
  const handleBuildBorderDefense = () => {
    const preview = buildBorderDefense(save, borderCids, borderAmounts);
    if (!preview) return;
    setSave(prev => buildBorderDefense(prev, borderCids, borderAmounts)?.save ?? prev);
    setMapFlash({ ids: preview.regions, seq: Date.now() });
    setBorderDraft({ kara_savunma: '', hava_savunma: '' });
    setShowBorderMenu(false);
  };

  const renderBorderMenu = () => (
    <div className="flex flex-col gap-1.5 w-full min-h-0">
      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5 shrink-0">
        SINIR HATTI SAVUNMASI — {borderCids.length > 0 ? borderCountryNames.toUpperCase() : 'TÜM SINIRLAR'}
      </span>
      <span className="text-[9px] text-slate-500 shrink-0">
        Seçtiğin adet, {borderCids.length > 0 ? `${borderCountryNames} sınırındaki` : 'tüm sınır hattındaki'} {borderRegions.length} ilin HER BİRİNE kurulur.
      </span>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 -mr-1 pr-1">
        {(['kara_savunma', 'hava_savunma'] as const).map(unitId => (
          <div key={unitId} className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <span className="text-xs text-slate-300 block">{UNIT_LABELS[unitId]} <span className="text-slate-500">/ bölge</span></span>
              <span className="text-[9px] text-slate-500">
                {formatMoney(UNIT_COSTS[unitId])}/adet · bakım {formatMoney(UNIT_COSTS[unitId] * 0.002)}/tur
              </span>
            </div>
            {(borderAmounts[unitId] || 0) > 0 && (
              <span className="text-[9px] text-yellow-400 font-mono">{formatMoney((borderAmounts[unitId] || 0) * UNIT_COSTS[unitId] * borderRegions.length)}</span>
            )}
            <Stepper
              value={borderDraft[unitId] || 0}
              step={UI_STEPS[unitId]}
              format={formatCount}
              onStep={stepDraft(setBorderDraft, unitId)}
            />
          </div>
        ))}
      </div>
      {borderTotalCost > 0 && (
        <div className="flex justify-between items-center text-xs px-1 mt-1 shrink-0">
          <span className="text-slate-400">Toplam ({borderRegions.length} bölge):</span>
          <span className={`font-mono font-bold ${save.money >= borderTotalCost ? 'text-green-400' : 'text-red-400'}`}>
            {formatMoney(borderTotalCost)}
          </span>
        </div>
      )}
      <div className="flex gap-2 mt-1 shrink-0">
        <button
          onClick={() => { setShowBorderMenu(false); setBorderDraft({ kara_savunma: '', hava_savunma: '' }); }}
          className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium border border-slate-600 transition-colors"
        >
          İptal
        </button>
        <button
          onClick={handleBuildBorderDefense}
          disabled={borderTotalCost === 0 || borderTotalCost > save.money || borderRegions.length === 0}
          className={`flex-1 py-1 rounded text-xs font-medium border transition-colors ${
            borderTotalCost > 0 && borderTotalCost <= save.money && borderRegions.length > 0
              ? 'bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-300 border-emerald-900/50'
              : 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
          }`}
        >
          {borderTotalCost > save.money ? 'Hazine Yetersiz' : 'Savunmayı Kur'}
        </button>
      </div>
    </div>
  );

  // ⚔️ BURADAN SALDIR: seçili KENDİ bölgemizin komşu düşman bölgeleri — dokun,
  // taarruz emri modalı açılır. Küçük düşman bölgesine haritadan nişan almak
  // (özellikle telefonda) zor; kısayol, sahiplenilen HER bölge panelinde durur.
  // (Eskiden yalnız "ele geçirilen bölge" panelindeydi; bayat-bayrak düzeltmesi
  // o paneli il paneline devrettiği için kısayol görünmez olmuştu — 2026-07-14.)
  const renderQuickAttackList = (provId: string) => {
    const enemyNeighbors = getProvinceNeighbors(provId).filter(n =>
      countryOfProvince(n) && canOrderAttack(save, n));
    if (enemyNeighbors.length === 0) return null;
    return (
      <div className="bg-slate-950/60 rounded p-2 border border-red-900/40">
        <span className="text-[9px] text-red-300 font-bold uppercase block mb-1.5">⚔️ BURADAN SALDIR</span>
        <div className="flex flex-col gap-1">
          {enemyNeighbors.map(n => {
            const g = save.enemyProvinceStrength[n] ?? 0;
            const queuedHere = save.pendingOrders.some(o => o.to === n && o.from === provId);
            return (
              <button
                key={n}
                onClick={() => setAttackTarget({ id: n, name: provinceDisplayName(n) })}
                className="flex justify-between items-center text-[10px] px-2 py-1.5 rounded border bg-red-950/40 hover:bg-red-900/50 border-red-900/50 text-red-200 transition-colors"
              >
                <span className="font-bold">{provinceDisplayName(n)} {queuedHere && '⚔️'}</span>
                <span className="font-mono text-red-300">🛡 {formatCount(g)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderArmyMenu = () => selectedTarget && (
    <div className="flex flex-col gap-1.5 w-full min-h-0">
      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5 shrink-0">BİRLİK ÜRETİMİ</span>
      {/* İaşe projeksiyonu: asker üretmek gıda talebini artırır — sonuç önceden görünsün */}
      {(() => {
        const draftAsker = armyAmounts.asker || 0;
        if (askerTotal + draftAsker === 0) return null;
        // Talep 0 (ordu muafiyet sınırının altında) = tam iaşe; armyFoodRatio ile aynı kural,
        // yoksa 0 tarımda 0/1 bölmesi "%0 tarım yetersiz" diye yanlış alarm veriyordu.
        const demandAfter = armyFoodDemand(askerTotal + draftAsker);
        const after = demandAfter <= 0 ? 1 : Math.min(1, armyFoodSupply(save) / demandAfter);
        const bad = (draftAsker > 0 ? after : foodRatio) < 1;
        return (
          <div className={`flex justify-between items-center text-[10px] px-2 py-1 rounded border shrink-0 ${
            bad ? 'bg-red-950/40 border-red-900/50 text-red-300' : 'bg-slate-950/60 border-slate-800 text-slate-400'
          }`}>
            <span>🌾 Ordu iaşesi</span>
            <span className="font-mono">
              %{Math.round(foodRatio * 100)}
              {draftAsker > 0 && ` → %${Math.round(after * 100)}`}
              {bad ? ' ⚠️ tarım yetersiz' : ''}
            </span>
          </div>
        );
      })()}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 -mr-1 pr-1">
      {Object.keys(EMPTY_UNIT_DRAFT).map(unitId => {
        const count = parseInt(armyDraft[unitId]?.toString() || '0') || 0;
        const existing = save.provinceUnits[selectedTarget.id]?.[unitId] || 0;
        const isRecruit = unitId === 'asker';
        // Deniz kısıtları: liman yalnız KIYI iline; gemi yalnız LİMANLI ile kurulur
        const coastal = isCoastalRegion(selectedTarget.id);
        const hasPort = (save.provinceUnits[selectedTarget.id]?.liman || 0) > 0;
        const lockReason = unitId === 'liman' && !coastal ? 'Denize kıyısı yok — liman kurulamaz'
          : unitId === 'gemi' && !coastal ? 'Denize kıyısı yok — gemi üslenemez'
          : unitId === 'gemi' && !hasPort ? 'Önce bu ilde LİMAN kur'
          : null;
        return (
          <div key={unitId} className={`flex items-center justify-between gap-2 ${lockReason ? 'opacity-50' : ''}`}>
            <div className="flex-1">
              <span className="text-xs text-slate-300 block">{UNIT_LABELS[unitId]}</span>
              <span className="text-[9px] text-slate-500">
                {formatMoney(UNIT_COSTS[unitId])}/adet · bakım {formatMoney(UNIT_COSTS[unitId] * (unitId === 'asker' || unitId === 'tank' || unitId === 'ucak' ? 0.005 : 0.002))}/tur
                {existing > 0 ? ` · mevcut ${formatCount(existing)}` : ''}
              </span>
              {unitId === 'gemi' && !lockReason && (
                <span className="text-[9px] text-cyan-300/80 block">Çıkarma gemisi: {formatCount(SHIP_CAPACITY)} ağırlık taşır (asker 1 · tank 25)</span>
              )}
              {lockReason && (
                <span className="text-[9px] text-amber-400/90 block">🌊 {lockReason}</span>
              )}
              {isRecruit && (
                <span className={`text-[9px] block ${armyRecruitsExceedPop ? 'text-red-400' : 'text-slate-500'}`}>
                  {selectedIsCapturedProv
                    ? 'İşgal bölgesinde asker devşirilemez — Ordu Çağır ile getir'
                    : `${selectedTarget.isProvince ? 'İl nüfusundan alınır' : 'Yerel halktan toplanır'} (nüfus: ${formatCount(recruitPool)})`}
                </span>
              )}
            </div>
            {count > 0 && (
              <span className="text-[9px] text-yellow-400 font-mono">{formatMoney(count * UNIT_COSTS[unitId])}</span>
            )}
            <Stepper
              value={armyDraft[unitId] || 0}
              step={UI_STEPS[unitId]}
              format={formatCount}
              onStep={lockReason ? () => {} : stepDraft(setArmyDraft, unitId, isRecruit ? recruitPool : undefined)}
            />
          </div>
        );
      })}
      </div>

      {armyCost > 0 && (
        <div className="flex justify-between items-center text-xs px-1 mt-1 shrink-0">
          <span className="text-slate-400">Toplam Maliyet:</span>
          <span className={`font-mono font-bold ${save.money >= armyCost ? 'text-green-400' : 'text-red-400'}`}>
            {formatMoney(armyCost)}
          </span>
        </div>
      )}
      <div className="flex gap-2 mt-1 shrink-0">
        <button
          onClick={() => { setShowArmyMenu(false); setArmyDraft(EMPTY_UNIT_DRAFT); }}
          className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium border border-slate-600 transition-colors"
        >
          İptal
        </button>
        <button
          onClick={handleProduceArmy}
          disabled={armyCost === 0 || armyCost > save.money || armyRecruitsExceedPop}
          className={`flex-1 py-1 rounded text-xs font-medium border transition-colors ${
            armyCost > 0 && armyCost <= save.money && !armyRecruitsExceedPop
              ? 'bg-red-900/40 hover:bg-red-800/60 text-red-300 border-red-900/50'
              : 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
          }`}
        >
          {armyRecruitsExceedPop ? 'Nüfus Yetersiz' : armyCost > save.money ? 'Hazine Yetersiz' : 'Üret'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-dvh bg-slate-950 text-slate-200 overflow-hidden">
      {/* Savaş Raporu Modalı */}
      {battleReports.length > 0 && (
        <BattleReportModal
          reports={battleReports}
          onClose={handleCloseBattleReports}
        />
      )}

      {/* Top HUD — relative + z-20: istatistik detay popover'ı bu bara çapalanır
          ve harita üstü öğelerin (z-10 filtre barı) üzerinde kalır */}
      <div className="relative flex justify-between items-center px-4 py-2 bg-slate-900 border-b border-slate-800 z-20 shrink-0 gap-3 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <div className="shrink-0">
            <h2 className="text-lg font-bold text-white leading-tight">{countryName(save.playerCountryId)}</h2>
            {/* data-testid + data-turn: E2E paketi turu metin ayrıştırmadan okur
                (metin biçimi değişse de test kırılmaz) */}
            <div data-testid="turn-indicator" data-turn={save.turn} className="text-[10px] font-mono text-slate-400">
              TUR {save.turn} | {['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][(save.turn - 1) % 12]} {2024 + Math.floor((save.turn - 1) / 12)}
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
            <button
              data-testid="next-turn"
              onClick={() => { setAutoPlaySpeed(null); nextTurn(); }}
              className={`px-3 py-1.5 rounded text-xs font-medium border mr-1 hit-target press-fx ${
                save.pendingOrders.length > 0
                  ? 'bg-red-900/50 hover:bg-red-800/60 active:bg-red-800 text-red-200 border-red-800/70'
                  : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 border-slate-700'
              }`}
            >
              Sonraki Tur{save.pendingOrders.length > 0 ? ` ⚔️${save.pendingOrders.length}` : ''}
            </button>
            <button onClick={() => setAutoPlaySpeed(null)} className={`p-1.5 rounded hit-target-sm press-fx ${autoPlaySpeed === null ? 'bg-blue-500/20 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`} title="Durdur">
              <Pause className="w-4 h-4" />
            </button>
            <button onClick={() => setAutoPlaySpeed(1500)} className={`p-1.5 rounded hit-target-sm press-fx ${autoPlaySpeed === 1500 ? 'bg-blue-500/20 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`} title="Normal Hız (1.5s)">
              <Play className="w-4 h-4" />
            </button>
            <button onClick={() => setAutoPlaySpeed(1000)} className={`p-1.5 rounded hit-target-sm press-fx ${autoPlaySpeed === 1000 ? 'bg-blue-500/20 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`} title="Hızlı (1s)">
              <FastForward className="w-4 h-4" />
            </button>
            <button onClick={() => setAutoPlaySpeed(500)} className={`p-1.5 rounded hit-target-sm press-fx ${autoPlaySpeed === 500 ? 'bg-blue-500/20 text-blue-400' : 'text-slate-500 hover:text-slate-300'}`} title="Çok Hızlı (0.5s)">
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dar ekranda (telefon dikey) satır SARAR: sabit genişlik + shrink-0 hali
            375px'te Menü butonunu ekran dışına taşırıyordu — oyuncu kaydedemiyor,
            çıkamıyor, vergi değiştiremiyordu (2026-07-14 mobil testi). */}
        {/* relative z-30: popover'ın clickOutside arka planının (z-20) ÜSTÜNDE kalır —
            panel açıkken başka bir istatistiğe tıklamak panele geçiş yapar, kapatmaz */}
        <div className="relative z-30 flex gap-x-3 sm:gap-x-4 gap-y-1 items-center flex-wrap justify-end min-w-0">
          <button
            onClick={() => toggleStatPanel('hazine')}
            aria-expanded={activeStatPanel === 'hazine'}
            title="Gelir ve gider detaylarını göster"
            className={`flex flex-col items-end text-right px-2 py-1 rounded-lg border cursor-pointer hit-target-sm press-fx ${
              activeStatPanel === 'hazine'
                ? 'bg-slate-800/80 border-slate-700'
                : 'border-transparent hover:bg-slate-800/60 active:bg-slate-800'
            }`}
          >
            <span className="text-[10px] text-slate-400 font-medium">HAZİNE</span>
            {/* data-money: E2E hazineyi animasyonlu metinden değil ham değerden okur */}
            <span data-testid="treasury" data-money={save.money} className="text-sm font-mono text-green-400 font-bold leading-tight"><AnimatedNumber value={save.money} format={formatMoney} /></span>
            <span className={`text-[9px] font-mono ${netIncome >= 0 ? 'text-green-600' : 'text-red-500'}`} title={`Gelir: +${formatMoney(income)} · Ordu bakımı: −${formatMoney(upkeep.total)}${upkeep.hunger > 0 ? ` (açlık zammı: ${formatMoney(upkeep.hunger)})` : ''}`}>
              {netIncome >= 0 ? '+' : ''}{formatMoney(netIncome)}/tur
              {upkeep.total > 0 && <span className="text-red-600/80"> · bakım {formatMoney(upkeep.total)}</span>}
              {askerTotal > 0 && (
                <span
                  className={foodRatio < 1 ? 'text-amber-400 font-bold' : 'text-slate-500'}
                  title={foodRatio < 1
                    ? 'Ordu iaşesi yetersiz: tarım, askerleri besleyemiyor — asker bakımı artıyor, halk huzursuz. Tarıma yatırım yapın.'
                    : 'Ordu iaşesi tam: tarım orduyu besliyor.'}
                > · 🌾 %{Math.round(foodRatio * 100)}</span>
              )}
            </span>
          </button>
          <button
            onClick={() => toggleStatPanel('nufus')}
            aria-expanded={activeStatPanel === 'nufus'}
            title="Bölge nüfusları ve büyüme detaylarını göster"
            className={`flex flex-col items-end text-right px-2 py-1 rounded-lg border cursor-pointer hit-target-sm press-fx ${
              activeStatPanel === 'nufus'
                ? 'bg-slate-800/80 border-slate-700'
                : 'border-transparent hover:bg-slate-800/60 active:bg-slate-800'
            }`}
          >
            <span className="text-[10px] text-slate-400 font-medium">NÜFUS</span>
            <span className="text-sm font-mono text-blue-400 font-bold leading-tight"><AnimatedNumber value={population} format={formatCount} /></span>
            <span className="text-[9px] font-mono text-blue-600">+{formatCount(popGrowth)}/tur</span>
          </button>
          <button
            onClick={() => toggleStatPanel('ordu')}
            aria-expanded={activeStatPanel === 'ordu'}
            title="Ordu kompozisyonu ve güç detaylarını göster"
            className={`flex flex-col items-end text-right px-2 py-1 rounded-lg border cursor-pointer hit-target-sm press-fx ${
              activeStatPanel === 'ordu'
                ? 'bg-slate-800/80 border-slate-700'
                : 'border-transparent hover:bg-slate-800/60 active:bg-slate-800'
            }`}
          >
            <span className="text-[10px] text-slate-400 font-medium">SALDIRI / SAVUNMA</span>
            <span className="text-sm font-mono text-red-400 font-bold leading-tight">
              {formatCount(armyPower)} / <span className="text-green-400">{formatCount(defensePower)}</span>
            </span>
            <span className="text-[9px] font-mono text-red-600">{save.conqueredCountryIds.length} fetih</span>
          </button>
          {/* Mutluluk & Vergi göstergesi */}
          <button
            onClick={() => setShowTaxPanel(!showTaxPanel)}
            className="flex items-center gap-2 cursor-pointer hover:bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/50 hover:opacity-100 hit-target-sm press-fx"
            title="Vergi & Mutluluk Ayarları"
          >
            <Coins className="w-5 h-5 text-yellow-500 shrink-0" />
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-400 font-medium">MUTLULUK & VERGİ</span>
              <span className="text-sm font-bold leading-tight" style={{
                color: (save.happiness ?? 70) >= 60 ? '#4ade80' : (save.happiness ?? 70) >= 40 ? '#fbbf24' : '#f87171'
              }}>
                {happinessEmoji(save.happiness ?? 70)} {Math.round(save.happiness ?? 70)}%
              </span>
              <span className="text-[9px] font-mono text-slate-500">
                Vergi: %{taxPct} · Güç: x{hMult.toFixed(2)}
              </span>
            </div>
          </button>
          <button
            onClick={() => { setAutoPlaySpeed(null); setShowPauseMenu(true); }}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-300 hit-target-sm press-fx"
            title="Menü"
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>

        {/* İstatistik detay popover'ı: bara çapalanır, dışarı tıklayınca kapanır */}
        {activeStatPanel && (
          <>
            {/* clickOutside: görünmez tam ekran arka plan, tıklanınca paneli kapatır */}
            <div className="fixed inset-0 z-20" onClick={() => setActiveStatPanel(null)} />
            <div className="absolute right-2 top-full mt-1 z-30 w-[min(26rem,calc(100vw-1rem))] max-h-[70dvh] overflow-y-auto bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-4">
              {activeStatPanel === 'hazine' && (() => {
                // computeIncome ile aynı formüller, kalem kalem (motorla senkron tut)
                let taxIncome = 0, farmIncome = 0, industryIncome = 0;
                for (const [provId, inv] of Object.entries(save.provinceInvestments)) {
                  if (save.occupiedProvinces[provId]) continue;
                  taxIncome += (inv.nufus || 0) * POP_TAX_PER_CAPITA * (save.taxRate ?? 0.20);
                  farmIncome += effectiveInvestment(inv.tarim || 0) * INVESTMENT_RATES.tarim;
                  industryIncome += effectiveInvestment(inv.sanayi || 0) * INVESTMENT_RATES.sanayi;
                }
                let conqueredIncome = 0;
                for (const id of save.conqueredCountryIds) conqueredIncome += conqueredCountryIncome(save, id);
                let tradeIncome = 0;
                for (const id of save.tradeDeals ?? []) {
                  if (save.conqueredCountryIds.includes(id)) continue;
                  tradeIncome += getAiEconomy(save, id).income * TRADE_INCOME_SHARE;
                }
                return (
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><Coins className="w-3.5 h-3.5 text-green-400" /> Hazine Detayı</h3>
                      <span className="text-sm font-mono text-green-400 font-bold">{formatMoney(save.money)}</span>
                    </div>
                    <DetailSection title={<>Gelirler · <span className="text-green-400">+{formatMoney(income)}/tur</span></>} color="text-green-600">
                      <DetailRow label={`Vergi geliri (oran: %${taxPct})`} sub="nüfus × kişi başı vergi × vergi oranı" value={`+${formatMoney(taxIncome)}`} color="text-green-400" />
                      <DetailRow label="Tarım getirisi" sub={`yatırımın %${INVESTMENT_RATES.tarim * 100}'i / tur`} value={`+${formatMoney(farmIncome)}`} color="text-green-400" />
                      <DetailRow label="Sanayi getirisi" sub={`yatırımın %${INVESTMENT_RATES.sanayi * 100}'i / tur`} value={`+${formatMoney(industryIncome)}`} color="text-green-400" />
                      {conqueredIncome > 0 && (
                        <DetailRow label={`Fethedilen ülkeler (${save.conqueredCountryIds.length})`} sub="devralınan gelir + halkın vergisi" value={`+${formatMoney(conqueredIncome)}`} color="text-green-400" />
                      )}
                      {tradeIncome > 0 && (
                        <DetailRow label={`Ticaret anlaşmaları (${(save.tradeDeals ?? []).filter(id => !save.conqueredCountryIds.includes(id)).length})`} sub={`ortak gelirinin %${TRADE_INCOME_SHARE * 100}'i`} value={`+${formatMoney(tradeIncome)}`} color="text-green-400" />
                      )}
                    </DetailSection>
                    <DetailSection title={<>Giderler · <span className="text-red-400">−{formatMoney(upkeep.total)}/tur</span></>} color="text-red-600">
                      <DetailRow label="Ordu bakımı" value={`−${formatMoney(upkeep.home)}`} color="text-red-400" />
                      {upkeep.hunger > 0 && (
                        <DetailRow label="Açlık zammı" sub={`ordu iaşesi %${Math.round(foodRatio * 100)} — tarım yetersiz`} value={`−${formatMoney(upkeep.hunger)}`} color="text-amber-400" />
                      )}
                    </DetailSection>
                    <div className="border-t border-slate-700/60 mt-3 pt-2">
                      <DetailRow
                        label={<span className="font-bold text-slate-300">Net akış</span>}
                        value={`${netIncome >= 0 ? '+' : ''}${formatMoney(netIncome)}/tur`}
                        color={`font-bold ${netIncome >= 0 ? 'text-green-400' : 'text-red-400'}`}
                      />
                    </div>
                  </div>
                );
              })()}

              {activeStatPanel === 'nufus' && (() => {
                const rows = Object.entries(save.provinceInvestments)
                  .map(([id, inv]) => ({
                    id,
                    pop: inv.nufus || 0,
                    rate: popGrowthRate(inv),
                    occupied: !!save.occupiedProvinces[id],
                  }))
                  .filter(r => r.pop > 0)
                  .sort((a, b) => b.pop - a.pop);
                const top = rows.slice(0, 8);
                const rest = rows.slice(8);
                const restPop = rest.reduce((s, r) => s + r.pop, 0);
                const occupiedCount = rows.filter(r => r.occupied).length;
                return (
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-blue-400" /> Nüfus Detayı</h3>
                      <span className="text-sm font-mono text-blue-400 font-bold">{formatCount(population)} · <span className="text-blue-600 text-[11px]">+{formatCount(popGrowth)}/tur</span></span>
                    </div>
                    <DetailSection title="Bölgelere göre dağılım" color="text-blue-600">
                      {top.map(r => (
                        <DetailRow
                          key={r.id}
                          label={<>{provinceDisplayName(r.id)}{r.occupied && <span className="text-red-400"> · işgal altında</span>}</>}
                          value={<>{formatCount(r.pop)} <span className={r.occupied ? 'text-slate-600' : 'text-blue-600'}>{r.occupied ? '· büyüme yok' : `+%${(r.rate * 100).toFixed(2)}/tur`}</span></>}
                          color="text-slate-200"
                        />
                      ))}
                      {rest.length > 0 && (
                        <DetailRow label={`… ve ${rest.length} bölge daha`} value={formatCount(restPop)} color="text-slate-400" />
                      )}
                    </DetailSection>
                    <DetailSection title="Büyüme çarpanları" color="text-blue-600">
                      <DetailRow label="Doğal artış" value={`+%${(POP_GROWTH_RATE * 100).toFixed(1)}/tur`} color="text-blue-400" />
                      <DetailRow label="Tarım bonusu" sub="kişi başı $100 tarım yatırımında tam bonus" value={`+%${(FARM_POP_BONUS_MAX * 100).toFixed(1)}'e kadar`} color="text-green-400" />
                      {occupiedCount > 0 && (
                        <DetailRow label={`İşgal altındaki bölgeler (${occupiedCount})`} sub="vergi ve büyüme katkısı kesik" value="büyüme durdu" color="text-red-400" />
                      )}
                    </DetailSection>
                  </div>
                );
              })()}

              {activeStatPanel === 'ordu' && (() => {
                const totals: Record<string, number> = {};
                for (const units of Object.values(save.provinceUnits))
                  for (const [t, c] of Object.entries(units)) totals[t] = (totals[t] || 0) + c;
                const allAsker = totals.asker || 0;
                const allTank = totals.tank || 0;
                const allUcak = totals.ucak || 0;
                const aaPower = computeAAPower(save.provinceUnits);
                return (
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><Swords className="w-3.5 h-3.5 text-red-400" /> Ordu Detayı</h3>
                      <span className="text-sm font-mono font-bold"><span className="text-red-400">{formatCount(armyPower)}</span> / <span className="text-green-400">{formatCount(defensePower)}</span></span>
                    </div>
                    <DetailSection title="Aktif birlikler" color="text-red-600">
                      <DetailRow label={`${UNIT_LABELS.asker} (piyade)`} sub={`saldırı ×${LAND_ATTACK.asker} · savunma ×${LAND_DEFENSE.asker}`} value={formatCount(allAsker)} />
                      <DetailRow label={UNIT_LABELS.tank} sub={`saldırı ×${LAND_ATTACK.tank} · savunma ×${LAND_DEFENSE.tank}`} value={formatCount(allTank)} />
                      <DetailRow label={UNIT_LABELS.ucak} sub={`bombardıman ×${formatCount(BOMBARDMENT_POWER)}`} value={formatCount(allUcak)} />
                      {(totals.kara_savunma || 0) > 0 && (
                        <DetailRow label={UNIT_LABELS.kara_savunma} sub={`savunma ×${LAND_DEFENSE.kara_savunma}`} value={formatCount(totals.kara_savunma)} />
                      )}
                      {(totals.hava_savunma || 0) > 0 && (
                        <DetailRow label={UNIT_LABELS.hava_savunma} sub="düşman hava akınını kırar" value={`${formatCount(totals.hava_savunma)} · AA ${formatCount(aaPower)}`} />
                      )}
                      {(totals.liman || 0) > 0 && (
                        <DetailRow label={UNIT_LABELS.liman} sub="deniz aşırı sefer kapasitesi" value={formatCount(totals.liman)} />
                      )}
                    </DetailSection>
                    <DetailSection title="Güç çarpanları" color="text-red-600">
                      <DetailRow label={`Mutluluk çarpanı ${happinessEmoji(save.happiness ?? 70)}`} sub="tüm saldırı ve savunma gücünü çarpar" value={`x${hMult.toFixed(2)}`} color={hMult >= 1 ? 'text-green-400' : 'text-amber-400'} />
                      <DetailRow label="Ordu iaşesi 🌾" sub={foodRatio < 1 ? 'tarım orduyu besleyemiyor — bakım artıyor' : 'tarım orduyu tam besliyor'} value={`%${Math.round(foodRatio * 100)}`} color={foodRatio < 1 ? 'text-amber-400' : 'text-green-400'} />
                      {save.wars.length > 0 && (
                        <DetailRow label={`Aktif savaşlar (${save.wars.length})`} sub={`savaş yorgunluğu −${warWeariness(save.wars).toFixed(1)} mutluluk/tur`} value="⚔️" color="text-orange-400" />
                      )}
                    </DetailSection>
                    <DetailSection title={`Fetihler (${save.conqueredCountryIds.length})`} color="text-red-600">
                      {save.conqueredCountryIds.length === 0 && (
                        <DetailRow label="Henüz fetih yok" sub="fethedilen ülkelerin geliri ve toprağı orduya katılır" value="—" color="text-slate-500" />
                      )}
                      {/* TÜM fetihler listelenir; uzarsa bölüm kendi içinde kayar
                          (özet satırıyla kırpma yok — oyuncu her fethini görmeli) */}
                      <div className="max-h-56 overflow-y-auto -mr-1 pr-1">
                        {save.conqueredCountryIds.map(id => (
                          <DetailRow
                            key={id}
                            label={save.conqueredNames?.[id] ?? countryName(id)}
                            sub="gelir katkısı (eyalet yatırımları dahil) — garnizon bölgede konuşlu"
                            value={`+${formatMoney(conqueredCountryTotalIncome(save, id))}/tur`}
                            color="text-green-400"
                          />
                        ))}
                      </div>
                    </DetailSection>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* Vergi Paneli (açılır kapanır) */}
      {showTaxPanel && (
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 z-10 shrink-0">
          {/* Dar ekranda (sm altı) kaydırıcı satırı alta sarar — 375px'te panel
              taşmasın; geniş ekranda eski tek satırlı düzen korunur */}
          <div className="flex items-center justify-between max-w-xl mx-auto flex-wrap sm:flex-nowrap gap-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-950/40 rounded-lg border border-slate-800">
                <Percent className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-200">Vergi Oranı: %{taxPct}</div>
                <div className="text-[9px] text-slate-500">Mutluluk hedefi = %100 − vergi · Yüksek vergi → düşük mutluluk → zayıf ordu</div>
                {save.wars.length > 0 && (
                  <div className="text-[9px] text-orange-400">
                    ⚔️ Savaş yorgunluğu: −{warWeariness(save.wars).toFixed(1)} mutluluk/tur ({save.wars.length} aktif savaş)
                  </div>
                )}
              </div>
            </div>
            {/* Dar ekranda −/slider/+ grubu ile mutluluk+kapat bloğu alt alta sarar,
                yoksa X butonu 375px'te sağdan taşıp erişilmez oluyor */}
            <div className="flex items-center justify-center gap-3 flex-wrap sm:flex-nowrap w-full sm:w-auto">
              {/* −/+ butonları: görsel 32px, dokunma alanı hit-target-sm ile 44px
                  (bar ile orantılı görünüm + mobil erişilebilirlik birlikte) */}
              <div className="flex items-center justify-center gap-1">
                <button
                  {...taxMinusHold}
                  disabled={taxPct <= 0}
                  className="w-8 h-8 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border border-slate-700 text-slate-300 hit-target-sm press-fx"
                  title={`Vergiyi %${taxStep} azalt`}
                  aria-label={`Vergiyi %${taxStep} azalt`}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step={taxStep}
                  value={taxPct}
                  onChange={(e) => handleTaxChange(parseFloat(e.target.value))}
                  className="w-40 h-2 accent-blue-500 cursor-pointer"
                />
                <button
                  {...taxPlusHold}
                  disabled={taxPct >= 100}
                  className="w-8 h-8 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border border-slate-700 text-slate-300 hit-target-sm press-fx"
                  title={`Vergiyi %${taxStep} artır`}
                  aria-label={`Vergiyi %${taxStep} artır`}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="text-right min-w-[80px]">
                <div className="text-xs font-mono" style={{
                  color: (save.happiness ?? 70) >= 60 ? '#4ade80' : (save.happiness ?? 70) >= 40 ? '#fbbf24' : '#f87171'
                }}>
                  {happinessEmoji(save.happiness ?? 70)} {Math.round(save.happiness ?? 70)}%
                </div>
                <div className="text-[9px] text-slate-500 font-mono">
                  Güç çarpanı: x{hMult.toFixed(2)}
                </div>
              </div>
              <button
                onClick={() => setShowTaxPanel(false)}
                className="p-1 text-slate-400 hover:text-white rounded hit-target press-fx"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Map Area */}
      <div className="flex-1 relative min-h-0">
        {/* Map Filters */}
        <div className="absolute top-2 right-2 z-10 bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-lg p-1.5 flex gap-1 shadow-lg max-w-[calc(100%-1rem)] overflow-x-auto">
          {[
            { id: 'asker', icon: Swords, color: 'text-red-400', label: 'Asker' },
            { id: 'tank', icon: Shield, color: 'text-yellow-400', label: 'Tank' },
            { id: 'ucak', icon: Plane, color: 'text-blue-400', label: 'Uçak' },
            { id: 'liman', icon: Anchor, color: 'text-cyan-400', label: 'Liman' },
            { id: 'hava_savunma', icon: Rocket, color: 'text-purple-400', label: 'Hava Savunma' },
            { id: 'kara_savunma', icon: Castle, color: 'text-green-500', label: 'Kara Savunma' },
            { id: 'tarim', icon: Tractor, color: 'text-green-400', label: 'Tarım' },
            { id: 'sanayi', icon: Factory, color: 'text-yellow-500', label: 'Sanayi' },
            { id: 'nufus', icon: Users, color: 'text-orange-400', label: 'Nüfus' },
          ].map(filter => {
            const Icon = filter.icon;
            const isActive = activeFilters.includes(filter.id);
            return (
              <button
                key={filter.id}
                onClick={() => toggleFilter(filter.id)}
                title={filter.label}
                className={`p-1.5 rounded hit-target-sm press-fx ${isActive ? 'bg-slate-800 shadow-inner' : 'opacity-40 hover:opacity-100 hover:bg-slate-800/50 grayscale'}`}
              >
                <Icon className={`w-4 h-4 ${isActive ? filter.color : 'text-slate-400'}`} />
              </button>
            );
          })}
        </div>

        {/* Tur özeti şeridi: sessiz turlarda bile "bu tur ne oldu" nabzı */}
        {turnSummary && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 bg-slate-900/90 backdrop-blur-md border border-slate-700/70 rounded-full text-[10px] font-mono flex items-center gap-2.5 shadow-lg pointer-events-none whitespace-nowrap">
            <span className="text-slate-500">Tur {turnSummary.turn}</span>
            <span className={turnSummary.money >= 0 ? 'text-green-400' : 'text-red-400'}>
              {turnSummary.money >= 0 ? '+' : ''}{formatMoney(turnSummary.money)}
            </span>
            <span className={turnSummary.happy >= 0 ? 'text-yellow-300' : 'text-orange-400'}>
              {happinessEmoji(save.happiness ?? 70)} {turnSummary.happy >= 0 ? '+' : ''}{turnSummary.happy.toFixed(1)}
            </span>
            <span className="text-blue-400">👥 +{formatCount(Math.max(0, turnSummary.pop))}</span>
          </div>
        )}

        {/* Bağlama duyarlı başlangıç ipuçları: ilk fetihe kadar "sırada ne var"
            rehberi. Durumdan türetilir (ayrı adım state'i yok — her zaman geçerli
            tavsiye). İl paneli açıkken gizlenir (aynı köşeyi paylaşırlar). */}
        {(() => {
          if (save.tutorialDismissed || save.conqueredCountryIds.length > 0 || selectedTarget) return null;
          const hint = save.wars.length === 0
            ? (armyPower <= 0
              ? { step: 1, text: 'Bir iline dokun → Ordu → asker ve tank üret. Ordusuz devlet hedef olur.' }
              : { step: 2, text: 'Zayıf bir komşuya dokun ve savaş ilan et — komşu ordular her tur büyür, erken savaş ucuzdur.' })
            : ((save.pendingOrders ?? []).length === 0
              ? { step: 3, text: 'Kırmızı düşman bölgesine dokun → Taarruz Emri Ver → birlikleri seç.' }
              : { step: 4, text: "Sonraki Tur'a bas — emirler tur sonunda işlenir. Tüm bölgeleri al, ülkeyi fethet!" });
          return (
            <div className="absolute top-2 left-2 z-10 max-w-[250px] p-2.5 bg-indigo-950/90 backdrop-blur-md border border-indigo-700/60 rounded-lg shadow-xl flex items-start gap-2">
              <span className="text-[10px] font-black text-indigo-300 bg-indigo-900/80 rounded px-1.5 py-0.5 shrink-0">{hint.step}/4</span>
              <span className="text-[11px] text-indigo-100 leading-snug flex-1">{hint.text}</span>
              <button
                onClick={() => setSave(prev => ({ ...prev, tutorialDismissed: true }))}
                className="text-indigo-400 hover:text-white shrink-0"
                aria-label="İpuçlarını kapat"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })()}

        <WorldMap
          selectedId={selectedTarget?.id || null}
          onSelect={(id, name) => handleTargetSelect(id, name, isPlayerRegion(save, id) || !!save.occupiedProvinces[id])}
          playerCountryId={save.playerCountryId}
          playerColor={save.playerColor}
          provinceUnits={save.provinceUnits}
          provinceInvestments={save.provinceInvestments}
          activeFilters={activeFilters}
          conqueredCountryIds={save.conqueredCountryIds}
          warCountryIds={save.wars.map(w => w.countryId)}
          occupiedProvinces={save.occupiedProvinces}
          wars={save.wars}
          capturedEnemyProvinces={save.capturedEnemyProvinces}
          enemyProvinceStrength={save.enemyProvinceStrength}
          occupiedGarrisons={save.occupiedGarrisons}
          orders={save.pendingOrders}
          battleFlash={mapFlash}
        />

        {/* Aktif savaşlar paneli */}
        {visibleWars.length > 0 && (
          <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 max-w-[260px]">
            {underInvasion && (
              <div className="bg-slate-900/90 backdrop-blur-md border border-orange-700/60 rounded-lg px-2.5 py-1.5 shadow-xl">
                <span className="text-[10px] text-orange-300 font-medium">Savunma Gücün: <span className="font-mono">{formatCount(defensePower)}</span></span>
              </div>
            )}
            {visibleWars.map(war => {
              const pct = Math.round((1 - war.enemyStrength / war.enemyMaxStrength) * 100);
              const isInvasion = war.initiator === 'ai';
              const occupiedCount = Object.values(save.occupiedProvinces).filter(id => id === war.countryId).length;
              const peace = peaceInfo(war);
              return (
                <div key={warKey(war)} className={`relative bg-slate-900/90 backdrop-blur-md border rounded-lg p-2.5 pr-6 shadow-xl ${isInvasion ? 'border-orange-600/70' : 'border-red-900/60'}`}>
                  <button
                    onClick={() => dismissWar(war)}
                    className="absolute top-1.5 right-1.5 p-0.5 text-slate-500 hover:text-white hover:bg-slate-700 rounded transition-colors"
                    title="Kapat"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold flex items-center gap-1.5 ${isInvasion ? 'text-orange-300' : 'text-red-300'}`}>
                      <Swords className="w-3 h-3" /> {war.countryName}
                      {isInvasion && <span className="text-[8px] font-normal text-orange-400/80">(saldırıyor)</span>}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">%{pct}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded overflow-hidden mb-1">
                    <div className={`h-full transition-all duration-500 ${isInvasion ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-1.5">
                    <span>{isInvasion ? 'Saldıran güç' : 'Düşman'}: {formatCount(war.enemyStrength)}</span>
                    {occupiedCount > 0
                      ? <span className="text-orange-400">{occupiedCount} il işgalde</span>
                      : war.lastPlayerLoss > 0 && <span className="text-red-400">Zayiat: -{formatCount(war.lastPlayerLoss)}</span>}
                  </div>
                  {/* Eyalet ilerlemesi + emir ipucu */}
                  {(() => {
                      const progress = warProvinceProgress(save, war.countryId);
                      const myOrders = save.pendingOrders.filter(o => countryOfProvince(o.to) === war.countryId
                        || save.occupiedProvinces[o.to] === war.countryId);
                      // Garnizonsuz ele geçirilen bölge: düşman garnizonu komşusundaysa
                      // aynı turda GERİ ALIR — oyuncu bunu savaş kartında görmeli.
                      const undefendedCaptured = (save.capturedEnemyProvinces ?? []).filter(id =>
                        countryOfProvince(id) === war.countryId
                        && ((save.provinceUnits[id]?.asker ?? 0) + (save.provinceUnits[id]?.tank ?? 0)) <= 0);
                      return (
                        <div className="mb-1.5">
                          <div className="flex justify-between text-[9px] font-mono text-slate-400">
                            <span>Ele geçirilen: <span className="text-blue-300 font-bold">{progress.captured}/{progress.total}</span> bölge</span>
                            {myOrders.length > 0 && <span className="text-red-300">{myOrders.length} emir kuyrukta</span>}
                          </div>
                          {undefendedCaptured.length > 0 && (
                            <span className="text-[9px] text-orange-400 font-medium block mt-0.5">
                              🏳️ {undefendedCaptured.length} ele geçirilen bölge SAVUNMASIZ — düşman geri alabilir ({undefendedCaptured.slice(0, 2).map(provinceDisplayName).join(', ')}{undefendedCaptured.length > 2 ? '…' : ''})
                            </span>
                          )}
                          {progress.captured < progress.total && myOrders.length === 0 && (
                            <span className="text-[9px] text-yellow-400 font-medium block mt-0.5">
                              ⚠️ Taarruz emri yok — haritada düşman iline dokun
                            </span>
                          )}
                          {/* Savaşı Bitir (İlhak): AI kabul/ret önizlemesiyle kompakt teklif */}
                          {progress.captured > 0 && (() => {
                            const decision = evaluateAnnexOffer(save, war.countryId, armyPower);
                            if (!decision) return null;
                            const cooldownLeft = Math.max(0, (save.annexOffers?.[war.countryId] ?? 0) - save.turn);
                            return (
                              <button
                                onClick={() => setSave(prev =>
                                  applyAnnexOffer(prev, war.countryId, armyPower)?.save ?? prev)}
                                disabled={cooldownLeft > 0}
                                title={decision.factors.length > 0
                                  ? decision.factors.map(f => `${f.delta > 0 ? '+' : ''}${f.delta} ${f.label}`).join('\n')
                                  : 'Belirleyici etken yok (0 puan)'}
                                className={`w-full mt-1 py-1 rounded text-[10px] font-medium border transition-colors press-fx ${
                                  cooldownLeft > 0
                                    ? 'bg-slate-800/50 text-slate-600 border-slate-700/50 cursor-not-allowed'
                                    : decision.accepted
                                      ? 'bg-green-900/40 hover:bg-green-800/60 text-green-300 border-green-900/50'
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-600'
                                }`}
                              >
                                {cooldownLeft > 0
                                  ? `🏳️ Teklif reddedildi — ${cooldownLeft} tur`
                                  : `🏳️ İlhakla bitir · puan ${decision.score}/${ANNEX_ACCEPT_THRESHOLD} → ${decision.accepted ? 'kabul eder' : 'reddeder'}`}
                              </button>
                            );
                          })()}
                          {/* Geri Çekilme: bedelsiz ama topraksız çıkış (iki dokunuşlu onay) */}
                          <button
                            onClick={() => confirmTap(`retreat-${war.countryId}`, () =>
                              setSave(prev => retreatFromWar(prev, war.countryId)))}
                            title={`Ele geçirilen bölgeler iade edilir; −${RETREAT_HAPPINESS_COST} mutluluk. Savaş ${RETREAT_TRUCE_MIN_WAR_TURNS}+ tur sürdüyse ${RETREAT_TRUCE_DURATION} tur kısa ateşkes (erken kaçış ateşkes vermez). Bedel ödenmez.`}
                            className={`w-full mt-1 py-1 rounded text-[10px] font-medium border transition-colors press-fx ${
                              confirmKey === `retreat-${war.countryId}`
                                ? 'bg-amber-900/50 hover:bg-amber-800/60 text-amber-200 border-amber-700/60'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-600'
                            }`}
                          >
                            {confirmKey === `retreat-${war.countryId}`
                              ? `⚠️ Emin misin? Bölgeler iade, −${RETREAT_HAPPINESS_COST} mutluluk`
                              : '🏃 Geri Çekil'}
                          </button>
                        </div>
                      );
                    })()}
                  <button
                    onClick={() => handleSignPeace(war.countryId)}
                    disabled={!peace.affordable}
                    className={`w-full py-1 rounded text-[10px] font-medium border transition-colors ${
                      peace.affordable
                        ? peace.cost > 0
                          ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'
                          : 'bg-green-900/40 hover:bg-green-800/60 text-green-300 border-green-900/50'
                        : 'bg-slate-800/50 text-slate-600 border-slate-700/50 cursor-not-allowed'
                    }`}
                  >
                    {peace.affordable ? peace.label : `${peace.label} (hazine yetersiz)`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Emir kuyruğu: tur sonunda işlenecek taarruzlar — tek dokunuşla iptal */}
        {save.pendingOrders.length > 0 && (
          <div className="absolute bottom-4 right-4 z-10 bg-slate-900/90 backdrop-blur-md border border-red-900/60 rounded-lg shadow-xl max-w-[250px] flex flex-col">
            <div className="px-2.5 py-1.5 border-b border-slate-800 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-red-300 tracking-wider">⚔️ EMİR KUYRUĞU ({save.pendingOrders.length})</span>
              <span className="text-[8px] text-slate-500">tur sonunda işlenir · İptal ile geri al</span>
            </div>
            <div className="max-h-[140px] overflow-y-auto p-1.5 flex flex-col gap-1">
              {save.pendingOrders.map(order => (
                <div key={order.id} className="flex items-center justify-between gap-1.5 bg-slate-950/60 rounded px-1.5 py-1 border border-slate-800/60">
                  <div className="min-w-0">
                    <span className="text-[9px] text-slate-300 font-medium block truncate">
                      {order.type === 'MOVE' ? '🔁 ' : '⚔️ '}{provinceDisplayName(order.from)} → {provinceDisplayName(order.to)}
                    </span>
                    <span className="text-[8px] font-mono text-slate-500">
                      {order.units.asker > 0 && `🪖${formatCount(order.units.asker)} `}
                      {order.units.tank > 0 && `🛡️${formatCount(order.units.tank)} `}
                      {order.units.ucak > 0 && `✈️${formatCount(order.units.ucak)}`}
                    </span>
                  </div>
                  <button
                    onClick={() => setSave(prev => cancelOrder(prev, order.id))}
                    className="px-2 py-1 text-[9px] font-bold text-red-300 bg-red-950/50 hover:bg-red-900/70 border border-red-900/60 rounded shrink-0 hit-target-sm press-fx"
                    title="Emri iptal et — birlikler serbest kalır, tur sonunda hiçbir şey olmaz"
                  >
                    ✕ İptal
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Durum uyarıları — her biri kapatılabilir, koşul çözülünce kendini sıfırlar */}
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 flex flex-col gap-2 items-center">
          {save.money + income < upkeep.total && !dismissedBannerKeys.includes('upkeep') && (
            <div className="relative bg-red-950/95 text-red-200 pl-4 pr-8 py-2 rounded-lg border border-red-500 shadow-xl text-sm font-medium">
              💸 Hazine ordu bakımını karşılayamıyor (−{formatMoney(upkeep.total - income)}/tur açık) — birlikler firar edecek! Vergiyi artırın, ordu küçültün veya barış yapın.
              <button onClick={() => dismissBanner('upkeep')} className="absolute top-1.5 right-1.5 p-0.5 text-red-300 hover:text-white hover:bg-red-800 rounded transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {save.wars.some(w => w.initiator === 'player') && armyPower <= 0 && !dismissedBannerKeys.includes('noarmy') && (
            <div className="relative bg-red-900/90 text-red-200 pl-4 pr-8 py-2 rounded-lg border border-red-600 shadow-xl text-sm font-medium">
              ⚠️ Savaştayız ama ordumuz kalmadı! Bir ilde birlik üretin.
              <button onClick={() => dismissBanner('noarmy')} className="absolute top-1.5 right-1.5 p-0.5 text-red-300 hover:text-white hover:bg-red-800 rounded transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {underInvasion && defensePower <= 0 && !dismissedBannerKeys.includes('nodefense') && (
            <div className="relative bg-orange-900/90 text-orange-200 pl-4 pr-8 py-2 rounded-lg border border-orange-600 shadow-xl text-sm font-medium">
              🛡️ Sınırlarımız savunmasız! Hava/kara savunma veya ordu kurun.
              <button onClick={() => dismissBanner('nodefense')} className="absolute top-1.5 right-1.5 p-0.5 text-orange-300 hover:text-white hover:bg-orange-800 rounded transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Olay bildirimleri */}
        {events.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col gap-2 items-center pointer-events-none">
            {events.map((event, i) => (
              <div
                key={`${event.message}-${i}`}
                className={`px-4 py-2 rounded-lg border shadow-xl text-sm font-medium ${
                  event.type === 'conquest'
                    ? 'bg-amber-900/90 border-amber-600 text-amber-200'
                    : event.type === 'invasion' || event.type === 'occupation'
                    ? 'bg-orange-900/90 border-orange-600 text-orange-200'
                    : event.type === 'liberation'
                    ? 'bg-green-900/90 border-green-600 text-green-200'
                    : event.type === 'peace'
                    ? 'bg-blue-900/90 border-blue-600 text-blue-200'
                    : 'bg-red-900/90 border-red-700 text-red-200'
                }`}
              >
                {event.type === 'conquest' ? '🏆 ' : event.type === 'occupation' ? '🚨 ' : event.type === 'liberation' ? '🎖️ ' : event.type === 'peace' ? '🕊️ ' : event.type === 'invasion' ? '🛡️ ' : '⚔️ '}{event.message}
              </div>
            ))}
          </div>
        )}

        {/* Seçili il/ülke paneli — z-20: savaş kartlarının (bottom-left z-10) ÜSTÜNDE
            kalır; uzun üretim panelinde Üret/İptal butonları kartın altında
            tıklanamaz oluyordu */}
        {selectedTarget && (
          <div className="absolute top-2 left-2 z-20 p-3 bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-lg max-w-xs shadow-xl min-w-[250px] max-h-[calc(100%-1rem)] flex flex-col">
            <div className="flex justify-between items-start mb-1 shrink-0">
              <h3 className="font-bold text-white flex items-center gap-2">
                {selectedTarget.isProvince && <MapPin className="w-4 h-4 text-blue-400" />}
                {selectedTarget.name}
              </h3>
              <button
                onClick={() => setSelectedTarget(null)}
                className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded p-1 transition-colors"
              >
                <span className="sr-only">Kapat</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            {selectedTarget.id === save.playerCountryId ? (
              /* ---------------- TÜRKİYE PANELİ ---------------- */
              <div className="flex flex-col gap-2 w-full flex-1 min-h-0">
                <div className="bg-slate-950/60 rounded p-2 border border-slate-800 text-center shrink-0">
                  <span className="text-[10px] text-slate-500 block">TOPLAM ORDU GÜCÜ</span>
                  <span className="font-mono text-red-400 font-bold text-lg">{formatCount(armyPower)}</span>
                </div>

                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5 shrink-0">İLLERİMİZ (Yönetmek için seçin)</span>
                
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 pr-1 border border-slate-800 rounded bg-slate-950/30 p-1">
                  {Object.keys(save.provinceInvestments)
                    .sort((a, b) => regionName(a).localeCompare(regionName(b), 'tr'))
                    .map(provId => {
                      const name = regionName(provId);
                      const pop = save.provinceInvestments[provId]?.nufus || 0;
                      const units = save.provinceUnits[provId] || {};
                      const isOccupied = !!save.occupiedProvinces[provId];
                      const totalUnitsCount = Object.values(units).reduce((sum, count) => sum + count, 0);

                      return (
                        <button
                          key={provId}
                          onClick={() => handleTargetSelect(provId, name, true)}
                          className={`w-full text-left p-1.5 rounded transition-all text-xs flex justify-between items-center ${
                            isOccupied 
                              ? 'bg-red-950/20 hover:bg-red-950/40 border border-red-900/40 text-red-200' 
                              : 'bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 text-slate-300'
                          }`}
                        >
                          <div>
                            <span className="font-bold">{name}</span>
                            <span className="text-[9px] text-slate-500 block">Nüfus: {formatCount(pop)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isOccupied && <span className="text-[9px] bg-red-900/60 text-red-200 px-1 py-0.5 rounded font-medium">İşgalde</span>}
                            {totalUnitsCount > 0 && (
                              <span className="text-[9px] bg-slate-800 text-slate-200 px-1 py-0.5 rounded font-mono">
                                {formatCount(totalUnitsCount)} birlik
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            ) : selectedTarget.isProvince && save.occupiedProvinces[selectedTarget.id] ? (
              /* ---------------- İŞGAL ALTINDAKİ İL ---------------- */
              (() => {
                const occupierId = save.occupiedProvinces[selectedTarget.id];
                const occupierName = countryName(occupierId);
                const garrison = save.occupiedGarrisons?.[selectedTarget.id] ?? 50_000;
                
                return (
                  <div className="flex flex-col gap-2 w-full">
                    <div className="flex items-center gap-2 py-1.5 px-2 bg-red-950/70 border border-red-800 rounded-lg text-xs text-red-300 font-bold shadow-md">
                      <span className="animate-pulse">🚨</span> {occupierName.toUpperCase()} İŞGALİ ALTINDA
                    </div>
                    
                    <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Düşman Garnizon Gücü:</span>
                        <span className="font-mono font-bold text-red-400 text-sm">{formatCount(garrison)}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        İl geliri tamamen kesildi. Komşu illerden taarruz emri ver — emir tur sonunda işlenir,
                        güç oranı R ≥ 1.5 olursa il tek turda kurtulur.
                      </p>
                    </div>

                    {(() => {
                      const queued = save.pendingOrders.filter(o => o.to === selectedTarget.id);
                      if (queued.length === 0) return null;
                      return (
                        <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-2 text-[10px] text-red-200">
                          ⚔️ {queued.length} taarruz emri kuyrukta — tur sonunda saldırılacak
                        </div>
                      );
                    })()}

                    <button
                      onClick={() => setAttackTarget({ id: selectedTarget.id, name: selectedTarget.name })}
                      className="w-full py-3 bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-extrabold rounded-lg text-xs tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-md shadow-red-950/30"
                    >
                      <Swords className="w-4 h-4" /> KURTARMA TAARRUZU EMRİ VER
                    </button>
                  </div>
                );
              })()
            ) : selectedTarget.isProvince ? (
              /* ---------------- İL PANELİ ---------------- */
              <div className="flex gap-2 w-full flex-1 min-h-0">
                {showInvestmentMenu ? (
                  renderInvestmentMenu()
                ) : showArmyMenu ? (
                  renderArmyMenu()
                ) : showBorderMenu ? (
                  renderBorderMenu()
                ) : showGatherMenu ? (
                  renderGatherMenu()
                ) : showDisbandMenu ? (
                  (() => {
                    const units = save.provinceUnits[selectedTarget.id] || {};
                    const disbandAmounts = parseDraft(disbandDraft);
                    const peopleBack = disbandAmounts.asker || 0;
                    const salvage = Object.entries(disbandAmounts).reduce((sum, [type, count]) =>
                      type === 'asker' ? sum : sum + (UNIT_COSTS[type] || 0) * count * SALVAGE_RATE, 0);
                    const upkeepSaved = Object.entries(disbandAmounts).reduce((sum, [type, count]) => {
                      const rate = type === 'asker' || type === 'tank' || type === 'ucak' ? 0.005 : 0.002;
                      return sum + (UNIT_COSTS[type] || 0) * rate * count;
                    }, 0);
                    const hasAny = peopleBack > 0 || salvage > 0 || Object.keys(disbandAmounts).length > 0;
                    const unitTypes = Object.keys(EMPTY_UNIT_DRAFT).filter(t => (units[t] || 0) > 0);
                    return (
                      <div className="flex flex-col gap-1.5 w-full min-h-0">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5 shrink-0">TERHİS — ordu küçült, bakımdan kurtul</span>
                        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 -mr-1 pr-1">
                          {unitTypes.length === 0 && (
                            <span className="text-[10px] text-slate-500 text-center py-3">Bu ilde terhis edilecek birlik yok.</span>
                          )}
                          {unitTypes.map(unitId => (
                            <div key={unitId} className="flex items-center justify-between gap-2">
                              <div className="flex-1">
                                <span className="text-xs text-slate-300 block">{UNIT_LABELS[unitId]}</span>
                                <span className="text-[9px] text-slate-500">
                                  mevcut {formatCount(units[unitId])} · {unitId === 'asker' ? 'nüfusa döner' : `hurda: ${formatMoney((UNIT_COSTS[unitId] || 0) * SALVAGE_RATE)}/adet`}
                                </span>
                              </div>
                              <Stepper
                                value={disbandDraft[unitId] || 0}
                                step={UI_STEPS[unitId]}
                                format={formatCount}
                                onStep={stepDraft(setDisbandDraft, unitId, units[unitId] || 0)}
                              />
                            </div>
                          ))}
                        </div>
                        {hasAny && (
                          <div className="text-[9px] text-slate-400 px-1 shrink-0">
                            {peopleBack > 0 && <span className="text-blue-300">+{formatCount(peopleBack)} kişi nüfusa döner · </span>}
                            {salvage > 0 && <span className="text-green-300">hurda geliri +{formatMoney(salvage)} · </span>}
                            <span className="text-green-400">bakım tasarrufu {formatMoney(upkeepSaved)}/tur</span>
                          </div>
                        )}
                        <div className="flex gap-2 mt-1 shrink-0">
                          <button
                            onClick={() => { setShowDisbandMenu(false); setDisbandDraft(EMPTY_UNIT_DRAFT); }}
                            className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium border border-slate-600 transition-colors"
                          >
                            İptal
                          </button>
                          <button
                            onClick={() => {
                              const amounts = parseDraft(disbandDraft);
                              if (Object.keys(amounts).length === 0) return;
                              setSave(prev => disbandUnits(prev, selectedTarget.id, amounts));
                              setDisbandDraft(EMPTY_UNIT_DRAFT);
                              setShowDisbandMenu(false);
                            }}
                            disabled={Object.keys(disbandAmounts).length === 0}
                            className={`flex-1 py-1 rounded text-xs font-medium border transition-colors ${
                              Object.keys(disbandAmounts).length > 0
                                ? 'bg-amber-900/40 hover:bg-amber-800/60 text-amber-300 border-amber-900/50'
                                : 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
                            }`}
                          >
                            Terhis Et
                          </button>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex flex-col gap-1.5 w-full content-start">
                    {(() => {
                      const units = save.provinceUnits[selectedTarget.id] || {};
                      const unitEntries = Object.entries(units).filter(([, c]) => c > 0);
                      const militia = militiaDefense(save, selectedTarget.id);
                      const locked = save.pendingOrders.filter(o => o.from === selectedTarget.id);
                      return (
                        <div className="bg-slate-950/60 rounded p-1.5 border border-slate-800 text-[10px] flex flex-col gap-0.5">
                          {unitEntries.length > 0 ? (
                            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-slate-300">
                              {unitEntries.map(([type, c]) => (
                                <span key={type}>{UNIT_LABELS[type]}: {formatCount(c)}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-500">Konuşlu birlik yok</span>
                          )}
                          <span className="text-[9px] text-green-400/80">🛡️ Milis direnci: {formatCount(militia)} (nüfustan)</span>
                          {locked.length > 0 && (
                            <span className="text-[9px] text-orange-300">🔒 {locked.length} emirde birlik kilitli — savunmaya %25 katılır</span>
                          )}
                        </div>
                      );
                    })()}
                    {/* Savaştaysak komşu düşman bölgelerine hızlı taarruz kısayolu */}
                    {renderQuickAttackList(selectedTarget.id)}
                    <div className="grid grid-cols-2 gap-1.5 w-full content-start">
                    <button
                      onClick={() => setShowInvestmentMenu(true)}
                      className="py-1.5 bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 rounded text-xs font-medium border border-blue-900/50 transition-colors"
                    >
                      Yatırım Yap
                    </button>
                    <button
                      onClick={() => setShowArmyMenu(true)}
                      className="py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-medium border border-slate-600 transition-colors"
                    >
                      Ordu
                    </button>
                    <button
                      onClick={() => {
                        // Açılış varsayılanları: tür filtreleri işaretli, çağrılabilir
                        // birliği olan TÜM iller seçili (yaygın senaryo: hepsini topla)
                        setGatherFilters({ kara: true, hava: true });
                        setGatherCustom({});
                        setGatherExpanded({});
                        const preset: Record<string, boolean> = {};
                        for (const id of Object.keys(save.provinceUnits)) {
                          if (id === selectedTarget.id || !isPlayerRegion(save, id)) continue;
                          const f = gatherFreeUnits(id, selectedTarget.id);
                          if (f.asker + f.tank + f.ucak > 0) preset[id] = true;
                        }
                        setSelectedSourceProvinces(preset);
                        setShowGatherMenu(true);
                      }}
                      className="py-1.5 bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 rounded text-xs font-medium border border-purple-900/50 transition-colors press-fx"
                    >
                      Ordu Çağır
                    </button>
                    <button
                      onClick={() => setShowDisbandMenu(true)}
                      className="py-1.5 bg-amber-900/30 hover:bg-amber-800/50 text-amber-300 rounded text-xs font-medium border border-amber-900/40 transition-colors"
                    >
                      Terhis
                    </button>
                    {borderRegions.length > 0 && (
                      <button
                        onClick={() => { setBorderDraft({ kara_savunma: '', hava_savunma: '' }); setShowBorderMenu(true); }}
                        className="col-span-2 py-1.5 bg-emerald-900/30 hover:bg-emerald-800/50 text-emerald-300 rounded text-xs font-medium border border-emerald-900/40 transition-colors"
                      >
                        🛡️ {borderLabel} Savunma Kur ({borderRegions.length} il)
                      </button>
                    )}
                    </div>
                  </div>
                )}
              </div>
            ) : countryOfProvince(selectedTarget.id) ? (
              /* ---------------- DÜŞMAN EYALETİ PANELİ (harita savaşı) ---------------- */
              (() => {
                const provId = selectedTarget.id;
                const cid = countryOfProvince(provId)!;
                const cName = save.wars.find(w => w.countryId === cid)?.countryName ?? countryName(cid);
                const isCaptured = save.capturedEnemyProvinces.includes(provId);
                const garrison = save.enemyProvinceStrength[provId] ?? 0;
                const terrain = terrainOf(provId);
                const queued = save.pendingOrders.filter(o => o.to === provId);
                const units = save.provinceUnits[provId] || {};
                const unitEntries = Object.entries(units).filter(([, c]) => c > 0);

                if (isCaptured) {
                  if (showArmyMenu) return <div className="flex gap-2 w-full flex-1 min-h-0">{renderArmyMenu()}</div>;
                  // İlhak edilen toprak da geliştirilebilir: tarım/sanayi yatırımı
                  // provinceInvestments'a yazılır, gelir doğrudan hazineye akar
                  if (showInvestmentMenu) return <div className="flex gap-2 w-full flex-1 min-h-0">{renderInvestmentMenu()}</div>;
                  return (
                    <div className="flex flex-col gap-2 w-full">
                      <div className="flex items-center gap-2 py-1.5 px-2 bg-blue-900/40 border border-blue-800/60 rounded-lg text-xs text-blue-300 font-bold">
                        <Flag className="w-3.5 h-3.5" /> {selectedTarget.name} — ELİMİZDE
                      </div>
                      <div className="bg-slate-950/60 rounded p-2 border border-slate-800">
                        <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">KONUŞLU BİRLİKLER</span>
                        {unitEntries.length > 0 ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-slate-300">
                            {unitEntries.map(([type, c]) => (
                              <span key={type}>{UNIT_LABELS[type]}: {formatCount(c)}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[9px] text-yellow-400">⚠️ Bölgede birlik yok — düşman geri alabilir!</span>
                        )}
                      </div>
                      {/* Buradan saldırılabilecek komşu düşman bölgeleri — dokun, taarruz emri ver */}
                      {renderQuickAttackList(provId) ?? (
                        <p className="text-[9px] text-slate-500">
                          Komşu düşman bölgesi kalmadı. Uçakların varsa uzaktaki düşman bölgelerine
                          hava akını yapabilirsin (haritada hedefe dokun).
                        </p>
                      )}
                      {/* Kendi ilimizden farksız: yatırım + üretim + ordu çağırma
                          (asker hariç — yerel halk devşirilemez) */}
                      <div className="grid grid-cols-2 gap-1.5 w-full">
                        <button
                          onClick={() => { setInvestmentDraft({ tarim: '', sanayi: '', nufus: '' }); setShowInvestmentMenu(true); }}
                          className="col-span-2 py-1.5 bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 rounded text-xs font-medium border border-blue-900/50 transition-colors press-fx"
                        >
                          Yatırım Yap — ilhak toprağını geliştir
                        </button>
                        <button
                          onClick={() => { setArmyDraft(EMPTY_UNIT_DRAFT); setShowArmyMenu(true); }}
                          className="py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-medium border border-slate-600 transition-colors press-fx"
                        >
                          Üretim
                        </button>
                        <button
                          onClick={() => {
                            setGatherFilters({ kara: true, hava: true });
                            setGatherCustom({});
                            setGatherExpanded({});
                            const preset: Record<string, boolean> = {};
                            for (const id of Object.keys(save.provinceUnits)) {
                              if (id === provId || !isPlayerRegion(save, id)) continue;
                              const f = gatherFreeUnits(id, provId);
                              if (f.asker + f.tank + f.ucak > 0) preset[id] = true;
                            }
                            setSelectedSourceProvinces(preset);
                            setShowGatherMenu(true);
                          }}
                          className="py-1.5 bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 rounded text-xs font-medium border border-purple-900/50 transition-colors press-fx"
                        >
                          Ordu Çağır
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col gap-2 w-full flex-1 min-h-0 overflow-y-auto">
                    <div className="flex items-center gap-2 py-1.5 px-2 bg-red-950/60 border border-red-800/60 rounded-lg text-xs text-red-300 font-bold shrink-0">
                      <Swords className="w-3.5 h-3.5" /> {cName.toUpperCase()} BÖLGESİ
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <div className="bg-slate-950/60 rounded p-1.5 border border-slate-800">
                        <span className="text-[9px] text-slate-500 block">GARNİZON</span>
                        <span className="font-mono text-red-300">{formatCount(garrison)}</span>
                      </div>
                      <div className="bg-slate-950/60 rounded p-1.5 border border-slate-800">
                        <span className="text-[9px] text-slate-500 block">ARAZİ</span>
                        <span className="font-mono text-slate-300">
                          {terrain === 'dag' ? '⛰️ Dağlık (x1.4)' : terrain === 'sehir' ? '🏙️ Şehir (x1.25)' : '🌾 Ova (x1.0)'}
                        </span>
                      </div>
                    </div>
                    {/* Fetih ilerlemesi bir bakışta: ülkenin kaç bölgesi var, kaçı ayakta */}
                    {(() => {
                      const regs = countryRegions(cid);
                      const kalan = regs.filter(r => !(save.capturedEnemyProvinces ?? []).includes(r)).length;
                      return (
                        <div className="flex justify-between items-center bg-slate-950/60 rounded p-1.5 border border-slate-800 text-[10px]">
                          <span className="text-slate-500">🗺️ {cName} bölgeleri</span>
                          <span className="font-mono text-slate-200">
                            {kalan === regs.length
                              ? `${regs.length} bölge`
                              : <>ayakta <span className="text-red-300 font-bold">{kalan}</span> / {regs.length} · sende <span className="text-blue-300 font-bold">{regs.length - kalan}</span></>}
                          </span>
                        </div>
                      );
                    })()}
                    {queued.length > 0 && (
                      <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-2 text-[10px] text-red-200">
                        ⚔️ {queued.length} taarruz emri kuyrukta — tur sonunda saldırılacak
                      </div>
                    )}
                    {canOrderAttack(save, provId) ? (
                      <button
                        onClick={() => setAttackTarget({ id: provId, name: selectedTarget.name })}
                        className="w-full py-3 bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-extrabold rounded-lg text-xs tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-md shadow-red-950/30"
                      >
                        <Swords className="w-4 h-4" /> TAARRUZ EMRİ VER
                      </button>
                    ) : (save.truces[cid] || 0) > save.turn ? (
                      <>
                        <p className="text-[9px] text-blue-300 text-center py-1">
                          🕊️ {cName} ile ateşkes — {save.truces[cid] - save.turn} tur sonra bitiyor.
                        </p>
                        {/* Ateşkes = diplomasi penceresi: ilişkiyi ŞİMDİ onar, savaş geri gelmesin */}
                        <DiplomacyPanel key={cid} save={save} setSave={setSave} countryId={cid} armyPower={armyPower} />
                      </>
                    ) : (
                      <>
                        {/* Barıştaki komşunun ordusu boş durmuyor: büyüme burada görünür —
                            "beklemek bedava değil" bilgisi savaş ilanı kararına iliştirilir */}
                        {(() => {
                          const liveStrength = getAiMilitary(save, cid);
                          const baseStr = getCountryStats(cid, save.difficulty).military;
                          const growthPerTurn = aiMilitaryGrowthPerTurn(save, cid);
                          const grownPct = Math.round((liveStrength / Math.max(1, baseStr) - 1) * 100);
                          return (
                            <div className="bg-slate-950/60 rounded p-2 border border-slate-800 text-[10px]">
                              <div className="flex justify-between font-mono">
                                <span className="text-slate-400">{cName} ordusu:</span>
                                <span className="text-red-300">⚔️ {formatCount(liveStrength)}{growthPerTurn > 0 && <span className="text-red-400"> ▲</span>}</span>
                              </div>
                              {growthPerTurn > 0 && (
                                <div className="flex justify-between items-center mt-1 pt-1 border-t border-slate-800/60">
                                  <span className="text-slate-500">📈 Barışta büyüyor:</span>
                                  <span className="text-red-300 font-mono">
                                    +{formatCount(growthPerTurn)}/tur{grownPct >= 5 ? ` · toplamda +%${grownPct}` : ''}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {/* Öngörü: bu ülkenin savaş açma riski (motorla aynı formül) */}
                        <AttackRiskLine save={save} countryId={cid} />
                        {/* Diplomasi: ilişki, hediye, pakt, ittifak, ticaret, ültimatom */}
                        <DiplomacyPanel key={cid} save={save} setSave={setSave} countryId={cid} armyPower={armyPower} />
                        <p className="text-[9px] text-slate-500 text-center">
                          Bu bölgeye saldırmak için {cName} ile savaşta olmalısın.
                        </p>
                        {pactActive(save, cid) ? (
                          <p className="text-[9px] text-blue-300 text-center py-1">
                            🕊️ Saldırmazlık paktı — {(save.pacts?.[cid] || 0) - save.turn} tur boyunca iki taraf da saldıramaz.
                          </p>
                        ) : (() => {
                          // Ülke panelindeki kapının AYNISI: kara sınırı yoksa liman+gemi
                          // +deniz rotası şart — bölge panelinden donanmasız denizaşırı
                          // ilanla "donuk savaşa" (emir verilemeyen, 60 tur bedel
                          // biriktiren savaş) girilebiliyordu.
                          const needsFleet = borderRegionsWith(save, [cid]).length === 0
                            && !canLaunchSeaInvasion(save, cid);
                          return needsFleet ? (
                            <p className="text-[9px] text-slate-500 text-center py-1">
                              🚢 Kara sınırımız yok — savaş için kıyı ilinde LİMAN kur, GEMİ üret.
                            </p>
                          ) : (
                          <button
                            onClick={() => confirmTap(`war-${cid}`, () => setSave(prev => startWar(prev, cid, cName)))}
                            className={`w-full py-3 text-white font-extrabold rounded-lg text-xs tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                              confirmKey === `war-${cid}`
                                ? 'bg-red-600 animate-pulse ring-2 ring-red-400'
                                : 'bg-red-800 hover:bg-red-700 active:bg-red-900'
                            }`}
                          >
                            <Swords className="w-4 h-4" />
                            {confirmKey === `war-${cid}`
                              ? 'EMİN MİSİN? — İLİŞKİLER DİBE VURUR'
                              : `${cName.toUpperCase()}'A SAVAŞ İLAN ET`}
                          </button>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })()
            ) : (
              /* ---------------- ÜLKE PANELİ ---------------- */
              <div className="flex flex-col gap-2 w-full flex-1 min-h-0 overflow-y-auto">
                {(() => {
                  const liveStrength = getAiMilitary(save, selectedTarget.id);
                  // Fethedilmişse TOPLAM katkı (devralınan + eyalet yatırımları),
                  // değilse ülkenin CANLI (büyüyen) ekonomisi
                  const liveIncome = selectedConquered
                    ? conqueredCountryTotalIncome(save, selectedTarget.id)
                    : getAiEconomy(save, selectedTarget.id).income;
                  // Barışta ordusu her tur büyür — beklemenin bedeli burada görünür
                  const growthPerTurn = selectedConquered ? 0 : aiMilitaryGrowthPerTurn(save, selectedTarget.id);
                  return (
                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <div className="bg-slate-950/60 rounded p-1.5 border border-slate-800">
                        <span className="text-[9px] text-slate-500 block">ASKERİ GÜÇ</span>
                        <span className="font-mono text-red-300">{selectedConquered ? '—' : formatCount(liveStrength)}</span>
                        {growthPerTurn > 0 && (
                          <span className="text-[9px] text-red-400/90 font-mono block">▲ +{formatCount(growthPerTurn)}/tur</span>
                        )}
                      </div>
                      <div className="bg-slate-950/60 rounded p-1.5 border border-slate-800">
                        <span className="text-[9px] text-slate-500 block">{selectedConquered ? 'GELİR KATKISI' : 'GELİR (FETİHTE)'}</span>
                        <span className="font-mono text-green-300">{formatMoney(liveIncome)}/tur</span>
                      </div>
                      {/* Ülkenin bölge sayısı: fetih hedefinin boyutu / savaşta kalan */}
                      {(() => {
                        const regs = countryRegions(selectedTarget.id);
                        if (regs.length === 0) return null;
                        const kalan = regs.filter(r => !(save.capturedEnemyProvinces ?? []).includes(r)).length;
                        return (
                          <div className="col-span-2 bg-slate-950/60 rounded p-1.5 border border-slate-800 flex justify-between items-center">
                            <span className="text-[9px] text-slate-500">🗺️ BÖLGELER</span>
                            <span className="font-mono text-slate-200 text-[11px]">
                              {selectedConquered
                                ? `${regs.length} bölge — tamamı sende`
                                : kalan === regs.length
                                  ? `${regs.length} bölge`
                                  : <>ayakta <span className="text-red-300 font-bold">{kalan}</span> / {regs.length} · sende <span className="text-blue-300 font-bold">{regs.length - kalan}</span></>}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {selectedConquered ? (
                  showArmyMenu ? renderArmyMenu() : (
                  <>
                    <div className="flex flex-col gap-1 py-1.5 px-2 bg-blue-900/30 border border-blue-800/50 rounded text-xs text-blue-300 font-medium">
                      <span className="flex items-center gap-2">
                        <Flag className="w-3.5 h-3.5" /> Fethedildi — topraklarımızın parçası
                      </span>
                      <span className="text-[9px] text-blue-400/80 font-normal">
                        Tarım ve sanayisi devralındı: +{formatMoney(conqueredCountryTotalIncome(save, selectedTarget.id))}/tur hazineye akıyor
                        {conqueredRegionalIncome(save, selectedTarget.id) > 0 &&
                          ` (+${formatMoney(conqueredRegionalIncome(save, selectedTarget.id))} eyalet yatırımlarından)`}.
                      </span>
                    </div>
                    {/* Bölgede konuşlu birlikler + ordu üretimi */}
                    {(() => {
                      const units = save.provinceUnits[selectedTarget.id] || {};
                      const unitEntries = Object.entries(units).filter(([, c]) => c > 0);
                      const localPop = Math.floor(save.conqueredEconomies?.[selectedTarget.id]?.population || 0);
                      return (
                        <div className="flex flex-col gap-1.5 bg-slate-950/60 p-2 rounded border border-slate-800">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">KONUŞLU BİRLİKLER</span>
                          {unitEntries.length > 0 ? (
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-slate-300">
                              {unitEntries.map(([type, c]) => (
                                <span key={type}>{UNIT_LABELS[type]}: {formatCount(c)}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[9px] text-slate-500">Bu topraklarda birlik yok.</span>
                          )}
                          <span className="text-[9px] text-slate-500">
                            Yerel nüfus: {formatCount(localPop)} — asker bu nüfustan toplanır
                          </span>
                          <button
                            onClick={() => { setArmyDraft(EMPTY_UNIT_DRAFT); setShowArmyMenu(true); }}
                            className="w-full py-1 rounded text-[10px] font-medium border border-red-900/50 bg-red-900/30 hover:bg-red-800/50 text-red-300 transition-colors"
                          >
                            ⚔️ Ordu Üret
                          </button>
                        </div>
                      );
                    })()}
                    {/* Kalkınma yatırımı: devralınan ekonomi artık büyütülebilir */}
                    {(() => {
                      const eco = save.conqueredEconomies?.[selectedTarget.id];
                      const currentInvestment = eco?.investment || 0;
                      const draftAmount = parseInt(devInvestDraft.tutar?.toString() || '0') || 0;
                      const previewGain = Math.round(draftAmount * CONQUERED_DEV_RATE);
                      const affordable = draftAmount > 0 && draftAmount <= save.money;
                      return (
                        <div className="flex flex-col gap-1.5 bg-slate-950/60 p-2 rounded border border-slate-800">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">KALKINMA YATIRIMI</span>
                          <span className="text-[9px] text-slate-500">
                            %{(CONQUERED_DEV_RATE * 100).toFixed(1)}/tur getiri · birikim: {formatMoney(currentInvestment)}
                            {currentInvestment > 0 && ` (+${formatMoney(Math.round(currentInvestment * CONQUERED_DEV_RATE))}/tur)`}
                          </span>
                          <div className="flex items-center justify-between gap-2">
                            <Stepper
                              value={devInvestDraft.tutar || 0}
                              step={50_000_000}
                              format={formatMoney}
                              onStep={stepDraft(setDevInvestDraft, 'tutar')}
                            />
                            {draftAmount > 0 && (
                              <span className="text-[9px] text-green-400 font-mono">+{formatMoney(previewGain)}/tur</span>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setSave(prev => investInConquered(prev, selectedTarget.id, draftAmount) ?? prev);
                              setDevInvestDraft({ tutar: '' });
                            }}
                            disabled={!affordable}
                            className={`w-full py-1 rounded text-[10px] font-medium border transition-colors ${
                              affordable
                                ? 'bg-green-900/40 hover:bg-green-800/60 text-green-300 border-green-900/50'
                                : 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
                            }`}
                          >
                            {draftAmount > 0 && !affordable ? 'Hazine Yetersiz' : 'Yatırım Yap'}
                          </button>
                        </div>
                      );
                    })()}
                  </>
                  )
                ) : selectedWar ? (
                  <>
                    <div className={`flex flex-col gap-1 py-1.5 px-2 rounded border ${selectedWar.initiator === 'ai' ? 'bg-orange-900/30 border-orange-800/50' : 'bg-red-900/30 border-red-800/50'}`}>
                      <span className={`text-xs font-medium flex items-center gap-1.5 ${selectedWar.initiator === 'ai' ? 'text-orange-300' : 'text-red-300'}`}>
                        <Swords className="w-3.5 h-3.5" /> {selectedWar.initiator === 'ai' ? 'Bize savaş açtı — savunuyoruz' : 'Savaş sürüyor'}
                      </span>
                      <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
                        <div className={`h-full transition-all ${selectedWar.initiator === 'ai' ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${Math.round((1 - selectedWar.enemyStrength / selectedWar.enemyMaxStrength) * 100)}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-slate-400">
                        {selectedWar.initiator === 'ai' ? 'Saldıran güç' : 'Kalan düşman gücü'}: {formatCount(selectedWar.enemyStrength)}
                      </span>
                    </div>
                    {/* Eyalet ilerlemesi + ilhak teklifi + geri çekilme */}
                    {(() => {
                        const progress = warProvinceProgress(save, selectedWar.countryId);
                        const decision = evaluateAnnexOffer(save, selectedWar.countryId, armyPower);
                        const cooldownLeft = Math.max(0, (save.annexOffers?.[selectedWar.countryId] ?? 0) - save.turn);
                        const retreatKey = `retreat-${selectedWar.countryId}`;
                        return (
                          <>
                            <div className="bg-slate-950/60 rounded p-2 border border-slate-800 text-[10px] flex flex-col gap-1">
                              <div className="flex justify-between">
                                <span className="text-slate-400">Ele geçirilen bölge:</span>
                                <span className="font-mono text-blue-300 font-bold">{progress.captured}/{progress.total}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400">Anavatan rezervi:</span>
                                <span className="font-mono text-red-300">{formatCount(getAiMilitary(save, selectedWar.countryId))}</span>
                              </div>
                              {decision && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">Düşman savaş yorgunluğu:</span>
                                  <span className={`font-mono ${decision.weariness > 70 ? 'text-green-400' : 'text-slate-300'}`}>%{decision.weariness}</span>
                                </div>
                              )}
                              <span className="text-[9px] text-slate-500 leading-relaxed">
                                Haritada {selectedWar.countryName} bölgelerine dokunup TAARRUZ EMRİ ver.
                                Tüm bölgeler düşünce ülke fethedilir. Rezerv her tur cepheye takviye sızdırır — hızlı davran!
                              </span>
                            </div>

                            {/* Savaşı Bitir (İlhak): AI karar matrisi önizlemesi + teklif */}
                            {decision && progress.captured > 0 ? (
                              <div className="bg-slate-950/60 rounded p-2 border border-slate-800 text-[10px] flex flex-col gap-1">
                                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                                  🏳️ SAVAŞI BİTİR — {progress.captured} BÖLGEYİ İLHAK ET
                                </span>
                                {decision.factors.length === 0 && (
                                  <span className="text-slate-500">Belirleyici etken yok — AI kayıtsız (0 puan).</span>
                                )}
                                {decision.factors.map((f, i) => (
                                  <div key={i} className="flex justify-between gap-2">
                                    <span className="text-slate-400">{f.label}</span>
                                    <span className={`font-mono shrink-0 ${f.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {f.delta > 0 ? '+' : ''}{f.delta}
                                    </span>
                                  </div>
                                ))}
                                <div className="flex justify-between border-t border-slate-800 pt-1">
                                  <span className="text-slate-300 font-bold">Karar puanı (eşik {ANNEX_ACCEPT_THRESHOLD}):</span>
                                  <span className={`font-mono font-bold ${decision.accepted ? 'text-green-400' : 'text-red-400'}`}>
                                    {decision.score} → {decision.accepted ? 'KABUL EDER' : 'REDDEDER'}
                                  </span>
                                </div>
                                <button
                                  onClick={() => setSave(prev =>
                                    applyAnnexOffer(prev, selectedWar.countryId, armyPower)?.save ?? prev)}
                                  disabled={cooldownLeft > 0}
                                  className={`w-full py-1.5 mt-0.5 rounded text-xs font-bold border transition-colors press-fx ${
                                    cooldownLeft > 0
                                      ? 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
                                      : decision.accepted
                                        ? 'bg-green-900/40 hover:bg-green-800/60 text-green-300 border-green-900/50'
                                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'
                                  }`}
                                >
                                  {cooldownLeft > 0
                                    ? `Teklif reddedildi — ${cooldownLeft} tur sonra yeniden`
                                    : 'İlhak Teklifi Gönder'}
                                </button>
                              </div>
                            ) : (
                              <span className="text-[9px] text-slate-500 px-0.5">
                                💡 Bölge ele geçirince İLHAK TEKLİFİ açılır: kabul edilirse savaş biter, bölgeler sende kalır.
                              </span>
                            )}

                            {/* Geri Çekilme: bedelsiz ama topraksız çıkış (iki dokunuşlu onay) */}
                            <button
                              onClick={() => confirmTap(retreatKey, () =>
                                setSave(prev => retreatFromWar(prev, selectedWar.countryId)))}
                              title={`Ele geçirilen bölgeler iade edilir, birlikler yurda döner; −${RETREAT_HAPPINESS_COST} mutluluk. Savaş ${RETREAT_TRUCE_MIN_WAR_TURNS}+ tur sürdüyse ${RETREAT_TRUCE_DURATION} turluk kısa ateşkes (erken kaçış ateşkes vermez). Barış bedeli ödenmez.`}
                              className={`w-full py-1.5 rounded text-xs font-medium border transition-colors press-fx ${
                                confirmKey === retreatKey
                                  ? 'bg-amber-900/50 hover:bg-amber-800/60 text-amber-200 border-amber-700/60'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'
                              }`}
                            >
                              {confirmKey === retreatKey
                                ? `⚠️ Emin misin? Bölgeler iade, −${RETREAT_HAPPINESS_COST} mutluluk`
                                : '🏃 Geri Çekil — bedelsiz çıkış, bölgeler iade'}
                            </button>
                          </>
                        );
                      })()}
                    {(() => {
                      const peace = peaceInfo(selectedWar);
                      return (
                        <button
                          onClick={() => handleSignPeace(selectedWar.countryId)}
                          disabled={!peace.affordable}
                          className={`w-full py-1.5 rounded text-xs font-medium border transition-colors ${
                            peace.affordable
                              ? peace.cost > 0
                                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'
                                : 'bg-green-900/40 hover:bg-green-800/60 text-green-300 border-green-900/50'
                              : 'bg-slate-800/50 text-slate-600 border-slate-700/50 cursor-not-allowed'
                          }`}
                        >
                          {peace.affordable ? peace.label : `${peace.label} (hazine yetersiz)`}
                        </button>
                      );
                    })()}
                  </>
                ) : (save.truces[selectedTarget.id] || 0) > save.turn ? (
                  <>
                    <div className="flex items-center gap-2 py-1.5 px-2 bg-blue-900/30 border border-blue-800/50 rounded text-xs text-blue-300 font-medium">
                      🕊️ Ateşkes — {save.truces[selectedTarget.id] - save.turn} tur sonra bitiyor
                    </div>
                    {/* Ateşkes = diplomasi penceresi: ilişkiyi ŞİMDİ onar, savaş geri gelmesin */}
                    <DiplomacyPanel key={selectedTarget.id} save={save} setSave={setSave} countryId={selectedTarget.id} armyPower={armyPower} />
                  </>
                ) : (
                  <>
                    {/* AI-AI savaşı: zayıflayan komşu = fırsat penceresi */}
                    {(() => {
                      const opponentId = getAiWarOpponent(save, selectedTarget.id);
                      if (!opponentId) return null;
                      const opponentName = countryName(opponentId);
                      return (
                        <div className="flex items-center gap-2 py-1.5 px-2 bg-amber-900/30 border border-amber-800/50 rounded text-[10px] text-amber-300 font-medium">
                          ⚡ {opponentName} ile savaşta — ordusu her tur yıpranıyor. Saldırı fırsatı!
                        </div>
                      );
                    })()}
                    {/* Güç karşılaştırması */}
                    {(() => {
                      const enemyStr = getAiMilitary(save, selectedTarget.id);
                      const ratio = armyPower > 0 ? armyPower / enemyStr : 0;
                      const ratioColor = ratio >= 1.5 ? 'text-green-400' : ratio >= 0.75 ? 'text-yellow-400' : 'text-red-400';
                      const ratioLabel = ratio >= 1.5 ? 'Üstün' : ratio >= 0.75 ? 'Dengeli' : 'Riskli';
                      // Barış büyümesi: taban güce göre birikim + bu turki beklenen artış.
                      // Bekleyen oyuncu düşmanın her tur güçlendiğini burada görür.
                      const baseStr = getCountryStats(selectedTarget.id, save.difficulty).military;
                      const growthPerTurn = aiMilitaryGrowthPerTurn(save, selectedTarget.id);
                      const grownPct = Math.round((enemyStr / Math.max(1, baseStr) - 1) * 100);
                      return (
                        <div className="bg-slate-950/60 rounded p-2 border border-slate-800 text-[10px]">
                          <div className="flex justify-between mb-1">
                            <span className="text-slate-400">Güç Karşılaştırması:</span>
                            <span className={`font-bold ${ratioColor}`}>{ratioLabel}</span>
                          </div>
                          <div className="flex justify-between font-mono">
                            <span className="text-blue-300">🇹🇷 {formatCount(armyPower)}</span>
                            <span className="text-slate-500">vs</span>
                            <span className="text-red-300">⚔️ {formatCount(enemyStr)}{growthPerTurn > 0 && <span className="text-red-400"> ▲</span>}</span>
                          </div>
                          {growthPerTurn > 0 && (
                            <div className="flex justify-between items-center mt-1 pt-1 border-t border-slate-800/60">
                              <span className="text-slate-500">📈 Ordusu büyüyor:</span>
                              <span className="text-red-300 font-mono">
                                +{formatCount(growthPerTurn)}/tur{grownPct >= 5 ? ` · toplamda +%${grownPct}` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* Öngörü: bu komşunun savaş açma riski (motorla aynı formül) */}
                    <AttackRiskLine save={save} countryId={selectedTarget.id} />
                    {/* Diplomasi: ilişki, anlaşmalar, hediye/pakt/ittifak/ültimatom */}
                    <DiplomacyPanel key={selectedTarget.id} save={save} setSave={setSave} countryId={selectedTarget.id} armyPower={armyPower} />
                    {(() => {
                      // Kara sınırımız yoksa DENİZ AŞIRI sefer: kıyı ilinde liman+gemi
                      // ve hedefin kıyısına deniz rotası gerekir (amfibi çıkarma).
                      const overseas = borderRegionsWith(save, [selectedTarget.id]).length === 0;
                      const seaReady = !overseas || canLaunchSeaInvasion(save, selectedTarget.id);
                      const needsFleet = overseas && !seaReady;
                      // Saldırmazlık paktı İKİ tarafı da bağlar — savaş ilanı kilitli
                      const pactBlocked = pactActive(save, selectedTarget.id);
                      return (
                        <>
                          <button
                            onClick={handleDeclareWar}
                            disabled={needsFleet || pactBlocked}
                            className={`w-full py-1.5 rounded text-xs font-medium border transition-colors ${
                              needsFleet || pactBlocked
                                ? 'bg-slate-800/50 text-slate-500 border-slate-700/50 cursor-not-allowed'
                                : 'border-red-900/50 bg-red-900/40 hover:bg-red-800/60 text-red-300'
                            }`}
                          >
                            {pactBlocked
                              ? `🕊️ Pakt sürüyor (${(save.pacts?.[selectedTarget.id] || 0) - save.turn} tur)`
                              : needsFleet ? '🚢 Liman + Gemi Gerekli' : 'Savaş İlan Et'}
                          </button>
                          <span className="text-[9px] text-slate-500 text-center">
                            {needsFleet
                              ? 'Kara sınırımız yok — kıyı ilinde LİMAN kur, GEMİ üret; filo hedefin kıyısına deniz rotasıyla ulaşabilmeli.'
                              : overseas
                                ? `🚢 Deniz aşırı sefer: çıkarma gemiyle yapılır (gemi başına ${formatCount(SHIP_CAPACITY)} ağırlık · asker 1 · tank 25 · uçaklar uçar)`
                                : armyPower <= 0
                                  ? '⚠️ Uyarı: Saldırı gücünüz 0 (Asker, Tank veya Uçak üretmediniz). Savaş açarsanız saldırı yapamazsınız!'
                                  : `Önerilen saldırı gücü: ~${formatCount(Math.round(getAiMilitary(save, selectedTarget.id) * 0.75))}`}
                          </span>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Nasıl Oynanır rehberi: ilk girişte otomatik, sonra menüden. Kapanınca
          guideSeen kaydedilir — bir daha kendiliğinden açılmaz. */}
      {showGuide && (
        <HowToPlay onClose={() => {
          setShowGuide(false);
          setSave(prev => prev.guideSeen ? prev : { ...prev, guideSeen: true });
        }} />
      )}

      {/* Duraklatma menüsü */}
      {showPauseMenu && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center">
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-6 w-80 shadow-2xl">
            <button
              onClick={() => setShowPauseMenu(false)}
              className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              title="Kapat"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 className="text-center text-2xl font-black tracking-[0.25em] text-white mb-1">HEGEMON</h2>
            <p className="text-center text-[10px] text-slate-500 mb-6">TUR {save.turn} · {save.conqueredCountryIds.length} fetih · {DIFFICULTY_LABELS[save.difficulty]}</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowPauseMenu(false)}
                className="flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors"
              >
                <Play className="w-4 h-4" /> Devam Et
              </button>
              <button
                onClick={handleManualSave}
                className={`flex items-center justify-center gap-2 py-3 font-bold rounded-lg border transition-colors ${
                  justSaved
                    ? 'bg-green-900/40 text-green-300 border-green-800'
                    : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 border-slate-700'
                }`}
              >
                {justSaved ? <><Check className="w-4 h-4" /> Kaydedildi</> : <><Save className="w-4 h-4" /> Kaydet</>}
              </button>
              <button
                onClick={() => { setShowPauseMenu(false); setShowGuide(true); }}
                className="flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 font-bold rounded-lg border border-slate-700 transition-colors"
              >
                <BookOpen className="w-4 h-4" /> Nasıl Oynanır
              </button>
              <button
                onClick={() => { persistSave(save); setShowPauseMenu(false); onExitToMenu(); }}
                className="flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 font-bold rounded-lg border border-slate-700 transition-colors"
              >
                <DoorOpen className="w-4 h-4" /> Kaydet ve Çık
              </button>
              <button
                onClick={() => { setShowPauseMenu(false); setShowExitConfirm(true); }}
                className="flex items-center justify-center gap-2 py-3 bg-red-900/30 hover:bg-red-900/50 active:bg-red-900/70 text-red-300 font-bold rounded-lg border border-red-900/50 transition-colors"
              >
                <LogOut className="w-4 h-4" /> Oyundan Çık
              </button>
            </div>

            <p className="text-center text-[9px] text-slate-600 mt-4">
              Oyun her tur otomatik kaydedilir.
            </p>
          </div>
        </div>
      )}

      {/* Çıkış onay menüsü */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center">
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-6 w-80 shadow-2xl">
            <button
              onClick={() => setShowExitConfirm(false)}
              className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              title="Kapat"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-center text-lg font-bold text-white mb-2">Oyundan Çık</h3>
            <p className="text-center text-xs text-slate-400 mb-5">Nereye gitmek istersin?</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  persistSave(save);
                  setShowExitConfirm(false);
                  onExitToMenu();
                }}
                className="flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors"
              >
                <DoorOpen className="w-4 h-4" /> Giriş Ekranına Dön
              </button>
              <button
                onClick={() => {
                  persistSave(save);
                  exitApplication();
                  // Tarayıcı kapatmayı engelleyebilir — bu durumda giriş ekranına dön
                  setShowExitConfirm(false);
                  onExitToMenu();
                }}
                className="flex items-center justify-center gap-2 py-3 bg-red-900/30 hover:bg-red-900/50 active:bg-red-900/70 text-red-300 font-bold rounded-lg border border-red-900/50 transition-colors"
              >
                <Power className="w-4 h-4" /> Oyunu Kapat
              </button>
              <button
                onClick={() => setShowExitConfirm(false)}
                className="flex items-center justify-center gap-2 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Savaş İlanı Onay Modalı */}
      {showWarConfirm && selectedTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <button
              onClick={() => setShowWarConfirm(false)}
              className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              title="Kapat"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-center text-lg font-black tracking-wide text-white mb-4 flex items-center justify-center gap-2">
              <Swords className="w-5 h-5 text-red-500" />
              SAVAŞ İLAN ET — {selectedTarget.name}
            </h3>

            <div className="flex flex-col gap-4">
              {borderRegionsWith(save, [selectedTarget.id]).length > 0 ? (
                <div className="flex flex-col text-left p-4 bg-slate-950 border border-red-900/40 rounded-xl">
                  <div className="flex items-center gap-2 text-red-400 font-bold text-sm mb-1">
                    <MapPin className="w-4 h-4" /> Cephe Savaşı (Harita)
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Düşman ordusu bölge garnizonlarına dağılır ve haritada görünür. Sınır illerinden
                    bölgelere <b>taarruz emri</b> verirsin; emirler tur sonunda işlenir. Güç oranı
                    R ≥ 1.5 olan taarruz bölgeyi tek turda düşürür. Tüm bölgeler ele geçirilince ülke fethedilir.
                  </p>
                  <p className="text-[10px] text-orange-300/90 mt-2">
                    ⚠️ Dikkat: Düşman da senin sınır illerine taarruz eder — sınırı savunmasız bırakma.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col text-left p-4 bg-slate-950 border border-slate-700/50 rounded-xl">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm mb-1">
                    <Anchor className="w-4 h-4" /> Deniz Aşırı Sefer (Amfibi Harekât)
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Kara sınırımız yok — düşman kıyı bölgelerine <b>çıkarma emri</b> verirsin:
                    limanlı kıyı ilindeki gemiler kara birliklerini taşır, uçaklar üsten uçar.
                    Emirler tur sonunda işlenir; tüm bölgeler ele geçirilince ülke fethedilir.
                  </p>
                </div>
              )}

              <button
                onClick={confirmDeclareWar}
                className="py-3 bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-bold rounded-lg transition-colors"
              >
                ⚔️ Savaş İlan Et
              </button>
              <button
                onClick={() => setShowWarConfirm(false)}
                className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition-colors border border-slate-700/50"
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Taarruz Emri Modalı — emir kuyruğa yazılır, tur sonunda işlenir */}
      {attackTarget && (
        <AttackOrderModal
          save={save}
          targetId={attackTarget.id}
          targetName={attackTarget.name}
          onQueue={handleQueueAttack}
          onClose={() => setAttackTarget(null)}
        />
      )}

      {/* ZAFER: tüm kara komşuları fethedildi (ada ülkesinde: deniz aşırı fetihler).
          Koşul motorda tek kaynak — mapWar.victoryAchieved. */}
      {!victoryDismissed && victoryAchieved(save) && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gradient-to-b from-amber-950/80 to-slate-900 border border-amber-600/60 rounded-2xl p-8 w-full max-w-md shadow-2xl text-center">
            <div className="text-5xl mb-3">🏆</div>
            <h2 className="text-2xl font-black tracking-widest text-amber-300 mb-2">
              {countryLandNeighborList(save.playerCountryId).length > 0 ? 'BÖLGESEL HEGEMON' : 'DENİZLERİN HÂKİMİ'}
            </h2>
            <p className="text-sm text-slate-300 mb-1">
              {countryLandNeighborList(save.playerCountryId).length > 0
                ? `Tüm kara komşuları fethedildi — Tur ${save.turn}.`
                : `Ada devletin denizleri aştı: ${save.conqueredCountryIds.length} ülke fethedildi — Tur ${save.turn}.`}
            </p>
            <p className="text-xs text-slate-400 mb-6">
              Artık kimse sınırlarına saldıramaz. İstersen limanlar kurup deniz aşırı imparatorluğa uzan.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setVictoryDismissed(true)}
                className="py-3 bg-amber-700 hover:bg-amber-600 text-white font-bold rounded-lg transition-colors"
              >
                🌊 Dünya Hegemonyasına Devam Et
              </button>
              <button
                onClick={onExitToMenu}
                className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg border border-slate-700 transition-colors"
              >
                Ana Menü
              </button>
            </div>
          </div>
        </div>
      )}

      {/* YENİLGİ: ülkenin üçte birden fazlası işgal altında */}
      {/* Eşik oransal: kendi ülkesinin bölge sayısının 1/3'ünden fazlası. (Sabit 28,
          81 illi Türkiye'ye göreydi — 7 bölgeli basit düzende yenilgi hiç tetiklenmiyordu.) */}
      {!defeatDismissed && Object.keys(save.occupiedProvinces).length > countryRegions(save.playerCountryId).length / 3 && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gradient-to-b from-red-950/80 to-slate-900 border border-red-700/60 rounded-2xl p-8 w-full max-w-md shadow-2xl text-center">
            <div className="text-5xl mb-3">💀</div>
            <h2 className="text-2xl font-black tracking-widest text-red-300 mb-2">ÜLKE DÜŞÜYOR</h2>
            <p className="text-sm text-slate-300 mb-1">{Object.keys(save.occupiedProvinces).length} il işgal altında — devlet çöküşün eşiğinde.</p>
            <p className="text-xs text-slate-400 mb-6">
              Ordu dağılmış, hazine tükenmiş olabilir; ama tarih direnenleri yazar.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setDefeatDismissed(true)}
                className="py-3 bg-red-800 hover:bg-red-700 text-white font-bold rounded-lg transition-colors"
              >
                🔥 Küllerden Doğ — Direnmeye Devam
              </button>
              <button
                onClick={onExitToMenu}
                className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg border border-slate-700 transition-colors"
              >
                Ana Menü
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
