// Oyun ayarları — girişte seçilir, localStorage'da saklanır.
// Şimdilik tek ayar: düşman ülkelerinin haritada kaç bölgeye ayrılacağı (Harita Düzeni).

export type MapLayout = 'basit' | 'detayli' | 'gercek';

export interface GameSettings {
  mapLayout: MapLayout;
}

export const DEFAULT_SETTINGS: GameSettings = {
  mapLayout: 'detayli',
};

export const MAP_LAYOUT_INFO: Record<MapLayout, { label: string; desc: string }> = {
  basit: {
    label: 'Basit',
    desc: 'Her ülke 2-3 geniş bölgeye ayrılır. Hızlı, sade cepheler.',
  },
  detayli: {
    label: 'Detaylı (Şehir Şehir)',
    desc: 'Her ülke 5-6 gerçek şehir adlı bölgeye ayrılır; daha derin, gerçekçi cepheler.',
  },
  gercek: {
    label: 'Gerçek Harita',
    desc: 'Ülkeler gerçek il sınırlarıyla (poligon) çizilir — en gerçekçi görünüm.',
  },
};

const SETTINGS_KEY = 'hegemon_settings';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const mapLayout: MapLayout =
      parsed?.mapLayout === 'basit' || parsed?.mapLayout === 'detayli' || parsed?.mapLayout === 'gercek'
        ? parsed.mapLayout
        : DEFAULT_SETTINGS.mapLayout;
    return { mapLayout };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // depolama erişilemez — ayar bu oturumda geçerli, kalıcı olmaz
  }
}
