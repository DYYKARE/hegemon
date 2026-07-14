// OTOMATİK ÜRETİLDİ — elle düzenlemeyin.
// Kaynak: public/data/tr-cities.json · Üretici: scripts/generate-tr-adjacency.mjs
// Yeniden üretmek için: node scripts/generate-tr-adjacency.mjs
//
// 81 TR ilinin komşuluk grafı (graph EDGE listesi). Simetrik ve tek bağlı
// bileşen olduğu üretim sırasında doğrulanır. Kısa sınırları basitleştirilmiş
// geometride kaybolan 6 gerçek komşuluk üreticideki MANUAL_EDGES ile eklidir.

export const TR_PROVINCE_NEIGHBORS: Record<string, string[]> = {
  'tr-1': ['tr-31', 'tr-33', 'tr-38', 'tr-46', 'tr-51', 'tr-80'], // Adana: Hatay, Mersin, Kayseri, Kahramanmaraş, Niğde, Osmaniye
  'tr-2': ['tr-21', 'tr-27', 'tr-44', 'tr-46', 'tr-63'], // Adıyaman: Diyarbakır, Gaziantep, Malatya, Kahramanmaraş, Şanlıurfa
  'tr-3': ['tr-15', 'tr-20', 'tr-26', 'tr-32', 'tr-42', 'tr-43', 'tr-64'], // Afyon: Burdur, Denizli, Eskişehir, Isparta, Konya, Kütahya, Uşak
  'tr-4': ['tr-13', 'tr-25', 'tr-36', 'tr-49', 'tr-65', 'tr-76'], // Ağrı: Bitlis, Erzurum, Kars, Muş, Van, Iğdır
  'tr-5': ['tr-19', 'tr-55', 'tr-60', 'tr-66'], // Amasya: Çorum, Samsun, Tokat, Yozgat
  'tr-6': ['tr-14', 'tr-18', 'tr-26', 'tr-40', 'tr-42', 'tr-68', 'tr-71'], // Ankara: Bolu, Çankırı, Eskişehir, Kırşehir, Konya, Aksaray, Kırıkkale
  'tr-7': ['tr-15', 'tr-32', 'tr-33', 'tr-42', 'tr-48', 'tr-70'], // Antalya: Burdur, Isparta, Mersin, Konya, Muğla, Karaman
  'tr-8': ['tr-25', 'tr-53', 'tr-75'], // Artvin: Erzurum, Rize, Ardahan
  'tr-9': ['tr-20', 'tr-35', 'tr-45', 'tr-48'], // Aydın: Denizli, İzmir, Manisa, Muğla
  'tr-10': ['tr-16', 'tr-17', 'tr-35', 'tr-43', 'tr-45'], // Balıkesir: Bursa, Çanakkale, İzmir, Kütahya, Manisa
  'tr-11': ['tr-14', 'tr-16', 'tr-26', 'tr-43', 'tr-54'], // Bilecik: Bolu, Bursa, Eskişehir, Kütahya, Sakarya
  'tr-12': ['tr-21', 'tr-23', 'tr-24', 'tr-25', 'tr-49', 'tr-62'], // Bingöl: Diyarbakır, Elazığ, Erzincan, Erzurum, Muş, Tunceli
  'tr-13': ['tr-4', 'tr-49', 'tr-56', 'tr-65', 'tr-72'], // Bitlis: Ağrı, Muş, Siirt, Van, Batman
  'tr-14': ['tr-6', 'tr-11', 'tr-18', 'tr-26', 'tr-54', 'tr-78', 'tr-81'], // Bolu: Ankara, Bilecik, Çankırı, Eskişehir, Sakarya, Karabük, Düzce
  'tr-15': ['tr-3', 'tr-7', 'tr-20', 'tr-32', 'tr-48'], // Burdur: Afyon, Antalya, Denizli, Isparta, Muğla
  'tr-16': ['tr-10', 'tr-11', 'tr-41', 'tr-43', 'tr-54', 'tr-77'], // Bursa: Balıkesir, Bilecik, Kocaeli, Kütahya, Sakarya, Yalova
  'tr-17': ['tr-10', 'tr-22', 'tr-59'], // Çanakkale: Balıkesir, Edirne, Tekirdağ
  'tr-18': ['tr-6', 'tr-14', 'tr-19', 'tr-37', 'tr-71', 'tr-78'], // Çankırı: Ankara, Bolu, Çorum, Kastamonu, Kırıkkale, Karabük
  'tr-19': ['tr-5', 'tr-18', 'tr-37', 'tr-55', 'tr-57', 'tr-66', 'tr-71'], // Çorum: Amasya, Çankırı, Kastamonu, Samsun, Sinop, Yozgat, Kırıkkale
  'tr-20': ['tr-3', 'tr-9', 'tr-15', 'tr-45', 'tr-48', 'tr-64'], // Denizli: Afyon, Aydın, Burdur, Manisa, Muğla, Uşak
  'tr-21': ['tr-2', 'tr-12', 'tr-23', 'tr-44', 'tr-47', 'tr-49', 'tr-63', 'tr-72'], // Diyarbakır: Adıyaman, Bingöl, Elazığ, Malatya, Mardin, Muş, Şanlıurfa, Batman
  'tr-22': ['tr-17', 'tr-39', 'tr-59'], // Edirne: Çanakkale, Kırklareli, Tekirdağ
  'tr-23': ['tr-12', 'tr-21', 'tr-24', 'tr-44', 'tr-62'], // Elazığ: Bingöl, Diyarbakır, Erzincan, Malatya, Tunceli
  'tr-24': ['tr-12', 'tr-23', 'tr-25', 'tr-28', 'tr-29', 'tr-44', 'tr-58', 'tr-62', 'tr-69'], // Erzincan: Bingöl, Elazığ, Erzurum, Giresun, Gümüşhane, Malatya, Sivas, Tunceli, Bayburt
  'tr-25': ['tr-4', 'tr-8', 'tr-12', 'tr-24', 'tr-36', 'tr-49', 'tr-53', 'tr-69', 'tr-75'], // Erzurum: Ağrı, Artvin, Bingöl, Erzincan, Kars, Muş, Rize, Bayburt, Ardahan
  'tr-26': ['tr-3', 'tr-6', 'tr-11', 'tr-14', 'tr-42', 'tr-43'], // Eskişehir: Afyon, Ankara, Bilecik, Bolu, Konya, Kütahya
  'tr-27': ['tr-2', 'tr-31', 'tr-46', 'tr-63', 'tr-79', 'tr-80'], // Gaziantep: Adıyaman, Hatay, Kahramanmaraş, Şanlıurfa, Kilis, Osmaniye
  'tr-28': ['tr-24', 'tr-29', 'tr-52', 'tr-58', 'tr-61'], // Giresun: Erzincan, Gümüşhane, Ordu, Sivas, Trabzon
  'tr-29': ['tr-24', 'tr-28', 'tr-61', 'tr-69'], // Gümüşhane: Erzincan, Giresun, Trabzon, Bayburt
  'tr-30': ['tr-65', 'tr-73'], // Hakkari: Van, Şırnak
  'tr-31': ['tr-1', 'tr-27', 'tr-80'], // Hatay: Adana, Gaziantep, Osmaniye
  'tr-32': ['tr-3', 'tr-7', 'tr-15', 'tr-42'], // Isparta: Afyon, Antalya, Burdur, Konya
  'tr-33': ['tr-1', 'tr-7', 'tr-42', 'tr-51', 'tr-70'], // Mersin: Adana, Antalya, Konya, Niğde, Karaman
  'tr-34': ['tr-41', 'tr-59'], // İstanbul: Kocaeli, Tekirdağ
  'tr-35': ['tr-9', 'tr-10', 'tr-45'], // İzmir: Aydın, Balıkesir, Manisa
  'tr-36': ['tr-4', 'tr-25', 'tr-75', 'tr-76'], // Kars: Ağrı, Erzurum, Ardahan, Iğdır
  'tr-37': ['tr-18', 'tr-19', 'tr-57', 'tr-74', 'tr-78'], // Kastamonu: Çankırı, Çorum, Sinop, Bartın, Karabük
  'tr-38': ['tr-1', 'tr-46', 'tr-50', 'tr-51', 'tr-58', 'tr-66'], // Kayseri: Adana, Kahramanmaraş, Nevşehir, Niğde, Sivas, Yozgat
  'tr-39': ['tr-22', 'tr-59'], // Kırklareli: Edirne, Tekirdağ
  'tr-40': ['tr-6', 'tr-50', 'tr-66', 'tr-68', 'tr-71'], // Kırşehir: Ankara, Nevşehir, Yozgat, Aksaray, Kırıkkale
  'tr-41': ['tr-16', 'tr-34', 'tr-54', 'tr-77'], // Kocaeli: Bursa, İstanbul, Sakarya, Yalova
  'tr-42': ['tr-3', 'tr-6', 'tr-7', 'tr-26', 'tr-32', 'tr-33', 'tr-51', 'tr-68', 'tr-70'], // Konya: Afyon, Ankara, Antalya, Eskişehir, Isparta, Mersin, Niğde, Aksaray, Karaman
  'tr-43': ['tr-3', 'tr-10', 'tr-11', 'tr-16', 'tr-26', 'tr-45', 'tr-64'], // Kütahya: Afyon, Balıkesir, Bilecik, Bursa, Eskişehir, Manisa, Uşak
  'tr-44': ['tr-2', 'tr-21', 'tr-23', 'tr-24', 'tr-46', 'tr-58'], // Malatya: Adıyaman, Diyarbakır, Elazığ, Erzincan, Kahramanmaraş, Sivas
  'tr-45': ['tr-9', 'tr-10', 'tr-20', 'tr-35', 'tr-43', 'tr-64'], // Manisa: Aydın, Balıkesir, Denizli, İzmir, Kütahya, Uşak
  'tr-46': ['tr-1', 'tr-2', 'tr-27', 'tr-38', 'tr-44', 'tr-58', 'tr-80'], // Kahramanmaraş: Adana, Adıyaman, Gaziantep, Kayseri, Malatya, Sivas, Osmaniye
  'tr-47': ['tr-21', 'tr-63', 'tr-72', 'tr-73'], // Mardin: Diyarbakır, Şanlıurfa, Batman, Şırnak
  'tr-48': ['tr-7', 'tr-9', 'tr-15', 'tr-20'], // Muğla: Antalya, Aydın, Burdur, Denizli
  'tr-49': ['tr-4', 'tr-12', 'tr-13', 'tr-21', 'tr-25', 'tr-72'], // Muş: Ağrı, Bingöl, Bitlis, Diyarbakır, Erzurum, Batman
  'tr-50': ['tr-38', 'tr-40', 'tr-51', 'tr-66', 'tr-68'], // Nevşehir: Kayseri, Kırşehir, Niğde, Yozgat, Aksaray
  'tr-51': ['tr-1', 'tr-33', 'tr-38', 'tr-42', 'tr-50', 'tr-68'], // Niğde: Adana, Mersin, Kayseri, Konya, Nevşehir, Aksaray
  'tr-52': ['tr-28', 'tr-55', 'tr-58', 'tr-60'], // Ordu: Giresun, Samsun, Sivas, Tokat
  'tr-53': ['tr-8', 'tr-25', 'tr-61', 'tr-69'], // Rize: Artvin, Erzurum, Trabzon, Bayburt
  'tr-54': ['tr-11', 'tr-14', 'tr-16', 'tr-41', 'tr-81'], // Sakarya: Bilecik, Bolu, Bursa, Kocaeli, Düzce
  'tr-55': ['tr-5', 'tr-19', 'tr-52', 'tr-57', 'tr-60'], // Samsun: Amasya, Çorum, Ordu, Sinop, Tokat
  'tr-56': ['tr-13', 'tr-65', 'tr-72', 'tr-73'], // Siirt: Bitlis, Van, Batman, Şırnak
  'tr-57': ['tr-19', 'tr-37', 'tr-55'], // Sinop: Çorum, Kastamonu, Samsun
  'tr-58': ['tr-24', 'tr-28', 'tr-38', 'tr-44', 'tr-46', 'tr-52', 'tr-60', 'tr-66'], // Sivas: Erzincan, Giresun, Kayseri, Malatya, Kahramanmaraş, Ordu, Tokat, Yozgat
  'tr-59': ['tr-17', 'tr-22', 'tr-34', 'tr-39'], // Tekirdağ: Çanakkale, Edirne, İstanbul, Kırklareli
  'tr-60': ['tr-5', 'tr-52', 'tr-55', 'tr-58', 'tr-66'], // Tokat: Amasya, Ordu, Samsun, Sivas, Yozgat
  'tr-61': ['tr-28', 'tr-29', 'tr-53', 'tr-69'], // Trabzon: Giresun, Gümüşhane, Rize, Bayburt
  'tr-62': ['tr-12', 'tr-23', 'tr-24'], // Tunceli: Bingöl, Elazığ, Erzincan
  'tr-63': ['tr-2', 'tr-21', 'tr-27', 'tr-47'], // Şanlıurfa: Adıyaman, Diyarbakır, Gaziantep, Mardin
  'tr-64': ['tr-3', 'tr-20', 'tr-43', 'tr-45'], // Uşak: Afyon, Denizli, Kütahya, Manisa
  'tr-65': ['tr-4', 'tr-13', 'tr-30', 'tr-56', 'tr-73'], // Van: Ağrı, Bitlis, Hakkari, Siirt, Şırnak
  'tr-66': ['tr-5', 'tr-19', 'tr-38', 'tr-40', 'tr-50', 'tr-58', 'tr-60', 'tr-71'], // Yozgat: Amasya, Çorum, Kayseri, Kırşehir, Nevşehir, Sivas, Tokat, Kırıkkale
  'tr-67': ['tr-74', 'tr-78', 'tr-81'], // Zonguldak: Bartın, Karabük, Düzce
  'tr-68': ['tr-6', 'tr-40', 'tr-42', 'tr-50', 'tr-51'], // Aksaray: Ankara, Kırşehir, Konya, Nevşehir, Niğde
  'tr-69': ['tr-24', 'tr-25', 'tr-29', 'tr-53', 'tr-61'], // Bayburt: Erzincan, Erzurum, Gümüşhane, Rize, Trabzon
  'tr-70': ['tr-7', 'tr-33', 'tr-42'], // Karaman: Antalya, Mersin, Konya
  'tr-71': ['tr-6', 'tr-18', 'tr-19', 'tr-40', 'tr-66'], // Kırıkkale: Ankara, Çankırı, Çorum, Kırşehir, Yozgat
  'tr-72': ['tr-13', 'tr-21', 'tr-47', 'tr-49', 'tr-56'], // Batman: Bitlis, Diyarbakır, Mardin, Muş, Siirt
  'tr-73': ['tr-30', 'tr-47', 'tr-56', 'tr-65'], // Şırnak: Hakkari, Mardin, Siirt, Van
  'tr-74': ['tr-37', 'tr-67', 'tr-78'], // Bartın: Kastamonu, Zonguldak, Karabük
  'tr-75': ['tr-8', 'tr-25', 'tr-36'], // Ardahan: Artvin, Erzurum, Kars
  'tr-76': ['tr-4', 'tr-36'], // Iğdır: Ağrı, Kars
  'tr-77': ['tr-16', 'tr-41'], // Yalova: Bursa, Kocaeli
  'tr-78': ['tr-14', 'tr-18', 'tr-37', 'tr-67', 'tr-74'], // Karabük: Bolu, Çankırı, Kastamonu, Zonguldak, Bartın
  'tr-79': ['tr-27'], // Kilis: Gaziantep
  'tr-80': ['tr-1', 'tr-27', 'tr-31', 'tr-46'], // Osmaniye: Adana, Gaziantep, Hatay, Kahramanmaraş
  'tr-81': ['tr-14', 'tr-54', 'tr-67'], // Düzce: Bolu, Sakarya, Zonguldak
};
