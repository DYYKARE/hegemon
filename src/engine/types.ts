import type { MilitaryOrder } from './frontline/types';
import type { MapLayout } from './settings';

export type Difficulty = 'kolay' | 'orta' | 'zor';

export interface EnemyProvince {
  id: string;
  name: string;
  strength: number;
  maxStrength: number;
  isConquered: boolean;
}

// Cepheye gönderilmiş ordu: birlikler illerden AYRILIR ve bu havuzda savaşır.
// Zayiat doğrudan buradan düşer; savaş bitince sağ kalanlar sınır iline döner.
export interface FrontForce {
  asker: number;
  tank: number;
  ucak: number;
}

export interface War {
  countryId: string;
  countryName: string;
  enemyStrength: number; // kalan direnç (oyuncu savaşı) / istila kuvveti (AI savaşı)
  enemyMaxStrength: number;
  startedTurn: number;
  lastPlayerLoss: number; // son turda kaybedilen güç puanı (rapor için)
  lastEnemyLoss: number;
  initiator: 'player' | 'ai'; // savaşı kim açtı
  // 'harita': graph tabanlı cephe savaşı (kara komşuları) — muharebeler emir
  // kuyruğu + resolveTurn ile il il çözülür. 'topyekun' yalnız deniz aşırı.
  // 'il_il' eski sistemden kalan tip; yüklemede 'harita'ya migrate edilir.
  warType?: 'topyekun' | 'il_il' | 'harita';
  provinces?: EnemyProvince[];
  activeProvinceId?: string; // şu an çatışmanın sürdüğü rakip il id
  front?: FrontForce; // cephe ordusu (yalnız oyuncunun açtığı savaşlarda)
}

export interface BattleReport {
  countryName: string;
  countryId: string;
  turn: number;
  playerArmyBefore: number;
  playerArmyAfter: number;
  playerLoss: number;
  enemyArmyBefore: number;
  enemyArmyAfter: number;
  enemyLoss: number;
  planesLost: number;
  // 'meeting': karşılıklı taarruzlar sınırda çarpıştı (karşılaşma muharebesi)
  result: 'ongoing' | 'conquest' | 'repelled' | 'peace' | 'occupation' | 'attrition' | 'attack_failed' | 'meeting';
  initiator: 'player' | 'ai';
}

export interface AiCountryEconomy {
  population: number;
  investment: number;
  income: number;
}

// AI ülkeler arası savaş: iki taraf da her tur yıpranır, ekonomileri yavaşlar.
// Oyuncu için fırsat penceresi — zayıflayan komşuya saldırmanın tam zamanı.
export interface AiWar {
  attackerId: string;
  defenderId: string;
  startedTurn: number;
}

export interface GameSave {
  version: 1;
  difficulty: Difficulty;
  turn: number;
  money: number;
  // Oyuncunun ülkesi (ISO numeric id). Generic dünya modelinde herhangi bir ülke
  // olabilir; eski kayıtlarda yoksa Türkiye ('792') varsayılır.
  playerCountryId: string;
  provinceUnits: Record<string, Record<string, number>>;
  provinceInvestments: Record<string, Record<string, number>>;
  conqueredCountryIds: string[];
  wars: War[];
  aiMilitary: Record<string, number>; // komşu ülkelerin güncel ordu gücü
  occupiedProvinces: Record<string, string>; // il id → işgalci ülke id
  occupiedGarrisons: Record<string, number>; // il id → işgalci ordu gücü (garrison)
  truces: Record<string, number>; // ülke id → ateşkesin bittiği tur
  taxRate: number;       // 0.0 - 1.0 arası vergi oranı
  happiness: number;     // 0 - 100 arası mutluluk
  aiEconomy: Record<string, AiCountryEconomy>; // AI ülkelerin ekonomileri
  // Fetih anında devralınan ekonomiler: ülke id → o anki (büyümüş) ekonomi.
  // Tarım/sanayi yıkılmaz; ülkenin canlı geliri her tur oyuncuya akar.
  conqueredEconomies: Record<string, AiCountryEconomy>;
  // Fethedilen ülke adları (harita seçiminden gelir; UI listelerinde kullanılır)
  conqueredNames: Record<string, string>;
  aiWars: AiWar[]; // AI ülkeler arası aktif savaşlar

  // --- Diplomasi ---
  // İkili ilişki: ülke id → −100 (düşman) .. +100 (müttefik). Her tur duruma
  // bağlı bir TABANA sürüklenir (fetihlerin tehdit algısı tabanı düşürür);
  // diplomatik eylemler anlık sıçratır. AI'nin savaş açma şansını çarpar.
  relations: Record<string, number>;
  pacts: Record<string, number>;   // ülke id → saldırmazlık paktının bittiği tur
  allies: string[];                // ittifak kurulan ülkeler (AI saldırmaz + savaşta destek)
  tradeDeals: string[];            // ticaret anlaşmaları (her tur gelir + ilişki tabanı bonusu)

  // --- Harita tabanlı cephe savaşı (graph) durumu ---
  // Düşman eyaletlerinin garnizon gücü (güç puanı; asker eşdeğeri).
  // Savaş ilanında ülkenin ordusu eyaletlerine bölünür; anavatan payı aiMilitary'de kalır.
  enemyProvinceStrength: Record<string, number>;
  // Oyuncunun ele geçirdiği düşman eyaletleri (il id listesi).
  // Tamamı ele geçirilince ülke fethedilir; barışta iade edilir.
  capturedEnemyProvinces: string[];
  // Tur içinde verilen emirler: state'i hemen değiştirmez, tur sonunda
  // resolveTurn tek seferde işler. Kayıtla birlikte saklanır.
  pendingOrders: MilitaryOrder[];
  // Bu kaydın harita düzeni: bölge id'leri (ör. 051-p4) düzene bağlı olduğundan
  // kayıt kendi düzenini hatırlar; yüklenince applyMapLayout ile geri yüklenir.
  mapLayout: MapLayout;
}

export interface TurnEvent {
  type: 'conquest' | 'battle' | 'invasion' | 'occupation' | 'liberation' | 'peace';
  message: string;
}
