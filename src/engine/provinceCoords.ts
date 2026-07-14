// 'gercek' harita düzeni için: detaylı bölgelerin yaklaşık [boylam, enlem] merkezleri.
// Bu noktalardan Voronoi bölgeleri üretilip ülkenin GERÇEK sınır poligonuna (SVG
// clipPath) kırpılır — böylece dikey dilim yerine gerçek il haritası görünümü çıkar.
// Bölge id'leri NEIGHBOR_PROVINCES_DETAYLI ile birebir aynıdır.

export const PROVINCE_COORDS: Record<string, [number, number]> = {
  // Yunanistan
  '300-p1': [25.9, 41.1],  // Batı Trakya
  '300-p2': [22.9, 40.6],  // Selanik
  '300-p3': [22.4, 39.6],  // Teselya
  '300-p4': [23.7, 38.0],  // Atina
  '300-p5': [22.4, 37.2],  // Mora

  // Bulgaristan
  '100-p1': [25.6, 41.6],  // Kırcaali & Hasköy
  '100-p2': [27.4, 42.5],  // Burgaz
  '100-p3': [24.7, 42.1],  // Filibe
  '100-p4': [23.3, 42.7],  // Sofya
  '100-p5': [27.2, 43.4],  // Varna & Ruse

  // Gürcistan
  '268-p1': [42.0, 41.6],  // Acara & Batum
  '268-p2': [43.0, 41.8],  // Samtshe & İmereti
  '268-p3': [44.8, 41.7],  // Tiflis
  '268-p4': [45.8, 41.6],  // Kaheti

  // Ermenistan
  '051-p1': [43.8, 41.0],  // Şirak & Lori
  '051-p2': [44.3, 40.3],  // Gümrü & Aragatsotn
  '051-p3': [44.5, 40.1],  // Erivan
  '051-p4': [46.0, 39.5],  // Syunik

  // Azerbaycan
  '031-p1': [45.4, 39.3],  // Nahçıvan
  '031-p2': [46.8, 39.8],  // Karabağ
  '031-p3': [46.4, 40.7],  // Gence
  '031-p4': [49.8, 40.4],  // Bakü
  '031-p5': [48.5, 41.2],  // Quba & Şirvan

  // İran
  '364-p1': [45.1, 37.5],  // Urmiye
  '364-p2': [46.3, 38.1],  // Tebriz & Erdebil
  '364-p3': [46.6, 34.9],  // Kermanşah & Kürdistan
  '364-p4': [51.4, 35.7],  // Tahran
  '364-p5': [51.7, 32.7],  // İsfahan
  '364-p6': [53.7, 29.6],  // Fars & Güney

  // Irak
  '368-p1': [42.4, 36.4],  // Musul & Duhok
  '368-p2': [44.5, 36.0],  // Erbil & Süleymaniye
  '368-p3': [44.4, 35.0],  // Kerkük
  '368-p4': [44.4, 33.3],  // Bağdat
  '368-p5': [47.1, 30.7],  // Basra & Güney

  // Suriye
  '760-p1': [37.2, 36.2],  // Halep & İdlib
  '760-p2': [40.0, 36.2],  // Rakka & Haseke
  '760-p3': [36.2, 35.0],  // Lazkiye & Hama
  '760-p4': [38.5, 34.7],  // Humus & Deyrizor
  '760-p5': [36.3, 33.3],  // Şam & Güney
};
