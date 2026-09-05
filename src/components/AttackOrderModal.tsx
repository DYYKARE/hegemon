import React, { useState, useMemo } from 'react';
import { X, Swords, Target } from 'lucide-react';
import { GameSave } from '../engine/types';
import { Army } from '../engine/frontline/types';
import {
  attackSources, airBases, previewAttack, terrainOf, provinceDisplayName,
  seaAttackSources, shipCapacityOf, seaLiftWeight, SEA_WEIGHT,
} from '../engine/mapWar';
import { TERRAIN_DEFENSE_BONUS } from '../engine/frontline/resolveTurn';
import { formatCount } from '../engine/economy';

// Taarruz emri modalı: hedefe komşu illerden birlik seçilir, emir KUYRUĞA yazılır
// ve tur sonunda işlenir. Canlı önizleme motorla aynı formülü kullanır (R eşikleri).

interface AttackOrderModalProps {
  save: GameSave;
  targetId: string;
  targetName: string;
  onQueue: (commits: Record<string, Army>) => void;
  onClose: () => void;
}

const TERRAIN_LABELS: Record<string, string> = {
  ova: 'Ova', dag: 'Dağlık', sehir: 'Şehir', orman: 'Orman', kiyi: 'Kıyı',
};

const OUTCOME_CONFIG = {
  decisive: {
    label: 'KESİN ZAFER', color: 'text-green-400', border: 'border-green-700/60', bg: 'bg-green-950/40',
    hint: 'R ≥ 1.5 — bölge TEK TURDA düşer, ordun bölgeye yerleşir.',
  },
  attrition: {
    label: 'YIPRATMA SAVAŞI', color: 'text-yellow-400', border: 'border-yellow-700/60', bg: 'bg-yellow-950/30',
    hint: '0.8 < R < 1.5 — bölge düşmez, iki taraf da zayiat verir. Dikkat: savunan her tur anavatandan takviye alır, beklersen R DÜŞER — ya tek seferde ezici güç yığ ya hiç girme.',
  },
  repelled: {
    label: 'TAARRUZ KIRILIR', color: 'text-red-400', border: 'border-red-700/60', bg: 'bg-red-950/40',
    hint: 'R ≤ 0.8 — saldırı püskürtülür, ağır zayiat verirsin. Bu güçle saldırma!',
  },
} as const;

const EMPTY: Army = { asker: 0, tank: 0, ucak: 0 };

export function AttackOrderModal({ save, targetId, targetName, onQueue, onClose }: AttackOrderModalProps) {
  const [commits, setCommits] = useState<Record<string, Army>>({});

  const sources = useMemo(() => attackSources(save, targetId), [save, targetId]);
  // Çıkarma kaynakları: limanlı+gemili kıyı illeri (hedef kıyı + aynı su havzası)
  const seaSources = useMemo(() => seaAttackSources(save, targetId), [save, targetId]);
  // Uzak hava üsleri: komşu/deniz kaynağı olmayan ama uçağı olan bölgeler
  const airOnlyBases = useMemo(
    () => {
      const sea = new Set(seaSources);
      return airBases(save, targetId).filter(id => !sea.has(id) && (save.provinceUnits[id]?.ucak ?? 0) > 0);
    },
    [save, targetId, seaSources]
  );

  // Kaynakta kullanılabilir birlik: ildeki mobil birlikler − BAŞKA hedeflere
  // bağlanmış emirler (aynı hedefe eski emir zaten üstüne yazılır)
  const availableAt = (provId: string): Army => {
    const units = save.provinceUnits[provId] || {};
    const other = (save.pendingOrders ?? []).filter(o => o.from === provId && o.to !== targetId);
    const locked = other.reduce((a, o) => ({
      asker: a.asker + o.units.asker, tank: a.tank + o.units.tank, ucak: a.ucak + o.units.ucak,
    }), { ...EMPTY });
    return {
      asker: Math.max(0, (units.asker || 0) - locked.asker),
      tank: Math.max(0, (units.tank || 0) - locked.tank),
      ucak: Math.max(0, (units.ucak || 0) - locked.ucak),
    };
  };

  const preview = useMemo(() => previewAttack(save, targetId, commits), [save, targetId, commits]);
  const hasCommit = Object.values(commits).some(a => a.asker > 0 || a.tank > 0 || a.ucak > 0);
  const hasGround = Object.values(commits).some(a => a.asker > 0 || a.tank > 0);
  const airOnly = hasCommit && !hasGround;
  const outcome = preview && hasCommit ? OUTCOME_CONFIG[preview.outcome] : null;

  const terrain = terrainOf(targetId);
  const terrainBonus = TERRAIN_DEFENSE_BONUS[terrain];

  const setCommit = (provId: string, key: keyof Army, val: number) => {
    setCommits(prev => ({
      ...prev,
      [provId]: { ...(prev[provId] ?? { ...EMPTY }), [key]: val },
    }));
  };

  const selectAll = () => {
    const all: Record<string, Army> = {};
    for (const provId of sources) all[provId] = availableAt(provId);
    // Çıkarma kaynakları: gemi kapasitesi kadar (önce asker, kalan ağırlıkla tank)
    for (const provId of seaSources) {
      const avail = availableAt(provId);
      const cap = shipCapacityOf(save, provId);
      const asker = Math.min(avail.asker, cap);
      const tank = Math.min(avail.tank, Math.floor((cap - asker * SEA_WEIGHT.asker) / SEA_WEIGHT.tank));
      all[provId] = { asker, tank, ucak: avail.ucak };
    }
    // Uzak üslerden yalnız uçaklar katılır
    for (const provId of airOnlyBases) {
      all[provId] = { ...EMPTY, ucak: availableAt(provId).ucak };
    }
    setCommits(all);
  };

  const sliderFor = (provId: string, key: keyof Army, avail: number, label: string, accent: string) => (
    <div className="mb-1">
      <div className="flex justify-between text-[9px] text-slate-400 mb-0.5">
        <span>{label}</span>
        <span className="font-mono">{formatCount(commits[provId]?.[key] || 0)} / {formatCount(avail)}</span>
      </div>
      <input
        type="range" min={0} max={avail}
        step={Math.max(1, Math.floor(avail / 100))}
        value={commits[provId]?.[key] || 0}
        onChange={e => setCommit(provId, key, Math.min(avail, parseInt(e.target.value) || 0))}
        className={`w-full ${accent} h-1.5`}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="panel-in relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        {/* Başlık */}
        <div className="p-4 pb-2 shrink-0 border-b border-slate-800">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <h3 className="text-sm font-black tracking-wide text-white flex items-center gap-2">
            <Target className="w-4 h-4 text-red-500" />
            TAARRUZ EMRİ — {targetName.toUpperCase()}
          </h3>
          <p className="text-[10px] text-slate-500 mt-1">
            Emir tur sonunda işlenir. Emre bağlanan birlikler kilitlenir: kendi ilini ancak
            %25 kapasiteyle savunur. Sonucu Güç Oranı (R) belirler.
          </p>
          <div className="mt-2 flex gap-3 text-[9px] font-mono text-slate-400 bg-slate-950/60 rounded p-1.5 border border-slate-800">
            <span className="text-slate-500 font-bold">HEDEF:</span>
            <span className="text-red-300">Savunma: {formatCount(preview?.defensePower ?? 0)}</span>
            <span>Arazi: {TERRAIN_LABELS[terrain]} (x{terrainBonus.toFixed(2)})</span>
          </div>
        </div>

        {/* Kaynak iller */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
          {sources.length === 0 && airOnlyBases.length === 0 && seaSources.length === 0 && (
            <div className="text-center text-slate-500 py-6 text-xs bg-slate-950/30 rounded-xl border border-slate-800 border-dashed">
              Hedefe komşu ilimiz, çıkarma filomuz ve uçağımız yok — bölge ele geçir,
              kıyı ilinde liman+gemi kur ya da uçak üret.
            </div>
          )}
          {sources.length > 0 && (
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">
              🪖 KOMŞU İLLER — kara + hava taarruzu
            </span>
          )}
          {sources.map(provId => {
            const avail = availableAt(provId);
            const name = provinceDisplayName(provId);
            const isEmpty = avail.asker === 0 && avail.tank === 0 && avail.ucak === 0;
            if (isEmpty) {
              return (
                <div key={provId} className="p-2.5 bg-slate-950/30 border border-slate-800/40 rounded-xl flex justify-between items-center text-xs opacity-60">
                  <span className="font-semibold text-slate-400">{name}</span>
                  <span className="text-[10px] text-slate-500">Kullanılabilir birlik yok — Transfer ile asker taşı</span>
                </div>
              );
            }
            return (
              <div key={provId} className="rounded-lg border p-2 bg-slate-950/80 border-slate-700/60">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-bold text-slate-200">{name}</span>
                </div>
                {avail.asker > 0 && sliderFor(provId, 'asker', avail.asker, '🪖 Asker', 'accent-red-500')}
                {avail.tank > 0 && sliderFor(provId, 'tank', avail.tank, '🛡️ Tank', 'accent-yellow-500')}
                {avail.ucak > 0 && sliderFor(provId, 'ucak', avail.ucak, '✈️ Uçak', 'accent-blue-500')}
              </div>
            );
          })}

          {/* Deniz yolu: limanlı+gemili kıyı illerinden ÇIKARMA — taşıma gemi
              kapasitesiyle sınırlıdır; slider'lar birbirini kapasiteye göre kısıtlar */}
          {seaSources.length > 0 && (
            <>
              <span className="text-[9px] text-cyan-300 font-bold uppercase tracking-wider block pt-1">
                🚢 DENİZ YOLU — çıkarma harekâtı (gemi kapasitesiyle sınırlı)
              </span>
              {seaSources.map(provId => {
                const avail = availableAt(provId);
                const cap = shipCapacityOf(save, provId);
                const cur = commits[provId] ?? EMPTY;
                const usedW = seaLiftWeight(cur);
                // Kalan ağırlığa göre dinamik tavan: toplam yük kapasiteyi aşamaz
                const askerMax = Math.min(avail.asker, cur.asker + Math.max(0, cap - usedW));
                const tankMax = Math.min(avail.tank, cur.tank + Math.max(0, Math.floor((cap - usedW) / SEA_WEIGHT.tank)));
                const name = provinceDisplayName(provId);
                return (
                  <div key={`sea-${provId}`} className="rounded-lg border p-2 bg-cyan-950/30 border-cyan-900/40">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-bold text-slate-200">{name}</span>
                      <span className={`text-[9px] font-mono ${usedW >= cap ? 'text-amber-300' : 'text-cyan-300/80'}`}>
                        🚢 yük {formatCount(usedW)} / {formatCount(cap)}
                      </span>
                    </div>
                    {avail.asker > 0 && sliderFor(provId, 'asker', askerMax, '🪖 Asker (gemiyle)', 'accent-cyan-500')}
                    {avail.tank > 0 && sliderFor(provId, 'tank', tankMax, `🛡️ Tank (${SEA_WEIGHT.tank} ağırlık)`, 'accent-cyan-500')}
                    {avail.ucak > 0 && sliderFor(provId, 'ucak', avail.ucak, '✈️ Uçak (uçar, yük tutmaz)', 'accent-blue-500')}
                  </div>
                );
              })}
            </>
          )}

          {/* Uzak hava üsleri: uçaklar menzil tanımaz, her üsten katılır */}
          {airOnlyBases.length > 0 && (
            <>
              <span className="text-[9px] text-blue-300 font-bold uppercase tracking-wider block pt-1">
                ✈️ HAVA DESTEĞİ — uzaktaki üsler (yalnız uçak, menzilsiz)
              </span>
              {airOnlyBases.map(provId => {
                const avail = availableAt(provId);
                if (avail.ucak <= 0) return null;
                const name = provinceDisplayName(provId);
                return (
                  <div key={`air-${provId}`} className="rounded-lg border p-2 bg-blue-950/30 border-blue-900/40">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-bold text-slate-200">{name}</span>
                    </div>
                    {sliderFor(provId, 'ucak', avail.ucak, '✈️ Uçak', 'accent-blue-500')}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Önizleme + onay */}
        <div className="p-4 pt-2 shrink-0 border-t border-slate-800 space-y-2">
          {(sources.length > 0 || airOnlyBases.length > 0 || seaSources.length > 0) && (
            <button
              onClick={selectAll}
              className="w-full py-1 rounded text-[10px] font-medium border border-slate-700/50 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              Tüm Birlikleri Seç
            </button>
          )}

          {/* Güç oranı göstergesi — motordaki eşiklerin birebir önizlemesi */}
          <div className={`rounded-lg p-2.5 border ${outcome ? `${outcome.border} ${outcome.bg}` : 'border-slate-800 bg-slate-950/60'}`}>
            <div className="flex justify-between items-center text-[10px] mb-1">
              <span className="text-slate-400">Taarruz Gücün (Patk):</span>
              <span className="font-mono font-bold text-blue-300">{formatCount(preview?.attackPower ?? 0)}</span>
            </div>
            <div className="flex justify-between items-center text-[10px] mb-1">
              <span className="text-slate-400">Savunma Gücü (Pdef):</span>
              <span className="font-mono font-bold text-red-300">{formatCount(preview?.defensePower ?? 0)}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-300 font-bold">Güç Oranı R:</span>
              <span className={`font-mono font-black text-sm ${outcome?.color ?? 'text-slate-500'}`}>
                {hasCommit && preview ? (Number.isFinite(preview.ratio) ? preview.ratio.toFixed(2) : '∞') : '—'}
              </span>
            </div>
            {outcome && (
              <div className={`mt-1.5 text-[10px] font-bold ${outcome.color}`}>
                {outcome.label}
                <span className="block font-normal text-[9px] text-slate-400 mt-0.5">{outcome.hint}</span>
              </div>
            )}
            {/* Emir tur sonunda çözülür: hedef bu turun anavatan takviyesini alacaksa
                fiili savunma yükselir — muhafazakâr tahmin burada gösterilir */}
            {hasCommit && preview && preview.reinforcement > 0 && (
              <div className={`text-[9px] mt-1 ${preview.outcomeAfter !== preview.outcome ? 'text-amber-300' : 'text-slate-400'}`}>
                🛡️ Tur sonunda beklenen takviye: +{formatCount(preview.reinforcement)} →
                {' '}R ≈ {Number.isFinite(preview.ratioAfter) ? preview.ratioAfter.toFixed(2) : '∞'}
                {' '}<span className={`font-bold ${OUTCOME_CONFIG[preview.outcomeAfter].color}`}>
                  ({OUTCOME_CONFIG[preview.outcomeAfter].label})
                </span>
              </div>
            )}
            {airOnly && (
              <div className="text-[9px] text-blue-300 mt-1">
                ✈️ Yalnız hava akını: bölgeyi ELE GEÇİREMEZ, yalnız hasar verir. Ele geçirmek için
                komşu ilden asker/tank gönder.
              </div>
            )}
            {hasCommit && preview && preview.planesLost > 0 && (
              <div className="text-[9px] text-purple-300 font-mono mt-1">
                ✈️ Beklenen uçak kaybı: ~{preview.planesLost}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg text-xs transition-colors border border-slate-700/50"
            >
              Vazgeç
            </button>
            <button
              onClick={() => { if (hasCommit) onQueue(commits); }}
              disabled={!hasCommit}
              className={`flex-1 py-2 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 ${
                hasCommit
                  ? 'bg-red-700 hover:bg-red-600 text-white'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              }`}
            >
              <Swords className="w-3.5 h-3.5" /> Emri Kuyruğa Al
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
