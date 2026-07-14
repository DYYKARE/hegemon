// Türkiye'nin kara komşuları — savaş açabilecek tek aday havuzu bu.
export const NEIGHBOR_COUNTRIES: { id: string; name: string }[] = [
  { id: '300', name: 'Yunanistan' },
  { id: '100', name: 'Bulgaristan' },
  { id: '268', name: 'Gürcistan' },
  { id: '051', name: 'Ermenistan' },
  { id: '031', name: 'Azerbaycan' },
  { id: '364', name: 'İran' },
  { id: '368', name: 'Irak' },
  { id: '760', name: 'Suriye' },
];

// Her cephenin işgal sırası (bkz. docs/savas-matematigi.md)
export const BORDER_PROVINCES: Record<string, string[]> = {
  '300': ['tr-22'],
  '100': ['tr-22', 'tr-39'],
  '268': ['tr-8', 'tr-75'],
  '051': ['tr-75', 'tr-36', 'tr-76'],
  '031': ['tr-76'],
  '364': ['tr-4', 'tr-65', 'tr-30'],
  '368': ['tr-30', 'tr-73'],
  '760': ['tr-31', 'tr-79', 'tr-27', 'tr-63', 'tr-47', 'tr-73'],
};

export const PROVINCE_NAMES: Record<string, string> = {
  'tr-1': 'Adana', 'tr-2': 'Adıyaman', 'tr-3': 'Afyon', 'tr-4': 'Ağrı',
  'tr-5': 'Amasya', 'tr-6': 'Ankara', 'tr-7': 'Antalya', 'tr-8': 'Artvin',
  'tr-9': 'Aydın', 'tr-10': 'Balıkesir', 'tr-11': 'Bilecik', 'tr-12': 'Bingöl',
  'tr-13': 'Bitlis', 'tr-14': 'Bolu', 'tr-15': 'Burdur', 'tr-16': 'Bursa',
  'tr-17': 'Çanakkale', 'tr-18': 'Çankırı', 'tr-19': 'Çorum', 'tr-20': 'Denizli',
  'tr-21': 'Diyarbakır', 'tr-22': 'Edirne', 'tr-23': 'Elazığ', 'tr-24': 'Erzincan',
  'tr-25': 'Erzurum', 'tr-26': 'Eskişehir', 'tr-27': 'Gaziantep', 'tr-28': 'Giresun',
  'tr-29': 'Gümüşhane', 'tr-30': 'Hakkari', 'tr-31': 'Hatay', 'tr-32': 'Isparta',
  'tr-33': 'Mersin', 'tr-34': 'İstanbul', 'tr-35': 'İzmir', 'tr-36': 'Kars',
  'tr-37': 'Kastamonu', 'tr-38': 'Kayseri', 'tr-39': 'Kırklareli', 'tr-40': 'Kırşehir',
  'tr-41': 'Kocaeli', 'tr-42': 'Konya', 'tr-43': 'Kütahya', 'tr-44': 'Malatya',
  'tr-45': 'Manisa', 'tr-46': 'Kahramanmaraş', 'tr-47': 'Mardin', 'tr-48': 'Muğla',
  'tr-49': 'Muş', 'tr-50': 'Nevşehir', 'tr-51': 'Niğde', 'tr-52': 'Ordu',
  'tr-53': 'Rize', 'tr-54': 'Sakarya', 'tr-55': 'Samsun', 'tr-56': 'Siirt',
  'tr-57': 'Sinop', 'tr-58': 'Sivas', 'tr-59': 'Tekirdağ', 'tr-60': 'Tokat',
  'tr-61': 'Trabzon', 'tr-62': 'Tunceli', 'tr-63': 'Şanlıurfa', 'tr-64': 'Uşak',
  'tr-65': 'Van', 'tr-66': 'Yozgat', 'tr-67': 'Zonguldak', 'tr-68': 'Aksaray',
  'tr-69': 'Bayburt', 'tr-70': 'Karaman', 'tr-71': 'Kırıkkale', 'tr-72': 'Batman',
  'tr-73': 'Şırnak', 'tr-74': 'Bartın', 'tr-75': 'Ardahan', 'tr-76': 'Iğdır',
  'tr-77': 'Yalova', 'tr-78': 'Karabük', 'tr-79': 'Kilis', 'tr-80': 'Osmaniye',
  'tr-81': 'Düzce'
};

export interface ProvinceInfo {
  id: string;
  name: string;
  sliceIdx: number; // hangi dikey dilim (0 en batı). Bölge sayısına göre 0..N-1
  neighbors: string[]; // komşu bölge id'leri: TR illeri, aynı ülke bölgeleri VE
                       // bitişik düşman ülkelerin sınır bölgeleri (ülkeler arası kara sınırı)
}

import type { MapLayout } from './settings';

// --- BASİT düzen: her ülke 2-3 geniş bölge (ülkeler arası sınırlar satır içi) ---
export const NEIGHBOR_PROVINCES_BASIT: Record<string, ProvinceInfo[]> = {
  '300': [ // Yunanistan
    { id: '300-p1', name: 'Batı Trakya', sliceIdx: 2, neighbors: ['tr-22', '100-p3'] },
    { id: '300-p2', name: 'Makedonya & Teselya', sliceIdx: 1, neighbors: ['300-p1'] },
    { id: '300-p3', name: 'Peloponez & Atina', sliceIdx: 0, neighbors: ['300-p2'] },
  ],
  '100': [ // Bulgaristan
    { id: '100-p1', name: 'Burgaz & Varna', sliceIdx: 2, neighbors: ['tr-39', '100-p3'] },
    { id: '100-p2', name: 'Sofya & Filibe', sliceIdx: 0, neighbors: ['100-p3'] },
    { id: '100-p3', name: 'Hasköy & Kırcaali', sliceIdx: 1, neighbors: ['tr-22', 'tr-39', '300-p1'] },
  ],
  '268': [ // Gürcistan
    { id: '268-p1', name: 'Acara & Batum', sliceIdx: 0, neighbors: ['tr-8'] },
    { id: '268-p2', name: 'Tiflis & İmereti', sliceIdx: 1, neighbors: ['tr-75', '268-p1', '051-p1', '031-p2'] },
  ],
  '051': [ // Ermenistan
    { id: '051-p1', name: 'Gümrü & Şirak', sliceIdx: 0, neighbors: ['tr-75', 'tr-36', '268-p2', '031-p2'] },
    { id: '051-p2', name: 'Erivan', sliceIdx: 1, neighbors: ['tr-76', '051-p1', '031-p1', '364-p1'] },
  ],
  '031': [ // Azerbaycan
    { id: '031-p1', name: 'Nahçıvan', sliceIdx: 0, neighbors: ['tr-76', '051-p2', '364-p1'] },
    { id: '031-p2', name: 'Karabağ & Gence', sliceIdx: 1, neighbors: ['031-p1', '268-p2', '051-p1', '364-p2'] },
    { id: '031-p3', name: 'Bakü', sliceIdx: 2, neighbors: ['031-p2'] },
  ],
  '364': [ // İran
    { id: '364-p1', name: 'Batı Azerbaycan', sliceIdx: 0, neighbors: ['tr-4', 'tr-65', 'tr-30', '051-p2', '031-p1', '368-p1'] },
    { id: '364-p2', name: 'Tahran', sliceIdx: 1, neighbors: ['364-p1', '031-p2', '368-p2'] },
    { id: '364-p3', name: 'İsfahan & Güney', sliceIdx: 2, neighbors: ['364-p2', '368-p3'] },
  ],
  '368': [ // Irak
    { id: '368-p1', name: 'Erbil & Musul', sliceIdx: 0, neighbors: ['tr-30', 'tr-73', '364-p1', '760-p2'] },
    { id: '368-p2', name: 'Bağdat', sliceIdx: 1, neighbors: ['368-p1', '364-p2'] },
    { id: '368-p3', name: 'Basra', sliceIdx: 2, neighbors: ['368-p2', '364-p3'] },
  ],
  '760': [ // Suriye
    { id: '760-p1', name: 'Halep & İdlib', sliceIdx: 0, neighbors: ['tr-31', 'tr-79', 'tr-27'] },
    { id: '760-p2', name: 'Rakka & Haseke', sliceIdx: 1, neighbors: ['tr-63', 'tr-47', 'tr-73', '368-p1'] },
    { id: '760-p3', name: 'Şam & Humus', sliceIdx: 2, neighbors: ['760-p1', '760-p2'] },
  ],
};

// --- DETAYLI düzen: her ülke 4-6 gerçek şehir adlı bölge, sınırdan içeriye zincir ---
// (Dikey-dilim render'ıyla uyumlu; sliceIdx en yüksek = TR'ye en yakın taraf.)
export const NEIGHBOR_PROVINCES_DETAYLI: Record<string, ProvinceInfo[]> = {
  '300': [ // Yunanistan (batıya doğru: Batı Trakya sınır)
    { id: '300-p1', name: 'Batı Trakya', sliceIdx: 4, neighbors: ['tr-22', '300-p2', '100-p1'] },
    { id: '300-p2', name: 'Selanik', sliceIdx: 3, neighbors: ['300-p1', '300-p3'] },
    { id: '300-p3', name: 'Teselya', sliceIdx: 2, neighbors: ['300-p2', '300-p4'] },
    { id: '300-p4', name: 'Atina & Attika', sliceIdx: 1, neighbors: ['300-p3', '300-p5'] },
    { id: '300-p5', name: 'Mora (Peloponez)', sliceIdx: 0, neighbors: ['300-p4'] },
  ],
  '100': [ // Bulgaristan
    { id: '100-p1', name: 'Kırcaali & Hasköy', sliceIdx: 4, neighbors: ['tr-22', 'tr-39', '100-p2', '100-p3', '300-p1'] },
    { id: '100-p2', name: 'Burgaz (Karadeniz)', sliceIdx: 3, neighbors: ['tr-39', '100-p1', '100-p5'] },
    { id: '100-p3', name: 'Filibe (Plovdiv)', sliceIdx: 2, neighbors: ['100-p1', '100-p4'] },
    { id: '100-p4', name: 'Sofya', sliceIdx: 1, neighbors: ['100-p3', '100-p5'] },
    { id: '100-p5', name: 'Varna & Ruse', sliceIdx: 0, neighbors: ['100-p2', '100-p4'] },
  ],
  '268': [ // Gürcistan
    { id: '268-p1', name: 'Acara & Batum', sliceIdx: 0, neighbors: ['tr-8', '268-p2'] },
    { id: '268-p2', name: 'Samtshe & İmereti', sliceIdx: 1, neighbors: ['tr-75', '268-p1', '268-p3', '051-p1'] },
    { id: '268-p3', name: 'Tiflis', sliceIdx: 2, neighbors: ['268-p2', '268-p4', '051-p2', '031-p3'] },
    { id: '268-p4', name: 'Kaheti', sliceIdx: 3, neighbors: ['268-p3', '031-p3'] },
  ],
  '051': [ // Ermenistan
    { id: '051-p1', name: 'Şirak & Lori', sliceIdx: 0, neighbors: ['tr-75', 'tr-36', '051-p2', '268-p2'] },
    { id: '051-p2', name: 'Gümrü & Aragatsotn', sliceIdx: 1, neighbors: ['051-p1', '051-p3', '268-p3', '031-p2'] },
    { id: '051-p3', name: 'Erivan', sliceIdx: 2, neighbors: ['tr-76', '051-p2', '051-p4', '031-p1', '364-p1'] },
    { id: '051-p4', name: 'Syunik', sliceIdx: 3, neighbors: ['051-p3', '031-p2', '364-p1'] },
  ],
  '031': [ // Azerbaycan
    { id: '031-p1', name: 'Nahçıvan', sliceIdx: 0, neighbors: ['tr-76', '051-p3', '364-p1'] },
    { id: '031-p2', name: 'Karabağ', sliceIdx: 1, neighbors: ['031-p1', '031-p3', '051-p2', '051-p4', '364-p2'] },
    { id: '031-p3', name: 'Gence', sliceIdx: 2, neighbors: ['031-p2', '031-p4', '268-p3', '268-p4'] },
    { id: '031-p4', name: 'Bakü', sliceIdx: 3, neighbors: ['031-p3', '031-p5'] },
    { id: '031-p5', name: 'Quba & Şirvan', sliceIdx: 4, neighbors: ['031-p4'] },
  ],
  '364': [ // İran
    { id: '364-p1', name: 'Urmiye (Batı Azerb.)', sliceIdx: 0, neighbors: ['tr-4', 'tr-65', 'tr-30', '364-p2', '364-p3', '051-p3', '051-p4', '031-p1', '368-p1'] },
    { id: '364-p2', name: 'Tebriz & Erdebil', sliceIdx: 1, neighbors: ['364-p1', '364-p4', '031-p2'] },
    { id: '364-p3', name: 'Kermanşah & Kürdistan', sliceIdx: 2, neighbors: ['364-p1', '364-p4', '368-p2', '368-p4'] },
    { id: '364-p4', name: 'Tahran', sliceIdx: 3, neighbors: ['364-p2', '364-p3', '364-p5'] },
    { id: '364-p5', name: 'İsfahan', sliceIdx: 4, neighbors: ['364-p4', '364-p6'] },
    { id: '364-p6', name: 'Fars & Güney', sliceIdx: 5, neighbors: ['364-p5', '368-p5'] },
  ],
  '368': [ // Irak
    { id: '368-p1', name: 'Musul & Duhok', sliceIdx: 0, neighbors: ['tr-30', 'tr-73', '368-p2', '368-p3', '364-p1', '760-p2'] },
    { id: '368-p2', name: 'Erbil & Süleymaniye', sliceIdx: 1, neighbors: ['tr-30', '368-p1', '368-p3', '364-p3'] },
    { id: '368-p3', name: 'Kerkük', sliceIdx: 2, neighbors: ['368-p1', '368-p2', '368-p4'] },
    { id: '368-p4', name: 'Bağdat', sliceIdx: 3, neighbors: ['368-p3', '368-p5', '364-p3'] },
    { id: '368-p5', name: 'Basra & Güney', sliceIdx: 4, neighbors: ['368-p4', '364-p6'] },
  ],
  '760': [ // Suriye
    { id: '760-p1', name: 'Halep & İdlib', sliceIdx: 0, neighbors: ['tr-31', 'tr-79', 'tr-27', '760-p2', '760-p3'] },
    { id: '760-p2', name: 'Rakka & Haseke', sliceIdx: 1, neighbors: ['tr-63', 'tr-47', 'tr-73', '760-p1', '760-p4', '368-p1'] },
    { id: '760-p3', name: 'Lazkiye & Hama', sliceIdx: 2, neighbors: ['760-p1', '760-p4'] },
    { id: '760-p4', name: 'Humus & Deyrizor', sliceIdx: 3, neighbors: ['760-p2', '760-p3', '760-p5'] },
    { id: '760-p5', name: 'Şam & Güney', sliceIdx: 4, neighbors: ['760-p4'] },
  ],
};

// Aktif bölge tablosu — CANLI BAĞ: applyMapLayout ile değişir, importçular otomatik yeni tabloyu görür.
// 'gercek' düzeni şimdilik detaylı graf'ı kullanır (render katmanı gerçek poligonları ayrıca çizer).
export let NEIGHBOR_PROVINCES: Record<string, ProvinceInfo[]> = NEIGHBOR_PROVINCES_DETAYLI;

// Layout değiştiğinde graf yeniden kurulmalı — mapWar bu callback'i kaydeder.
let onLayoutChange: (() => void) | null = null;
export function registerLayoutChangeHook(fn: () => void): void {
  onLayoutChange = fn;
}

export function applyMapLayout(layout: MapLayout): void {
  NEIGHBOR_PROVINCES = layout === 'basit' ? NEIGHBOR_PROVINCES_BASIT : NEIGHBOR_PROVINCES_DETAYLI;
  onLayoutChange?.();
}

// TÜM 81 ilin komşuluk grafı — tek kaynak: frontline/trAdjacency.ts
// (tr-cities.json geometrisinden üretilir; kısa sınırları basitleştirmede
// kaybolan 6 gerçek komşuluk dahil). Yeniden üretmek için:
// node scripts/generate-tr-adjacency.mjs
export { TR_PROVINCE_NEIGHBORS as TURKEY_BORDER_NEIGHBORS } from './frontline/trAdjacency';
