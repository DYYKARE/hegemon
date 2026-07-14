# Hegemon — Oyun Mantığı ve Matematiği

> Motorun GÜNCEL durumunun özeti (2026-07-09, denge ayarları dahil).
> Savaş sisteminin tasarım tarihçesi için: `savas-matematigi.md`.
> Kod: `src/engine/` — sabitlerin tek doğru kaynağı koddur; bu belge hızlı başvurudur.

---

## 1. Oyun Döngüsü

Sıra tabanlı (1 tur = 1 ay). Oyuncu bir ülke seçer, hedef dünya hegemonyasıdır.
Her tur (`save.ts → advanceTurn`) şu sırayla işler:

1. **Gelir − Bakım**: vergi + yatırım getirileri hazineye girer, ordu bakımı düşülür.
   Hazine bakıma yetmezse birlikler **firar** eder (tur başına en çok %10).
2. **Mutluluk**: vergi hedefine %10 drift + savaş yorgunluğu.
3. **Nüfus artışı**: il başına `%0.1 + tarım bonusu` (işgal altındaki il büyümez).
4. **AI gelişimi**: komşu ülkeler ordu/ekonomi büyütür, savaş ilan edebilir,
   kendi aralarında savaşabilir.
5. **Deniz aşırı savaşlar**: havuz modeli (`combat.ts`).
6. **Harita savaşları**: tüm taarruz emirleri (oyuncu + AI) tek seferde çözülür
   (`mapWar.ts → frontline/resolveTurn.ts`).

Dünya, seçilen harita düzeninden (basit/detaylı/gerçek) **deterministik** üretilir;
bölge sayısı ülkenin gerçek il sayısına bağlıdır (gerçek = il sayısı, detaylı = ¼'ü,
basit = onun ⅓'ü; Türkiye 7/20/81).

---

## 2. Ekonomi

### 2.1 Gelir (tur başına)

```
Gelir = Σ(il) [ nüfus × 5$ × vergiOranı
              + eff(tarım) × %1
              + eff(sanayi) × %1.5 ]
      + Σ(fethedilen ülke) [ devralınan gelir + eff(yatırım) × %1.5 ]
```

Tarım ve sanayinin getirileri bilinçli olarak YAKINDIR — asıl değerleri
işlevlerindedir (aşağıda 2.6): tarım orduyu besler, sanayi silah üretir.

- İşgal altındaki ilin katkısı tamamen kesilir.
- **eff() = yatırım doygunluğu (azalan getiri)**:

```
eff(x) = x · CAP / (CAP + x),   CAP = $20B / bölge
```

  - $1B yatırımda verim ~%95 (erken oyunda hissedilmez).
  - $20B'de verim %50; getiri bölge başına asimptotik tavana yaklaşır
    (sanayi: en çok ~$400M/tur/bölge).
  - Sonuç: "tek bölgeye sonsuz para göm" çalışmaz; geç oyunda gelir
    büyütmenin yolu **fetihle yeni bölge açmaktır**.

### 2.2 Vergi ↔ Mutluluk (durum bazlı, sömürülemez)

```
hedef = 100 − vergi×100        (%0 → 100, %20 → 80, %50 → 50)
mutluluk ← mutluluk + (hedef − mutluluk) × 0.10   (her tur %10 yaklaşır)
güç çarpanı = 0.6 + mutluluk/100 × 0.7            (0→0.6, ~57→1.0, 100→1.3)
```

- Güç çarpanı hem taarruz hem savunma gücünü ölçekler.
- Savaş yorgunluğu: her tur mutluluktan düşer — saldırı savaşı 0.8, savunma 0.4,
  toplam tavan 3.
- Sömürü kapalı: "vergiyi sıfırla → 100'e çık → %100 vergi bas" denenirse hedef
  anında 0'a iner ve mutluluk 2-3 turda çöker.

### 2.3 Nüfus ve Tarım (gıda)

```
büyüme = %0.1 + %0.3 × min(1, kişiBaşıTarım / $100)   (tam beslenmede 4 kat: %0.4)
```

- Nüfus = vergi tabanı + asker havuzu (asker üretimi il nüfusundan düşer,
  terhiste geri döner).
- Nüfus teşviki: $500 = 1 kişi.

### 2.4 Birim fiyatları ve bakım

| Birim | Fiyat | Bakım/tur | Not |
|---|---|---|---|
| Asker | $50K | $250 | nüfustan alınır |
| Tank | $5M | $25K | |
| Uçak | $100M | $500K | |
| Liman | $500M | $1M | deniz aşırı sefer kapasitesi (25K ağırlık/liman) |
| Hava Savunma | $50M | $100K | AA gücü 2 500/adet |
| Kara Savunma (tabya) | $20M | $40K | savunma gücü 900/adet |

- Bakım ≈ fiyatın %0.5'i (mobil) / %0.2'si (yapı). Cephedeki birlik bakımı **2 kat**.
- Terhis: askerler il nüfusuna geri döner; araç/yapı hurda değeri fiyatın %25'i.

### 2.5 Ordu İaşesi (tarımın gelir dışı işlevi)

> Not: tur başına "üretim kapasitesi" sistemi denendi ve KALDIRILDI (2026-07-09,
> oynanışta gereksiz sürtünme yarattı). Birim üretiminin tek sınırı hazinedir.

**Tarım = ordunun gıdası.** Sivil nüfus kendine yeter (taban %0.1 büyüme);
ORDU tarım ister — her asker 3 kişilik gıda tüketir:

```
talep = asker sayısı × 3 × $100 tarım    (600K asker → $180M tarım)
iaşe oranı r = eff(toplam tarım) / talep  (0..1)
```

- r < 1 ise: asker bakımı ×(1 + 0.5×(1−r)) — tam açlıkta 1.5 kat — ve
  mutluluk −2×(1−r)/tur. Büyük işgal ordusu beslemek gerçek tarım yatırımı ister.

### 2.6 Saldırı verimliliği (güç/$ — ordu kompozisyonu neden önemli)

| Birim | Taarruz gücü | Güç / $1M |
|---|---|---|
| Asker | 1 | 20 |
| Tank | 150 | 30 |
| Uçak (bombardıman) | 4 000 | 40 (AA yoksa) |

Savunmada tersine döner: asker 1.5 (en verimli savunmacı), tank 80.

---

## 3. Savaş Matematiği (harita savaşı — güncel model)

Bölgeler graph düğümleri, sınırlar kenarlardır. Emirler tur sonunda **eşzamanlı**
çözülür (tüm güçler tur başı anlık görüntüsünden; emir sırası önemsiz).

### 3.1 Güçler

```
Patk = (asker×1 + tank×150 + bombardıman) × güçÇarpanı(saldıran)
Pdef = (asker×1.5 + tank×80 + tabya×900 + milis) × arazi × güçÇarpanı(savunan)

milis  = min(il nüfusu, 6M) × 0.004 güç puanı (yalnız savunma; zayiat almaz;
         tavan: megakent bölgesi ordusuz "düşmez" olmasın — MILITIA_POP_CAP)
arazi  = ova 1.0 · orman 1.15 · şehir 1.25 · dağ 1.4
varyans = ±%5 (R'ye uygulanır)
```

### 3.2 Hava fazı

```
airEff      = atkUçak×2500 / (atkUçak×2500 + defUçak×2500 + AA×2500)
uçak kaybı  = atkUçak × (1 − airEff) × 0.15
bombardıman = sağKalanUçak × 4000 × airEff
```

- **Hava akını** (yalnız uçaklı emir) menzilsizdir (komşuluk aranmaz) ama
  **toprak tutamaz** — kesin zafer için karada asker/tank şarttır.

### 3.3 Eşik modeli — R = Patk / Pdef

| Sonuç | Koşul | Saldıran kaybı | Savunan kaybı | Bölge |
|---|---|---|---|---|
| **Kesin Zafer** | R ≥ 1.5 (+kara birliği) | %5 | %80 imha, %20 dost komşuya çekilir | **düşer**, ordu yerleşir |
| **Yıpratma** | 0.8 < R < 1.5 | 0.10·√(1/R) | 0.10·√R | değişmez, ordu döner |
| **Kırılma** | R ≤ 0.8 | %25 | %3 | değişmez |

- Emre bağlanan (kilitli) birlik kendi ilini yalnız **%25** kapasiteyle savunur →
  tüm orduyla saldırıp yeni alınan bölgeyi boş bırakmak onu düşmana geri kaptırır:
  **garnizon bırak**.
- Aynı hedefe aynı tarafın emirleri tek muharebede birleşir; iki taraf aynı bölgeyi
  düşürürse yüksek R kazanır.
- Milis zayiat almadığından yalnız-milisli il ancak **kesin zaferle** düşer —
  yıpratma milise işlemez.
- UI önizlemesi motorla aynı formülü kullanır (varyanssız): saldırmadan önce
  beklenen sonuç görülür.

### 3.4 Savaş ilanı, garnizonlar, takviye

- İlanla düşman ordusunun **%70'i** bölge garnizonlarına eşit bölünür,
  %30'u anavatan rezervi kalır.
- Rezervden her tur **%12** en zayıf garnizona sızar; **tavan**: bölge garnizonu,
  ilan payının en fazla **2 katı** (GARRISON_CAP_MULT) — garnizon sonsuz şişmez.
- Ülkenin tüm bölgeleri alınınca **fetih**: ekonomisi devralınır (gelir + yatırım
  birikimi artık sana akar), ganimet = gelirin 5 katı, ordu bölgede konuşlu kalır.

### 3.5 Deniz Harekâtı (amfibi çıkarma)

- Denizler/okyanuslar/büyük göller 6°'lik **uluslararası su hücrelerine** bölünür;
  kimsenin değildir. Kapalı havzalar (Hazar) ayrı bileşendir — oradaki filo okyanusa çıkamaz.
- **Liman** yalnız DENİZE KIYISI olan ile kurulur; **gemi** yalnız LİMANLI ilde üretilir
  ($200M, bakım $400K/tur).
- Çıkarma: limanlı+gemili kıyı ilinden, aynı su havzasındaki düşman KIYI bölgesine
  taarruz emri. Taşıma **gemi kapasitesiyle** sınırlı: gemi başına 2 000 ağırlık
  (asker 1 · tank 25); uçaklar uçar, yük tutmaz. Başarılı çıkarmada ordu karaya
  yerleşir (R eşikleri aynıdır); gemiler üste kalır, başarısızlıkta birlikler döner.
- Kara sınırı olmayan ülkeye savaş = deniz aşırı sefer: ilan için en az bir
  çıkarma-yetenekli kaynak (liman+gemi+rota) gerekir.

### 3.6 Barış

```
bedel = taban gelir × 10 × (kalanGüç/başlangıçGücü − 0.4) + işgal fidyeleri
fidye(il) = ilin TAM kapasite tur geliri × 30
```

- Kalan güç < %40 ise bedel NEGATİF (düşman sana öder). Barışta ele geçirilen
  bölgeler iade edilir. 60 turda **zorunlu barış** (fidye ödenmez, işgal kalır).
  Ateşkes 40 tur sürer.

---

## 4. AI Davranışı

### 4.1 Büyüme (yalnız oyuncunun cephe komşuları, her tur)

```
gelir      ×= 1.003            (bileşik %0.3/tur; AI-AI savaşında yarısı)
ordu       = ordu × 1.003 + gelir×0.30/50 000$
toplam tavan = taban ordu × 2   (anavatan + garnizonlar BİRLİKTE sayılır)
```

- Barışta ~%30 / 50 tur büyür → **erken saldırmak avantajlıdır**; oyuncu bunu
  panelde görür ("▲ +X/tur · toplamda +%Y").

### 4.2 Saldırganlık (oyuncuya savaş ilanı)

```
şans/tur = 0.01 × zorluk × güçOranı(0.2–3) × zayıflıkÇarpanı × meşguliyetÇarpanı
         (tavan 0.15; aynı anda en çok 2 AI istilası; grace: kolay 12 / orta 8 / zor 5 tur)
zayıflık  = mutluluk < 50 ise ×1'den ×2'ye
meşguliyet = oyuncunun açık taarruz savaşı varsa ×1.5
```

- **Donuk savaş engeli (2026-07-14)**: istila, tam yığınak sonrası bile hiçbir
  sınır bölgesinde taarruz eşiğini tutturamayacaksa savaş HİÇ ilan edilmez
  (`invasionHasViableTarget`) — güçlü sınır savunması (tabya+milis+ordu) fiilî
  caydırıcılıktır; ülke panelindeki risk göstergesi de aynı kontrolü yansıtır.

### 4.3 Taarruz emri üretimi

- AI, her bölgesinden komşu oyuncu bölgelerine tahmini R hesaplar; eşiği aşan
  en iyi hedefe garnizonunun **%75'ini** sürer (tur başına ülke başına en çok 2 emir).
- Eşikler (AI_MIN_RATIO): **kolay 1.25 · orta 0.90 · zor 0.75** — yıpratma
  bölgesini kapsar; AI kesin zafer göremese de baskı kurar.
- **Son kale kuralı (2026-07-14)**: ülkenin elinde kalan SON öz bölgesi huruç
  etmez, tam güçle savunur (işgal ettiği oyuncu illerinden taarruz sürebilir).
  Aksi halde son bölge her tur %75'iyle boş bölgeleri geri alıp savaş
  bitirilemez bir "bölge pinponu"na dönüyordu.

### 4.4 Diplomasi ve ikili ilişkiler (2026-07-13)

Her komşuyla **ilişki puanı**: −100 (düşman) … +100 (müttefik), varsayılan 0.
Motor: `src/engine/diplomacy.ts`.

**İlişkinin savaşa etkisi** — saldırı şansı formülüne çarpan:

```
ilişkiÇarpanı = 1 − ilişki/100     (+100 → ×0, 0 → ×1, −100 → ×2)
```

**Drift**: ilişki her tur ±1 adımla duruma bağlı TABANA kayar:

```
taban = −12 × min(5, fetihSayısı) + (ticaret? +20) + (ittifak? +30)
```

Yani genişledikçe komşular kalıcı olarak soğur (tehdit algısı); anlaşmalar ısıtır.

**Anlık değişimler**: savaş ilanı → hedef −100, diğer komşular −15; fetih →
tüm komşular −15; barış → +20; AI sana savaş açarsa → −80; ültimatom → −40.
İlişki −40'ın altına inerken bir kez uyarı olayı üretilir ("ilişkiler düşmanca").

**Diplomatik eylemler** (ülke panelinden):

| Eylem | Koşul | Bedel | Etki |
|---|---|---|---|
| Hediye | savaş yok | serbest tutar | +3 ilişki / (hedefin 1 tur geliri), tek seferde en çok +20 |
| Ticaret Anlaşması | ilişki ≥ 0 | 1× gelir | her tur hedef gelirinin %5'i sana + taban +20 |
| Saldırmazlık Paktı | ilişki ≥ 20 | 5× gelir | 25 tur İKİ taraf da saldıramaz |
| İttifak | ilişki ≥ 60 | 10× gelir | saldırmaz + sana saldıranın kara komşusuysa ona cephe açar (AI-AI savaşı); ilişki < 30'a düşerse dağılır |
| Ültimatom | güç ≥ 2× onun ordusu, ilişki > −60 | — | 5× gelir haraç alırsın, ilişki −40 |

**Saldırı riski göstergesi**: `ai.attackRiskInfo` motordaki savaş ilanı
formülünün BİREBİR kopyasıdır (tek `attackChance` fonksiyonu ikisine de hizmet
eder); ülke panelinde "Saldırı riski: düşük/orta/yüksek ~%X/tur · 10 turda ~%Y"
ve nedenleri (güç oranı, mutsuzluk, meşguliyet, ilişki) gösterilir. Grace /
ateşkes / pakt / ittifak / AI-AI savaşı riski "yok" yapar ve nedeni yazar.

### 4.5 AI-AI savaşları

- Tarihî rakip çiftler (Yunanistan–Bulgaristan, İran–Irak...) %0.5/tur şansla
  savaşa tutuşur; iki taraf da %3/tur erir, 15 turda ya da taraf taban gücünün
  yarısına düşünce biter. Savaşan komşu = **fırsat penceresi** (panelde gösterilir).

---

## 5. Zorluk Seviyeleri

| | Kolay | Orta | Zor |
|---|---|---|---|
| AI güç/gelir çarpanı | ×0.5 | ×1.0 | ×2.0 |
| Saldırganlık | ×0.5 | ×1.0 | ×2.0 |
| İstilaya ayrılan ordu payı | %25 | %40 | %60 |
| Dokunulmazlık (grace) | 12 tur | 8 tur | 5 tur |
| AI taarruz eşiği (R) | 1.25 | 0.90 | 0.75 |

---

## 6. Stratejik Denge Özeti (neden böyle?)

- **Erken oyun**: başlangıç hazinesi ($4.2B) küçük bir komşuyu (Ermenistan ~50K)
  ~5 turda fethetmeye yeter. Büyük komşu (Yunanistan 150K→barışta 195K+) ciddi
  ekonomi ister.
- **Ekonomi motoru**: sanayi 50 turda amorti; bileşik büyüme güçlü ama bölge
  başına doygunluk yüzünden sınırsız değil → genişleme baskısı.
- **Ordu beslemek pahalı**: barışta terhis et, savaştan önce üret; cephe bakımı
  2 kat, uzun savaş hazineyi kemirir (zorunlu barış + yorgunluk da caydırır).
- **Tarım/sanayi bir tercih**: sanayi orduyu HIZLI kurdurur (üretim bütçesi),
  tarım orduyu UCUZ yaşatır (iaşe); salt gelir istiyorsan ikisi de doygunluğa
  kadar çalışır. İlk fetih artık ~10-12 tur (üretim bütçesi yüzünden ordu
  birikerek kurulur — rush yerine planlama).
- **Milis**: kalabalık iller ordusuz da zor lokma (küçük akınlar kırılır), ama
  büyük istila (orta zorlukta İran ~3. turda ilk bölgeyi alabilir) durdurulamaz —
  sınır savunması (tabya/ordu) gerçek bir ihtiyaçtır.
- **Beklemenin bedeli**: AI her tur büyür (panelde görünür); erken savaş ucuz,
  geç savaş pahalıdır — ama savaş yorgunluğu art arda savaşı da cezalandırır.
