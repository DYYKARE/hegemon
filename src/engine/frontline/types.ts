// Harita Tabanlı Cephe (graph) savaş modeli — veri sözleşmesi.
// İller graph'ın NODE'ları, `neighbors` listesi EDGE'leri temsil eder.
// Tüm dünya tek normalize Record<string, Province> içinde yaşar (single source
// of truth); D3 bu veriyi sadece OKUR, motor (resolveTurn) sadece yenisini ÜRETİR.

export type UnitType = 'asker' | 'tank' | 'ucak';

export interface Army {
  asker: number;
  tank: number;
  ucak: number;
}

export type TerrainType = 'ova' | 'dag' | 'orman' | 'sehir' | 'kiyi';

export interface Province {
  id: string;            // 'tr-6', '300-p1' ...
  name: string;
  ownerId: string;       // 'player' veya ülke id ('300', '100' ...)
  neighbors: string[];   // EDGE listesi — çift yönlü tutulmalı (a↔b tutarlılığı veri üretiminde garanti edilir)
  terrain: TerrainType;
  army: Army;            // ilde konuşlu ordu (garnizon)
  defenses: {
    kara_savunma: number; // istihkam/tabya sayısı
    hava_savunma: number; // AA bataryası sayısı
  };
  population: number;
  baseIncome: number;    // tur başına baz gelir (side-effect hesabında kullanılır)
}

// Normalize il haritası — React state'te tutulan ana yapı.
export type ProvinceMap = Record<string, Province>;

// --- Emir kuyruğu ---
// Emirler verildiği anda state'i DEĞİŞTİRMEZ; TurnOrders içinde birikir ve
// tur sonunda resolveTurn tek seferde işler. Emre bağlanan birlikler
// "kilitli" sayılır: kaynaktaki savunmaya ancak kısıtlı katkı verirler
// (bkz. COMMITTED_DEFENSE_FACTOR).

export type OrderType = 'MOVE' | 'ATTACK';

export interface MilitaryOrder {
  id: string;          // UI'da iptal/duplicate kontrolü için
  type: OrderType;
  issuedBy: string;    // emri veren taraf (province.ownerId ile eşleşmeli)
  from: string;        // kaynak il id
  to: string;          // hedef il id — from'un komşusu olmak ZORUNDA (edge üstünde hareket)
  units: Army;         // ilden ayrılıp emre bağlanan birlikler
  // Amfibi çıkarma: deniz rotasıyla verilen emir. Motor için komşuluk, adaptörün
  // (buildWarGraph) eklediği SANAL deniz kenarıyla sağlanır; UI oku mavi çizer.
  sea?: boolean;
}

export interface TurnOrders {
  turn: number;
  orders: MilitaryOrder[];
}

// --- Tur çözümleme çıktısı ---

export type BattleOutcome =
  | 'decisive'   // R >= 1.5 — il düşer
  | 'attrition'  // 0.8 < R < 1.5 — il el değiştirmez, karşılıklı yıpranma
  | 'repelled'   // R <= 0.8 — taarruz kırılır
  | 'meeting';   // karşılaşma muharebesi: A→B ve B→A taarruzları SINIRDA çarpıştı

export interface BattleResult {
  provinceId: string;
  attackerId: string;
  defenderId: string;
  attackPower: number;   // Patk (arazi + hava desteği dahil)
  defensePower: number;  // Pdef
  ratio: number;         // R = Patk / Pdef
  outcome: BattleOutcome;
  attackerLosses: Army;
  defenderLosses: Army;
  retreatedTo?: string;  // decisive: savunmacı artığının çekildiği komşu il (yoksa imha)
}

// resolveTurn'ün tek dönüşü — React'e TEK batch update olarak uygulanır:
//   const result = resolveTurn(provinces, orders);
//   setProvinces(result.provinces);  // tek setState, tek render
export interface TurnResolutionResult {
  provinces: ProvinceMap;              // yeni normalize harita (input MUTATE EDİLMEZ)
  battles: BattleResult[];
  incomeByOwner: Record<string, number>; // taraf başına bu turun geliri
  rejectedOrders: MilitaryOrder[];     // geçersiz emirler (komşu değil, sahiplik yanlış...)
  events: string[];                    // UI bildirim satırları
}
