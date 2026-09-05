import React, { useRef, useState } from 'react';
import { Globe2, Play, RotateCcw, ChevronLeft, Power, Settings, Check, Map, Search, FolderOpen, Trash2 } from 'lucide-react';
import { Difficulty } from '../engine/types';
import { MapLayout, MAP_LAYOUT_INFO, loadSettings, saveSettings } from '../engine/settings';
import { FEATURED_COUNTRIES, COUNTRY_META, countryName } from '../engine/countryData';
import { DEFAULT_PLAYER_COLOR, SaveSlotMeta } from '../engine/save';
import { exitApplication } from '../platform';

interface MainMenuProps {
  hasSave: boolean;
  slots: SaveSlotMeta[];
  onContinue: () => void;
  onNewGame: (difficulty: Difficulty, countryId: string, color: string) => void;
  onLoadSlot: (id: string) => void;
  onDeleteSlot: (id: string) => void;
}

// Oyuncunun seçebileceği toprak renkleri — canlı "faksiyon" tonları. İlki
// varsayılan (mavi). Düşman kırmızısına yakın ton bilinçli dışarıda tutulmadı;
// oyuncu isterse kırmızıyı da seçebilir (kendi imparatorluğu tek blok görünür).
const PLAYER_COLORS: { name: string; value: string }[] = [
  { name: 'Mavi', value: DEFAULT_PLAYER_COLOR },
  { name: 'Camgöbeği', value: '#0891b2' },
  { name: 'Deniz Yeşili', value: '#0d9488' },
  { name: 'Yeşil', value: '#16a34a' },
  { name: 'Mor', value: '#7c3aed' },
  { name: 'Pembe', value: '#db2777' },
  { name: 'Turuncu', value: '#ea580c' },
  { name: 'Kızıl', value: '#dc2626' },
];

const MAP_LAYOUT_ORDER: MapLayout[] = ['basit', 'detayli', 'gercek'];

// Seçilebilir ülkeler: öne çıkanlar önce, sonra tablodaki diğerleri (ada göre)
const ALL_COUNTRY_IDS = [
  ...FEATURED_COUNTRIES,
  ...Object.keys(COUNTRY_META).filter(id => !FEATURED_COUNTRIES.includes(id))
    .sort((a, b) => countryName(a).localeCompare(countryName(b), 'tr')),
];

const DIFFICULTY_OPTIONS: { id: Difficulty; label: string; desc: string; color: string }[] = [
  { id: 'kolay', label: 'Kolay', desc: 'Düşmanlar yarı güçte — rahat başlangıç', color: 'bg-green-700 hover:bg-green-600 active:bg-green-800' },
  { id: 'orta', label: 'Orta', desc: 'Gerçek dünya güç dengeleri', color: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800' },
  { id: 'zor', label: 'Zor', desc: 'Düşmanlar iki kat güçlü ve saldırgan', color: 'bg-red-700 hover:bg-red-600 active:bg-red-800' },
];

export function MainMenu({ hasSave, slots, onContinue, onNewGame, onLoadSlot, onDeleteSlot }: MainMenuProps) {
  const [choosingCountry, setChoosingCountry] = useState(false);
  const [choosingDifficulty, setChoosingDifficulty] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string>('792');
  const [selectedColor, setSelectedColor] = useState<string>(DEFAULT_PLAYER_COLOR);
  const [countryQuery, setCountryQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSaves, setShowSaves] = useState(false);
  // Silme iki aşamalı: ilk dokunuş yuvayı "emin misin?" durumuna alır
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [mapLayout, setMapLayout] = useState<MapLayout>(() => loadSettings().mapLayout);

  const selectLayout = (layout: MapLayout) => {
    setMapLayout(layout);
    saveSettings({ mapLayout: layout });
  };

  // Ekran geçişi tıklama kilidi: Yeni Oyun → ülke → zorluk butonları ekranda aynı
  // noktaya denk gelir; hızlı çift tık (mobilde ghost-click) bir hamlede iki ekran
  // atlatıp istemeden ülke+zorluk seçtirebiliyordu. Geçişten sonraki 300ms'de
  // gelen tıklar yutulur.
  const lockUntil = useRef(0);
  const guarded = (fn: () => void) => () => {
    if (Date.now() < lockUntil.current) return;
    lockUntil.current = Date.now() + 300;
    fn();
  };

  // Yeni oyun artık YENİ yuvada başlar (mevcut kayıtlar silinmez) — eski
  // "kayıt silinecek" onay modalı bu yüzden kaldırıldı.
  const startCountrySelection = () => {
    setCountryQuery('');
    setChoosingCountry(true);
  };

  const pickCountry = (id: string) => {
    setSelectedCountry(id);
    setChoosingCountry(false);
    setChoosingDifficulty(true);
  };

  const q = countryQuery.trim().toLocaleLowerCase('tr');
  const countryList = q
    ? ALL_COUNTRY_IDS.filter(id => countryName(id).toLocaleLowerCase('tr').includes(q))
    : ALL_COUNTRY_IDS;

  const handleExit = () => {
    exitApplication();
  };

  return (
    <div className="relative flex flex-col items-center justify-center h-dvh bg-[#070d1b] text-slate-200 overflow-hidden">
      {/* Atmosferik arka plan: yumuşak renk lekeleri + vinyet + silik ızgara.
          Salt CSS — WebView'de ucuz; içerik z-10 üstünde durur. */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[420px] rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, #1d4ed8, transparent)' }} />
        <div className="absolute bottom-[-180px] right-[-120px] w-[520px] h-[420px] rounded-full opacity-15 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, #b45309, transparent)' }} />
        <div className="absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: 'linear-gradient(rgba(148,163,184,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.6) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(2,6,17,0.9) 100%)' }} />
      </div>
      {/* Dar ekranda (telefon dikey) logo kenara taşmasın: ikon/yazı/harf aralığı
          sm altında kademeli küçülür — 375px'te başlık ekrana sığar */}
      <div className="relative z-10 flex items-center gap-3 sm:gap-4 mb-3 px-4">
        <Globe2 className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 text-amber-400 drop-shadow-[0_0_14px_rgba(251,191,36,0.45)]" />
        <h1 className="text-4xl sm:text-5xl font-black tracking-[0.12em] sm:tracking-[0.2em] text-white drop-shadow-[0_2px_18px_rgba(59,130,246,0.35)]">HEGEMON</h1>
      </div>

      <p className="text-slate-400 mb-10 text-center max-w-md px-6 text-sm">
        {choosingCountry ? 'Hangi ülkeyle başlamak istersin?'
          : choosingDifficulty ? `${countryName(selectedCountry)} · Zorluk seviyesini seç.`
          : 'Ekonomini büyüt, ordunu kur, dünyayı fethet.'}
      </p>

      {choosingCountry ? (
        <div className="flex flex-col gap-3 w-full max-w-lg px-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={countryQuery}
              onChange={e => setCountryQuery(e.target.value)}
              placeholder="Ülke ara…"
              className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 max-h-[46vh] overflow-y-auto pr-1">
            {countryList.map(id => (
              <button
                key={id}
                onClick={guarded(() => pickCountry(id))}
                // h-9 + leading-9: sabit yükseklik, metin dikeyde ortalı. (py ile truncate
                // birleşimi grid'de satırları çökertiyordu: overflow:hidden'lı grid öğesinin
                // min boyutu 0 sayılınca satır, metin yüksekliğini yok sayıyordu.)
                className="h-9 leading-9 px-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-700 border border-slate-700 hover:border-blue-600 rounded-lg text-xs font-medium text-slate-200 transition-colors truncate"
                title={countryName(id)}
              >
                {countryName(id)}
              </button>
            ))}
            {countryList.length === 0 && (
              <div className="col-span-3 text-center text-slate-500 text-xs py-6">Ülke bulunamadı.</div>
            )}
          </div>
          <button
            onClick={() => setChoosingCountry(false)}
            className="flex items-center justify-center gap-1 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Geri
          </button>
        </div>
      ) : choosingDifficulty ? (
        <div className="flex flex-col gap-3 w-80">
          {/* Ülke rengi seçimi — haritada senin toprağın bu renkte olur */}
          <div className="flex flex-col gap-2 mb-1">
            <span className="text-[11px] text-slate-400 text-center tracking-wide">ÜLKE RENGİN</span>
            <div className="flex items-center justify-center gap-2">
              {PLAYER_COLORS.map(c => {
                const active = selectedColor === c.value;
                return (
                  <button
                    key={c.value}
                    aria-label={`Renk: ${c.name}`}
                    title={c.name}
                    onClick={() => setSelectedColor(c.value)}
                    className={`w-7 h-7 rounded-full transition-transform ${active ? 'ring-2 ring-white ring-offset-2 ring-offset-[#070d1b] scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100'}`}
                    style={{ backgroundColor: c.value }}
                  >
                    {active && <Check className="w-4 h-4 text-white mx-auto drop-shadow" />}
                  </button>
                );
              })}
            </div>
          </div>
          {DIFFICULTY_OPTIONS.map(opt => (
            <button
              key={opt.id}
              aria-label={`${opt.label} zorlukta başla`}
              onClick={guarded(() => onNewGame(opt.id, selectedCountry, selectedColor))}
              className={`flex flex-col items-center px-8 py-3 text-white font-bold rounded-lg transition-colors shadow-lg ${opt.color}`}
            >
              <span>{opt.label}</span>
              <span className="text-[11px] font-normal opacity-80">{opt.desc}</span>
            </button>
          ))}
          <button
            onClick={() => { setChoosingDifficulty(false); setChoosingCountry(true); }}
            className="flex items-center justify-center gap-1 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Geri
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 w-64">
          {hasSave && (
            <button
              onClick={onContinue}
              className="flex items-center justify-center gap-2 px-8 py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors shadow-lg shadow-blue-900/20"
            >
              <Play className="w-5 h-5" /> Devam Et
            </button>
          )}
          <button
            onClick={guarded(startCountrySelection)}
            className={`flex items-center justify-center gap-2 px-8 py-4 font-bold rounded-lg transition-colors ${
              hasSave
                ? 'bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 border border-slate-700'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-lg shadow-blue-900/20'
            }`}
          >
            <RotateCcw className="w-5 h-5" /> Yeni Oyun
          </button>
          {slots.length > 0 && (
            <button
              onClick={() => { setConfirmDeleteId(null); setShowSaves(true); }}
              className="flex items-center justify-center gap-2 px-8 py-3 bg-slate-800/60 hover:bg-slate-700 active:bg-slate-600 text-slate-300 hover:text-white font-medium rounded-lg transition-colors border border-slate-700/50"
            >
              <FolderOpen className="w-4 h-4" /> Kayıtlar ({slots.length})
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center gap-2 px-8 py-3 bg-slate-800/60 hover:bg-slate-700 active:bg-slate-600 text-slate-300 hover:text-white font-medium rounded-lg transition-colors border border-slate-700/50"
          >
            <Settings className="w-4 h-4" /> Ayarlar
          </button>
          <button
            onClick={handleExit}
            className="flex items-center justify-center gap-2 px-8 py-3 bg-slate-800/60 hover:bg-slate-700 active:bg-slate-600 text-slate-400 hover:text-slate-200 font-medium rounded-lg transition-colors border border-slate-700/50"
          >
            <Power className="w-4 h-4" /> Çıkış
          </button>
        </div>
      )}

      {/* Kayıtlar: yuva listesi — yükle / sil (iki aşamalı onay) */}
      {showSaves && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-2 mb-1">
              <FolderOpen className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-black tracking-wide text-white">KAYITLAR</h2>
            </div>
            <p className="text-[11px] text-slate-500 mb-4">
              Her oyun kendi yuvasına otomatik kaydedilir. Bir kaydı yükle veya sil.
            </p>

            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pr-1">
              {slots.map(slot => {
                const confirming = confirmDeleteId === slot.id;
                return (
                  <div
                    key={slot.id}
                    data-testid="save-slot"
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-700/50"
                  >
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: slot.playerColor }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-200 truncate">
                        {countryName(slot.countryId)}
                        {slot.conquests > 0 && <span className="text-amber-400 font-normal"> · {slot.conquests} fetih</span>}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Tur {slot.turn} · {DIFFICULTY_OPTIONS.find(d => d.id === slot.difficulty)?.label ?? slot.difficulty}
                        {' · '}{MAP_LAYOUT_INFO[slot.mapLayout as MapLayout]?.label ?? slot.mapLayout}
                        {' · '}{new Date(slot.updatedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    {confirming ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => { setConfirmDeleteId(null); onDeleteSlot(slot.id); }}
                          className="px-2.5 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          Sil
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 transition-colors"
                        >
                          Vazgeç
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => { setShowSaves(false); onLoadSlot(slot.id); }}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          <Play className="w-3 h-3" /> Yükle
                        </button>
                        <button
                          aria-label={`${countryName(slot.countryId)} kaydını sil`}
                          onClick={() => setConfirmDeleteId(slot.id)}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {slots.length === 0 && (
                <div className="text-center text-slate-500 text-xs py-6">Kayıt yok.</div>
              )}
            </div>

            <button
              onClick={() => setShowSaves(false)}
              className="mt-5 w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* Ayarlar: Harita Düzeni seçimi (yeni oyunlara uygulanır) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-2 mb-1">
              <Map className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-black tracking-wide text-white">HARİTA DÜZENİ</h2>
            </div>
            <p className="text-[11px] text-slate-500 mb-4">
              Düşman ülkelerinin haritada kaç bölgeye ayrılacağını seçer. Yeni başlatılan oyunlara uygulanır.
            </p>

            <div className="flex flex-col gap-2.5">
              {MAP_LAYOUT_ORDER.map(id => {
                const info = MAP_LAYOUT_INFO[id];
                const active = mapLayout === id;
                return (
                  <button
                    key={id}
                    onClick={() => selectLayout(id)}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                      active
                        ? 'bg-amber-950/40 border-amber-600/70 ring-1 ring-amber-600/40'
                        : 'bg-slate-950 border-slate-700/50 hover:border-slate-500 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-bold text-sm ${active ? 'text-amber-300' : 'text-slate-200'}`}>{info.label}</span>
                      {active && <Check className="w-4 h-4 text-amber-400" />}
                    </div>
                    <span className="text-[11px] text-slate-400 mt-0.5">{info.desc}</span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="mt-5 w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors"
            >
              Tamam
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
