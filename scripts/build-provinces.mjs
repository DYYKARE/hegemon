// Gerçek admin-1 (il/eyalet) sınırlarını oynanabilir ülkeler için işler:
// filtreler, geometriyi sadeleştirir, il komşuluğunu çıkarır → public/data/provinces.json
// Kaynak: Natural Earth 10m admin_1 (nvkelso). Çalıştırma: node scripts/build-provinces.mjs /tmp/ne10.json

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2] || '/tmp/ne10.json';
const OUT = new URL('../public/data/provinces.json', import.meta.url).pathname;

// ISO alpha-2 → numeric (world-atlas feature.id). Oynanabilir ülkeler (countryData.COUNTRY_META).
const A2_TO_NUM = {
  TR:'792', US:'840', CN:'156', RU:'643', IN:'356', DE:'276', FR:'250', GB:'826',
  IT:'380', ES:'724', PL:'616', UA:'804', JP:'392', KR:'410', KP:'408', BR:'076',
  AR:'032', MX:'484', CA:'124', EG:'818', ZA:'710', NG:'566', SA:'682', IR:'364',
  IQ:'368', SY:'760', GR:'300', BG:'100', GE:'268', AM:'051', AZ:'031', IL:'376',
  PK:'586', AF:'004', UZ:'860', KZ:'398', AU:'036', ID:'360', VN:'704', TH:'764',
  NL:'528', SE:'752', NO:'578', CY:'196',
};

const raw = JSON.parse(readFileSync(SRC, 'utf8'));

// Koordinat yuvarlama (0.05° ≈ 5.5 km) + ardışık tekrarları at.
// Komşu iller aynı yuvarlanmış köşeleri paylaşır → render'da boşluk olmaz.
const R = 20; // 0.05 adım
const round = v => Math.round(v * R) / R;

function simplifyRing(ring) {
  const out = [];
  let px = null, py = null;
  for (const [x, y] of ring) {
    const rx = round(x), ry = round(y);
    if (rx === px && ry === py) continue;
    out.push([rx, ry]); px = rx; py = ry;
  }
  return out.length >= 4 ? out : null;
}

// Bir feature'ın geometrisini [ring...] (dış halkalar) listesine indir, küçükleri at
function ringsOf(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const rings = [];
  for (const poly of polys) {
    const outer = simplifyRing(poly[0]); // yalnız dış halka (delikleri yok say)
    if (!outer) continue;
    // çok küçük parçaları (ada gürültüsü) at: bbox alanı eşiği
    let minx=180,miny=90,maxx=-180,maxy=-90;
    for (const [x,y] of outer){ if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y; }
    if ((maxx-minx)*(maxy-miny) < 0.05) continue; // ~ küçük ada
    rings.push(outer);
  }
  return rings;
}

// Ülke → il listesi
const byCountry = {};
for (const f of raw.features) {
  const num = A2_TO_NUM[f.properties.iso_a2];
  if (!num) continue;
  const rings = ringsOf(f.geometry);
  if (rings.length === 0) continue;
  const name = f.properties.name_tr || f.properties.name || f.properties.name_en || f.properties.adm1_code;
  // Kompakt anahtarlar (boyut): c=code, n=name, r=rings
  (byCountry[num] ??= []).push({ c: f.properties.adm1_code, n: name, r: rings });
}

writeFileSync(OUT, JSON.stringify(byCountry));
const nCountries = Object.keys(byCountry).length;
const nProv = Object.values(byCountry).reduce((s, a) => s + a.length, 0);
const bytes = readFileSync(OUT).length;
console.log(`OK: ${nCountries} ülke, ${nProv} il → ${(bytes/1e6).toFixed(2)} MB · public/data/provinces.json`);
console.log('TR il sayısı:', byCountry['792']?.length, '· IR:', byCountry['364']?.length, '· FR:', byCountry['250']?.length);
