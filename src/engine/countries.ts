import { Difficulty } from './types';

export interface CountryStats {
  military: number; // savunma/ordu gücü (güç puanı)
  income: number;   // fethedilince tur başına eklenen gelir ($)
}

export interface DifficultySettings {
  power: number;         // AI askeri güç çarpanı
  income: number;        // AI ekonomik güç çarpanı (gelir, ganimet, yağma)
  aggression: number;    // AI savaş açma şansı çarpanı
  invasionShare: number; // istilaya ordusunun ne kadarını gönderir
  graceTurns: number;    // oyun başında saldırı olmayan tur sayısı
}

export const DIFFICULTY_SETTINGS: Record<Difficulty, DifficultySettings> = {
  kolay: { power: 0.5, income: 0.5, aggression: 0.5, invasionShare: 0.25, graceTurns: 12 },
  orta:  { power: 1.0, income: 1.0, aggression: 1.0, invasionShare: 0.40, graceTurns: 8 },
  zor:   { power: 2.0, income: 2.0, aggression: 2.0, invasionShare: 0.60, graceTurns: 5 },
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  kolay: 'Kolay', orta: 'Orta', zor: 'Zor',
};

// ISO 3166-1 numeric (world-atlas feature.id) → ülke gücü (orta zorluk = gerçek dünya oranları).
// Güç puanı ölçeği: 1 asker = 1 puan.
const COUNTRY_STATS: Record<string, CountryStats> = {
  '840': { military: 2_500_000, income: 800_000_000 }, // ABD
  '156': { military: 2_200_000, income: 600_000_000 }, // Çin
  '643': { military: 1_500_000, income: 300_000_000 }, // Rusya
  '356': { military: 1_200_000, income: 250_000_000 }, // Hindistan
  // K.Kore: sayıca ~1.2M asker ama teçhizat kalitesi düşük → etkin güç 550K.
  // (800K iken tek kara komşusu K.Kore olan G.Kore orta/zor'da fiilen zafersizdi.)
  '408': { military: 550_000, income: 10_000_000 },    // Kuzey Kore
  '586': { military: 700_000, income: 80_000_000 },    // Pakistan
  '364': { military: 600_000, income: 100_000_000 },   // İran
  '410': { military: 600_000, income: 250_000_000 },   // Güney Kore
  '804': { military: 500_000, income: 40_000_000 },    // Ukrayna
  '250': { military: 450_000, income: 250_000_000 },   // Fransa
  '818': { military: 450_000, income: 90_000_000 },    // Mısır
  '826': { military: 400_000, income: 250_000_000 },   // Birleşik Krallık
  '392': { military: 400_000, income: 350_000_000 },   // Japonya
  '076': { military: 400_000, income: 180_000_000 },   // Brezilya
  '276': { military: 350_000, income: 300_000_000 },   // Almanya
  '376': { military: 350_000, income: 120_000_000 },   // İsrail
  '380': { military: 300_000, income: 220_000_000 },   // İtalya
  '682': { military: 300_000, income: 200_000_000 },   // Suudi Arabistan
  '724': { military: 250_000, income: 180_000_000 },   // İspanya
  '616': { military: 250_000, income: 120_000_000 },   // Polonya
  '368': { military: 200_000, income: 60_000_000 },    // Irak
  '300': { military: 150_000, income: 60_000_000 },    // Yunanistan
  '760': { military: 120_000, income: 15_000_000 },    // Suriye
  '031': { military: 120_000, income: 30_000_000 },    // Azerbaycan
  '528': { military: 100_000, income: 150_000_000 },   // Hollanda
  '100': { military: 60_000, income: 25_000_000 },     // Bulgaristan
  '051': { military: 50_000, income: 8_000_000 },      // Ermenistan
  '268': { military: 40_000, income: 10_000_000 },     // Gürcistan
  '196': { military: 15_000, income: 12_000_000 },     // Kıbrıs
};

const DEFAULT_STATS: CountryStats = { military: 30_000, income: 8_000_000 };

export const PLAYER_COUNTRY_ID = '792'; // Türkiye

export function getCountryStats(countryId: string, difficulty: Difficulty = 'orta'): CountryStats {
  const base = COUNTRY_STATS[countryId] ?? DEFAULT_STATS;
  const mult = DIFFICULTY_SETTINGS[difficulty];
  return {
    military: Math.round(base.military * mult.power),
    income: Math.round(base.income * mult.income),
  };
}
