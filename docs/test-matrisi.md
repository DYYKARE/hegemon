# Hegemon — QA Test Matrisi (2026-07-17)

Otomasyon kolonu, vakanın hangi katmanda koştuğunu söyler:
- **lint** — `npm run lint` (tsc)
- **balance** — `npm run test:balance` (headless motor simülasyonu, `scripts/balance-sim.ts`)
- **playtest** — `npm test` (gerçek tarayıcıda motor+UI entegrasyonu, 71 assert)
- **guide** — `npm run test:guide` (ülke × zorluk × harita matrisi, 75 assert)
- **e2e** — `npm run test:e2e` (Playwright, 72 test, masaüstü+mobil)
- **manuel** — otomasyonu olmayan, sürüm öncesi elle koşulacak vaka

## 1. Ekonomi

| # | Vaka | Beklenen | Otomasyon |
|---|------|----------|-----------|
| E1 | Tur geliri = vergi + tarım + sanayi + fetih + ticaret | `computeIncome` HUD ile birebir | playtest S4, guide 1 |
| E2 | Bölgesel yatırım → yerel/küresel/ülke-detay göstergeleri senkron | üç gösterge aynı marjinal artış | playtest S4 |
| E3 | Yatırım doygunluğu (soft cap $20B/bölge) | marjinal getiri hiperbolik düşer, tavan $300M/tur/bölge | playtest S4 (formülle) |
| E4 | Bakım ödenemezse firar | tur başına en çok %10 mobil birlik dağılır, yapılar kalır | balance (S1 dolaylı) + manuel |
| E5 | İaşe: 25K üstü asker tarım ister | açlıkta bakım ×1.5'e çıkar, mutluluk −2/tur | guide 2 |
| E6 | Vergi %0/%100 uçları | mutluluk hedefi 100/0'a kayar; +/− butonları sınırda kilitlenir | playtest S1 |
| E7 | Terhis | asker nüfusa döner, araç %25 hurda değeriyle hazineye | manuel |
| E8 | Nüfus teşviki ülke geneline orantılı dağılır | tek il şişmez; işgalli iller pay almaz | manuel |
| E9 | İşgal altındaki ilin geliri ve nüfus artışı kesilir | `provinceLocalIncome`=0, nüfus sabit | balance S1 |
| E10 | Hazine asla eksiye düşmez | tüm satın almalar `cost > money` reddeder | playtest+e2e (dolaylı) |

## 2. Savaş Mekanikleri

| # | Vaka | Beklenen | Otomasyon |
|---|------|----------|-----------|
| S1 | Savaş ilanı: ordu %70 garnizon + %30 anavatan | mobilizasyon toplamı korunur | playtest S5 |
| S2 | İlan turu muharebesiz (hazırlık şansı) | ilk tur ne AI ne oyuncu emri çözülür | balance S3 (dolaylı) |
| S3 | Taarruz eşikleri: R≥1.5 kesin zafer, 0.8<R<1.5 yıpratma, R≤0.8 kırılır | önizleme motoruyla birebir | playtest S5, balance S3 |
| S4 | Salt hava akını bölge ELE GEÇİREMEZ | kara birliği şart | balance S6 (dolaylı) + manuel |
| S5 | Karşılaşma muharebesi (A→B ve B→A aynı tur) | sınırda çarpışır, kale takası olmaz | manuel |
| S6 | Kaynağı ve hedefi aynı turda düşen birlikler | dost komşuya çekilir, DÜŞMANA katılmaz | **balance S6** |
| S7 | Tüm bölgeler düşünce fetih | ekonomi devralınır, ganimet ödenir, ordu yerinde kalır | guide 3, e2e zafer |
| S8 | 60 tur zorunlu barış | bedel ödenir/alınır, işgaller İADE EDİLMEZ | manuel |
| S9 | Geri çekilme: bölgeler iade, −8 mutluluk | savaş <3 turdaysa ATEŞKES YOK (kalkan exploit'i) | **balance S4**, playtest S6 |
| S10 | İlhak karar matrisi (güç/yorgunluk/işgal oranı/başkent) | puanlar spec tablosuyla birebir, eşik 50 | playtest S6 |
| S11 | Reddedilen ilhak teklifi 5 tur beklemede | bekleme süresinde teklif işlem yapmaz | playtest S6 |
| S12 | Denizaşırı savaş ilanı liman+gemi+rota ister | hem ülke hem BÖLGE panelinden kilitli | manuel (yeni kapı) |
| S13 | Çıkarma kapasitesi: gemi başına 2K ağırlık | fazlası kırpılır; uçak kapasite kullanmaz | manuel |
| S14 | İşgal edilen ilin kurtarılışı | sıradan taarruz emri; garnizon oyuncu tabyalarını KULLANAMAZ | manuel |
| S15 | Milis savunması | nüfus×0.004 (tavan 6M nüfus), yalnız savunma, zayiat almaz | playtest (formül), balance S1 |

## 3. AI Davranışları

| # | Vaka | Beklenen | Otomasyon |
|---|------|----------|-----------|
| A1 | Hazırlık dönemi (grace): kolay 12 / orta 8 / zor 5 tur | süre bitmeden ilan yok | balance S1-S2 |
| A2 | Saldırı şansı çarpanları (güç oranı, mutsuzluk, meşguliyet, ilişki) | `attackChance` motor=gösterge | playtest (attackRiskInfo) |
| A3 | Aynı anda en çok 2 AI istilası | üçüncü ilan engellenir | balance S1 (120 tur gözlem) |
| A4 | "Donuk savaş" engeli: eşiği tutturamayacak AI ilan etmez | tabyalı sınırda ilan sayısı düşer | balance S1-S2 |
| A5 | İstila kuvveti cepheye yığılır (orta/zor), kolayda seyrelir | bölge başına tavan (MIN_INVASION_SPREAD=4) | manuel |
| A6 | Anavatan takviyesi en zayıf garnizona, tavana kadar | `expectedReinforcement` önizlemeyle birebir | playtest S5 (dolaylı) |
| A7 | Son kale huruç etmez | tek bölgesi kalan ülke tam güç savunur | manuel |
| A8 | AI ekonomik büyüme (gelir %0.3 bileşik, bütçeli askeri büyüme) | tavan: taban ordu ×2 | balance S2 (İran izleme) |
| A9 | AI-AI rakip savaşları (jenerik komşu-çifti üretimi) + müttefik desteği | oyuncunun cephe komşuları arasındaki kara-komşusu ikililer aday; aynı anda ≤3 savaş; iki taraf yıpranır, 15 turda biter | manuel |
| A10 | Fethedilmiş ülke AI listelerinden düşer | ordusu dirilmez, savaş ilan edilemez | playtest S5 + engine guard |

## 4. Diplomasi

| # | Vaka | Beklenen | Otomasyon |
|---|------|----------|-----------|
| D1 | Hediye tavanı: ülke başına tur başına +20 | spam ile ittifak zinciri kurulamaz | playtest S6 (dolaylı) |
| D2 | Pakt: ilişki 20+, iki tarafı da bağlar | süre bitiminde haber | guide 6 |
| D3 | İttifak: ilişki 60+; ilişki <30'a düşerse dağılır | müttefik saldırmaz, saldırgana cephe açar | manuel |
| D4 | Ticaret: ortak gelirinin %3'ü/tur; savaşta bozulur | fethedilen ortak listeden düşer | playtest (computeIncome) |
| D5 | Ültimatom: 2× güç + ilişki >−60; −40 ilişki | FETHEDİLMİŞ ülkeye verilemez | **balance S5** |
| D6 | Fetih korkusu: taban −12/fetih (tavan 5), anlık −15 komşulara | ilişkiler drift ile tabana kayar | manuel |
| D7 | Fethedilmiş ülkeyle pakt/ittifak/ticaret kurulamaz | motor null döner (bayat panel koruması) | engine guard (yeni) |
| D8 | −40 eşik uyarısı bir kez düşer | savaş sürpriz olmaz | manuel |

## 5. Tur Geçişi & Kayıt

| # | Vaka | Beklenen | Otomasyon |
|---|------|----------|-----------|
| T1 | Tur sırası: gelir→mutluluk→nüfus→bakım→AI→savaşlar→harita→diplomasi | advanceTurn deterministik zinciri | guide 1-2 |
| T2 | Hızlı ardışık "Sonraki Tur" tıklaması | tur kaybı/çiftleme yok | e2e |
| T3 | Kayıt yuvaları: yeni oyun eski kaydı silmez | iki yuva bağımsız yüklenir | e2e |
| T4 | Eski tek anahtarlı kayıt göçü | `hegemon_save_v1` yuvaya taşınır | e2e |
| T5 | Eski havuz savaşlı kayıt göçü | il_il/topyekun → harita; legacy alanlar atılır, cephe ordusu yurda döner, direnç %70 garnizon + %30 anavatan bölünür | **balance S7** |
| T6 | Kayıt kendi harita düzenini hatırlar | farklı düzen ayarıyla yüklense de bozulmaz | e2e (kayıt-devam) |
| T7 | localStorage dolu/erişilemez | oyun kayıtsız sürer, çökmez | manuel |
| T8 | Arka plana alınca otomatik oynatma durur | kesinti güvenliği | e2e |

## 6. UI / Uçlar

| # | Vaka | Beklenen | Otomasyon |
|---|------|----------|-----------|
| U1 | Hitbox çeperleri (12px/6px) | sınır dışı tıklama isabet eder | playtest S2 |
| U2 | Ordu Çağır filtreleri (kara/hava) | yalnız filtreli türler; yapılar taşınmaz | playtest S3 |
| U3 | Zafer bindirmesi: tüm kara komşuları fethedilince | ada ülkesinde 3 denizaşırı fetih | e2e + guide |
| U4 | Yenilgi bindirmesi: bölgelerin 1/3'ü işgalde | kapatılabilir, menüye dönüş kaydı korur | e2e |
| U5 | İki dokunuşlu onay (savaş/barış/geri çekilme) | tek tıkla geri alınamaz eylem yok | e2e (dolaylı) |
| U6 | Kıyısız ile liman/gemi üretimi kilitli | limansız ile gemi kilitli | playtest (motor guard) |
| U7 | Negatif/geçersiz sayı girişleri | parseDraft yalnız >0 tam sayı kabul eder | lint + kod denetimi |

## Sürüm öncesi manuel koşu önerisi
1. `npm run test:all` (lint + playtest + guide + e2e) — tamamı yeşil olmalı.
2. `npm run test:balance` — S4/S5/S6 regresyonları ✅, S1-S3 eğrileri göz kontrolü.
3. Manuel işaretli vakalardan en kritik beşi: S5 (karşılaşma muharebesi), S8 (60 tur barış), S12 (denizaşırı ilan kapısı), A9 (AI-AI savaş), D6 (fetih korkusu zinciri).
