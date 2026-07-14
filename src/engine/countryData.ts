// Ülke meta verisi: Türkçe ad + nüfus (yaklaşık 2024) + oynanabilirlik.
// Askeri güç/gelir countries.ts'teki COUNTRY_STATS'tan gelir; burada nüfus ve ad tutulur.
// Tabloda olmayan ülkeler geojson adı + varsayılan nüfusla oynanabilir kalır.

import type { MapLayout } from './settings';

export interface CountryMeta {
  name: string;       // Türkçe ad
  population: number;  // toplam nüfus (bölgelere dağıtılır)
}

// ISO 3166-1 numeric (world-atlas feature.id) → meta
export const COUNTRY_META: Record<string, CountryMeta> = {
  '792': { name: 'Türkiye', population: 85_000_000 },
  '840': { name: 'ABD', population: 335_000_000 },
  '156': { name: 'Çin', population: 1_410_000_000 },
  '643': { name: 'Rusya', population: 144_000_000 },
  '356': { name: 'Hindistan', population: 1_430_000_000 },
  '276': { name: 'Almanya', population: 84_000_000 },
  '250': { name: 'Fransa', population: 68_000_000 },
  '826': { name: 'Birleşik Krallık', population: 67_000_000 },
  '380': { name: 'İtalya', population: 59_000_000 },
  '724': { name: 'İspanya', population: 48_000_000 },
  '616': { name: 'Polonya', population: 38_000_000 },
  '804': { name: 'Ukrayna', population: 38_000_000 },
  '392': { name: 'Japonya', population: 124_000_000 },
  '410': { name: 'Güney Kore', population: 52_000_000 },
  '408': { name: 'Kuzey Kore', population: 26_000_000 },
  '076': { name: 'Brezilya', population: 216_000_000 },
  '032': { name: 'Arjantin', population: 46_000_000 },
  '484': { name: 'Meksika', population: 129_000_000 },
  '124': { name: 'Kanada', population: 39_000_000 },
  '818': { name: 'Mısır', population: 111_000_000 },
  '710': { name: 'Güney Afrika', population: 60_000_000 },
  '566': { name: 'Nijerya', population: 223_000_000 },
  '682': { name: 'Suudi Arabistan', population: 37_000_000 },
  '364': { name: 'İran', population: 89_000_000 },
  '368': { name: 'Irak', population: 45_000_000 },
  '760': { name: 'Suriye', population: 22_000_000 },
  '300': { name: 'Yunanistan', population: 10_000_000 },
  '100': { name: 'Bulgaristan', population: 6_500_000 },
  '268': { name: 'Gürcistan', population: 3_700_000 },
  '051': { name: 'Ermenistan', population: 3_000_000 },
  '031': { name: 'Azerbaycan', population: 10_000_000 },
  '376': { name: 'İsrail', population: 9_700_000 },
  '586': { name: 'Pakistan', population: 240_000_000 },
  '004': { name: 'Afganistan', population: 42_000_000 },
  '860': { name: 'Özbekistan', population: 35_000_000 },
  '398': { name: 'Kazakistan', population: 20_000_000 },
  '036': { name: 'Avustralya', population: 26_000_000 },
  '360': { name: 'Endonezya', population: 278_000_000 },
  '704': { name: 'Vietnam', population: 99_000_000 },
  '764': { name: 'Tayland', population: 72_000_000 },
  '528': { name: 'Hollanda', population: 18_000_000 },
  '752': { name: 'İsveç', population: 10_600_000 },
  '578': { name: 'Norveç', population: 5_500_000 },
  '196': { name: 'Kıbrıs', population: 1_300_000 },
};

const DEFAULT_POPULATION = 8_000_000;

// Ülkelerin GERÇEK birinci düzey idari bölünme (il/eyalet/vilayet) sayısı.
// 'gercek' düzeni bu sayıyı, 'detayli' bunun ¼'ünü, 'basit' detaylının ⅓'ünü kullanır.
// Türkiye 81 → detaylı 20 → basit 7 (kullanıcı örneğiyle birebir).
export const ADMIN1_COUNT: Record<string, number> = {
  '792': 81,  // Türkiye — il
  '840': 50,  // ABD — eyalet
  '156': 33,  // Çin — il/özerk bölge/belediye
  '643': 83,  // Rusya — federal subje
  '356': 36,  // Hindistan — eyalet + birlik toprağı
  '276': 16,  // Almanya — eyalet (Land)
  '250': 18,  // Fransa — bölge
  '826': 12,  // Birleşik Krallık — ITL1 bölge
  '380': 20,  // İtalya — bölge
  '724': 17,  // İspanya — özerk topluluk
  '616': 16,  // Polonya — voyvodalık
  '804': 27,  // Ukrayna — oblast + özel
  '392': 47,  // Japonya — vilayet
  '410': 17,  // Güney Kore
  '408': 9,   // Kuzey Kore
  '076': 27,  // Brezilya — eyalet + DF
  '032': 24,  // Arjantin — il
  '484': 32,  // Meksika — eyalet
  '124': 13,  // Kanada — il + bölge
  '818': 27,  // Mısır — vilayet
  '710': 9,   // Güney Afrika — il
  '566': 37,  // Nijerya — eyalet + FCT
  '682': 13,  // Suudi Arabistan — bölge
  '364': 31,  // İran — ostan
  '368': 19,  // Irak — vilayet
  '760': 14,  // Suriye — vilayet
  '300': 13,  // Yunanistan — bölge
  '100': 28,  // Bulgaristan — il
  '268': 12,  // Gürcistan
  '051': 11,  // Ermenistan — il
  '031': 14,  // Azerbaycan — ekonomik bölge
  '376': 6,   // İsrail — bölge
  '586': 7,   // Pakistan — il + toprak
  '004': 34,  // Afganistan — vilayet
  '860': 14,  // Özbekistan
  '398': 20,  // Kazakistan
  '036': 8,   // Avustralya — eyalet + toprak
  '360': 38,  // Endonezya — il
  '704': 63,  // Vietnam — il
  '764': 77,  // Tayland — il
  '528': 12,  // Hollanda — il
  '752': 21,  // İsveç — län
  '578': 15,  // Norveç — fylke
  '196': 6,   // Kıbrıs — ilçe
};

// Tabloda olmayan ülkeler için dünya kurulurken geojson'dan kaydedilen adlar
// (ör. Çekya, İsviçre) — UI "203 Sınırına Savunma Kur" gibi ham id göstermesin.
// Geojson adları İNGİLİZCE gelir ("Austria", "Czechia"); bilinen adlar kayıt
// anında Türkçeleştirilir, tabloda olmayan egzotikler İngilizce kalır.
const EN_TO_TR: Record<string, string> = {
  'Austria': 'Avusturya', 'Czechia': 'Çekya', 'Switzerland': 'İsviçre',
  'Liechtenstein': 'Lihtenştayn', 'Luxembourg': 'Lüksemburg', 'Belgium': 'Belçika',
  'Denmark': 'Danimarka', 'Norway': 'Norveç', 'Sweden': 'İsveç', 'Finland': 'Finlandiya',
  'Iceland': 'İzlanda', 'Ireland': 'İrlanda', 'Portugal': 'Portekiz', 'Hungary': 'Macaristan',
  'Romania': 'Romanya', 'Serbia': 'Sırbistan', 'Croatia': 'Hırvatistan', 'Slovenia': 'Slovenya',
  'Slovakia': 'Slovakya', 'Albania': 'Arnavutluk', 'North Macedonia': 'Kuzey Makedonya',
  'Macedonia': 'Makedonya', 'Bosnia and Herz.': 'Bosna-Hersek', 'Bosnia and Herzegovina': 'Bosna-Hersek',
  'Montenegro': 'Karadağ', 'Kosovo': 'Kosova', 'Moldova': 'Moldova', 'Belarus': 'Belarus',
  'Lithuania': 'Litvanya', 'Latvia': 'Letonya', 'Estonia': 'Estonya', 'Poland': 'Polonya',
  'Netherlands': 'Hollanda', 'Andorra': 'Andorra', 'Malta': 'Malta', 'Monaco': 'Monako',
  'Canada': 'Kanada', 'Mexico': 'Meksika', 'Cuba': 'Küba', 'Haiti': 'Haiti',
  'Dominican Rep.': 'Dominik Cum.', 'Guatemala': 'Guatemala', 'Honduras': 'Honduras',
  'Nicaragua': 'Nikaragua', 'Costa Rica': 'Kosta Rika', 'Panama': 'Panama', 'Belize': 'Belize',
  'El Salvador': 'El Salvador', 'Jamaica': 'Jamaika', 'Colombia': 'Kolombiya',
  'Venezuela': 'Venezuela', 'Ecuador': 'Ekvador', 'Peru': 'Peru', 'Bolivia': 'Bolivya',
  'Chile': 'Şili', 'Argentina': 'Arjantin', 'Uruguay': 'Uruguay', 'Paraguay': 'Paraguay',
  'Guyana': 'Guyana', 'Suriname': 'Surinam', 'Morocco': 'Fas', 'Algeria': 'Cezayir',
  'Tunisia': 'Tunus', 'Libya': 'Libya', 'Sudan': 'Sudan', 'S. Sudan': 'Güney Sudan',
  'Ethiopia': 'Etiyopya', 'Eritrea': 'Eritre', 'Djibouti': 'Cibuti', 'Somalia': 'Somali',
  'Somaliland': 'Somaliland', 'Kenya': 'Kenya', 'Tanzania': 'Tanzanya', 'Uganda': 'Uganda',
  'Rwanda': 'Ruanda', 'Burundi': 'Burundi', 'Dem. Rep. Congo': 'Kongo DC', 'Congo': 'Kongo',
  'Gabon': 'Gabon', 'Eq. Guinea': 'Ekvator Ginesi', 'Cameroon': 'Kamerun', 'Nigeria': 'Nijerya',
  'Niger': 'Nijer', 'Chad': 'Çad', 'Mali': 'Mali', 'Mauritania': 'Moritanya',
  'Senegal': 'Senegal', 'Gambia': 'Gambiya', 'Guinea-Bissau': 'Gine-Bissau', 'Guinea': 'Gine',
  'Sierra Leone': 'Sierra Leone', 'Liberia': 'Liberya', "Côte d'Ivoire": 'Fildişi Sahili',
  'Ghana': 'Gana', 'Togo': 'Togo', 'Benin': 'Benin', 'Burkina Faso': 'Burkina Faso',
  'Central African Rep.': 'Orta Afrika Cum.', 'Angola': 'Angola', 'Zambia': 'Zambiya',
  'Zimbabwe': 'Zimbabve', 'Mozambique': 'Mozambik', 'Malawi': 'Malavi',
  'Madagascar': 'Madagaskar', 'Namibia': 'Namibya', 'Botswana': 'Botsvana',
  'South Africa': 'Güney Afrika', 'Lesotho': 'Lesoto', 'eSwatini': 'Esvatini',
  'Jordan': 'Ürdün', 'Lebanon': 'Lübnan', 'Kuwait': 'Kuveyt', 'Qatar': 'Katar',
  'United Arab Emirates': 'BAE', 'Bahrain': 'Bahreyn', 'Oman': 'Umman', 'Yemen': 'Yemen',
  'Afghanistan': 'Afganistan', 'Turkmenistan': 'Türkmenistan', 'Uzbekistan': 'Özbekistan',
  'Tajikistan': 'Tacikistan', 'Kyrgyzstan': 'Kırgızistan', 'Kazakhstan': 'Kazakistan',
  'Mongolia': 'Moğolistan', 'Nepal': 'Nepal', 'Bhutan': 'Butan', 'Bangladesh': 'Bangladeş',
  'Myanmar': 'Myanmar', 'Thailand': 'Tayland', 'Laos': 'Laos', 'Vietnam': 'Vietnam',
  'Cambodia': 'Kamboçya', 'Malaysia': 'Malezya', 'Singapore': 'Singapur',
  'Philippines': 'Filipinler', 'Papua New Guinea': 'Papua Yeni Gine', 'New Zealand': 'Yeni Zelanda',
  'Sri Lanka': 'Sri Lanka', 'Taiwan': 'Tayvan', 'North Korea': 'Kuzey Kore',
  'Georgia': 'Gürcistan', 'Armenia': 'Ermenistan', 'Azerbaijan': 'Azerbaycan',
  'Cyprus': 'Kıbrıs', 'N. Cyprus': 'Kuzey Kıbrıs', 'Greenland': 'Grönland',
  'Fiji': 'Fiji', 'Solomon Is.': 'Solomon Adaları', 'Vanuatu': 'Vanuatu',
  'Timor-Leste': 'Doğu Timor', 'Brunei': 'Brunei', 'Palestine': 'Filistin',
  'W. Sahara': 'Batı Sahra', 'Trinidad and Tobago': 'Trinidad ve Tobago',
  'Bahamas': 'Bahamalar', 'Falkland Is.': 'Falkland Adaları', 'Fr. S. Antarctic Lands': 'Fransız Güney Toprakları',
  'New Caledonia': 'Yeni Kaledonya', 'Puerto Rico': 'Porto Riko',
};
const RUNTIME_NAMES: Record<string, string> = {};
export function registerCountryName(cid: string, name?: string): void {
  if (name && !COUNTRY_META[cid]) RUNTIME_NAMES[cid] = EN_TO_TR[name] ?? name;
}

export function countryName(cid: string, fallback?: string): string {
  return COUNTRY_META[cid]?.name ?? RUNTIME_NAMES[cid] ?? fallback ?? cid;
}

export function countryPopulation(cid: string): number {
  return COUNTRY_META[cid]?.population ?? DEFAULT_POPULATION;
}

// Ülkenin gerçek il/eyalet sayısı; tabloda yoksa alandan (steradyan) tahmin edilir.
export function realAdmin1Count(cid: string, area: number): number {
  const real = ADMIN1_COUNT[cid];
  if (real != null) return real;
  return Math.max(4, Math.min(30, Math.round(8 * Math.sqrt(area / 0.02))));
}

// Harita düzenine göre bölge sayısı:
//   gercek = gerçek il sayısı · detayli = gerçeğin ¼'ü · basit = detaylının ⅓'ü
// (Türkiye 81 → 20 → 7). Alt sınırlar oynanabilirlik için: gercek≥3, detayli≥3, basit≥2.
export function layoutRegionCount(cid: string, area: number, layout: MapLayout): number {
  const real = realAdmin1Count(cid, area);
  const detayli = Math.max(3, Math.round(real / 4));
  if (layout === 'gercek') return Math.max(3, real);
  if (layout === 'detayli') return detayli;
  return Math.max(2, Math.round(detayli / 3));
}

// Yeni oyunda başlangıç için önerilen ülkeler (id listesi; sıralı gösterilir).
// Diğer tüm ülkeler de seçilebilir ama liste öne çıkanları verir.
export const FEATURED_COUNTRIES: string[] = [
  '792', '840', '156', '643', '276', '250', '826', '392', '356', '076',
  '364', '368', '818', '682', '586', '804', '380', '724', '410', '360',
];
