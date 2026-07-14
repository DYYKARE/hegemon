# Hegemon — Savaş Matematiği Çalışması (v1)

Bu belge, birim bazlı savaş sisteminin tasarım çalışmasıdır. Kod değişikliği yapılmadan önce
tartışılıp onaylanacak; onaydan sonra `src/engine/` altına uygulanacaktır.

---

## 0.0 Harita Tabanlı Cephe sistemi (v4 — uygulandı, GÜNCEL MODEL)

Kara komşularıyla savaşlar artık **graph tabanlı harita savaşı** (`warType: 'harita'`) ile
çözülür; §0'daki cephe havuzu modeli yalnız DENİZ AŞIRI seferlerde kullanılır.
Motor: `src/engine/frontline/resolveTurn.ts` (saf fonksiyon) + `src/engine/mapWar.ts` (adaptör).

### Veri modeli
- İller graph NODE'ları, sınırlar EDGE'ler. 81 TR ili (`frontline/trAdjacency.ts`, 196 sınır)
  + düşman eyaletleri (`NEIGHBOR_PROVINCES`) tek komşuluk grafında birleşir.
- Savaş ilanında düşman ordusunun %70'i eyalet garnizonlarına eşit bölünür
  (`enemyProvinceStrength`), %30'u anavatan rezervi olarak `aiMilitary`'de kalır ve
  her tur %12'si en zayıf eyalete takviye sızar.

### Emir kuyruğu
- Taarruz emirleri (`save.pendingOrders`) verildiği anda state'i DEĞİŞTİRMEZ;
  tur sonunda tüm emirler (oyuncu + AI) `resolveTurn`'e tek seferde gider, sonuç
  React'e tek batch update olarak döner (Web Worker'a taşınabilir saf mimari).
- Emre bağlanan birlikler KİLİTLENİR: kaynak ilin savunmasına yalnız %25 katılır.
- Emir yalnız komşu ile verilebilir (edge üstünde hareket); işgal altındaki TR ilini
  kurtarmak da sıradan bir taarruz emridir.

### Eşik modeli (R = Patk / Pdef)
| Sonuç | Koşul | Etki |
|---|---|---|
| Kesin Zafer | R ≥ 1.5 | Bölge tek turda düşer; savunanın %80'i imha, %20'si dost komşuya çekilir; saldıran ordu bölgeye yerleşir |
| Yıpratma | 0.8 < R < 1.5 | Bölge el değiştirmez; savunan `0.10·√R`, saldıran `0.10·√(1/R)` oranında zayiat |
| Kırılma | R ≤ 0.8 | Saldıran %25, savunan %3 zayiat; sağ kalanlar kaynağa döner |

- **Patk** = kara saldırısı (asker 1, tank 150) + hava desteği (hava üstünlüğü oranıyla
  kırpılmış bombardıman) × mutluluk çarpanı.
- **Pdef** = kara savunması (asker 1.5, tank 80) + tabya (900/adet) + **milis**
  (min(il nüfusu, 6M) × 0.004 — nüfus tavanı sayesinde megakent bölgeleri "bedava
  kale" olamaz; kalıcı savunma orduyla/tabyayla kurulur)
  × arazi çarpanı (ova 1.0 · orman 1.15 · şehir 1.25 · dağ 1.4).
- Tüm güçler tur BAŞI anlık görüntüsünden hesaplanır (eşzamanlı çözüm); karşılıklı
  taarruzlar emir sırasından bağımsızdır. Aynı bölgeyi iki taraf düşürürse yüksek R kazanır.

### Karşılaşma muharebesi (Faz 1.5 — "kale takası" engeli)
X→Y ve Y→X aynı turda taarruz ederse ordular birbirinin yanından geçip şehirleri
değiş tokuş EDEMEZ: iki kuvvet önce sınırda, AÇIK ARAZİDE çarpışır (tahkimat/arazi
bonusu yok; R = iki tarafın kara TAARRUZ gücü oranı × mutluluk çarpanları):
| Sonuç | Koşul | Etki |
|---|---|---|
| Yarma | R ≥ 1.5 | Kazanan %10 kayıpla taarruzuna devam eder; kaybedenin %60'ı imha, sağ kalanı kaynağına çekilip TAM güçle savunur |
| Kilitlenme | 0.8 < R < 1.5 | İki taraf da `0.20·√(karşı oran)` yıpranır; İKİ taarruz da iptal, sağ kalanlar evlerine döner |
- Hava akınları kesişmez (uçaklar üstten uçar); yalnız kara kuvvetli emirler çarpışır.
- Çok kaynaklı taarruzda yalnız AYNI kenarı paylaşan çift kesişir (X↔Y); üçüncü
  koldan gelen kuvvet (Z→Y) normal çözümlemeye devam eder.
- Rapor: "Sınır Muharebesi" (outcome `meeting`).
- UI'daki emir önizlemesi motorla AYNI formülü kullanır (varyanssız): oyuncu saldırıdan
  önce beklenen sonucu (Kesin Zafer / Yıpratma / Kırılır) görür.

### Fetih, barış, AI
- Ülkenin TÜM eyaletleri ele geçirilince ülke fethedilir (ekonomi devralınır; ayrıca
  piyade şartı yoktur — bölgeleri tutan ordu zaten sahadadır).
- Barışta ele geçirilen eyaletler İADE edilir, garnizonlar anavatana katılır,
  eyaletlerdeki ordumuz sınır iline döner. 60 turda zorunlu barış.
- AI her tur eyaletlerinden (ve işgal ettiği TR illerinden) komşu oyuncu illerine
  tahmini R'ye göre taarruz emri üretir (zorluk eşiği: kolay 1.4 · orta 1.05 · zor 0.85;
  ülke başına tur başına en çok 2 taarruz, garnizonun %65'i sürülür).
- Milis savunması sayesinde kalabalık iller (İstanbul, Ankara...) garnizonsuz bile kolay
  düşmez; küçük sınır illeri kırılgandır — sınırı boş bırakmanın bedeli vardır.
  Milis 6M nüfusta doyar (≈24K savunma): bölge başına nüfusu çok yüksek ülkeler bile
  ordusuz savunulamaz.
- **Cephe yığınağı (orta/zor)**: AI'nin açtığı savaşta istila kuvveti ve anavatan
  takviyesi ülkenin TÜM bölgelerine değil, sana komşu CEPHE bölgelerine yığılır
  (garnizon tavanı da cephe sayısına göre hesaplanır). Kolay'da AI özensiz yayılır —
  "rahat başlangıç" kalibrasyonu korunur. Ordusuz (yalnız milisli/tabyalı) hedefe
  AI ancak kesin-zafer oranıyla (R≥1.5) taarruz eder; yıpratma milise işlemez,
  boşuna saldırıp kan kaybetmez.

---

## 0. Cephe Ordusu sistemi (v2 — uygulandı)

Oyuncunun açtığı savaşlar artık **cephe ordusu** (`War.front`) ile çözülür:

1. **Savaş ilanı:** Kara komşularına (8 ülke) topyekün veya il-il savaş açılabilir;
   sınır komşusu olmayan ülkelere yalnız topyekün (deniz aşırı) harekât yapılabilir.
2. **Sevkiyat:** "Birlik Konuşlandır" ile HERHANGİ bir ildeki asker/tank/uçak seçilir;
   birlikler ilden AYRILIR ve savaşın cephe havuzuna katılır. Her tur takviye gönderilebilir,
   "Geri Çek" ile ordu sınır iline döndürülebilir.
3. **Muharebe:** Saldırı gücü ve zayiat yalnız cephedeki ordudan hesaplanır; yurttaki
   birlikler oyuncu taarruzundan etkilenmez (savunma savaşları eskisi gibi il bazlıdır).
4. **Fetih:** Direnç kırıldığında bayrağı dikecek asker CEPHEDE aranır
   (gereken: hedef taban gücünün %20'si).
5. **Savaş sonu:** Fetih, barış, geri çekme ve zorunlu barışta sağ kalan cephe ordusu
   o cepheye bakan işgalsiz sınır iline (yoksa Ankara'ya) döner.

AI istilalarına karşı savunma değişmedi: hedef sınır ilindeki kara gücü + yurttaki tüm
hava gücü savunur; il işgalleri "Kurtarma Taarruzu" ile komşu illerden geri alınır.

---

## 0.5 Savaş & kaynak matematiği (v3 — uygulandı)

Savaşı ve ekonomiyi birbirine bağlayan beş sistem:

### Bakım maliyeti (ordu artık bedava değil)
| Birim | Üretim | Bakım/tur | Cephede |
|---|---|---|---|
| Asker | $50K | $250 (%0.5) | ×2 |
| Tank | $5M | $25K (%0.5) | ×2 |
| Uçak | $100M | $500K (%0.5) | ×2 |
| Hava Savunma | $50M | $100K (%0.2) | — |
| Kara Savunma | $20M | $40K (%0.2) | — |
| Liman | $500M | $1M (%0.2) | — |

Hazine bakımı karşılayamazsa mobil birliklerin **tur başına en çok %10'u firar eder**
(yapılar dağılmaz). Cephe ×2 bakım → uzun savaş hazineyi kemirir, barışın ekonomik değeri doğar.

### Zorunlu askerlik (asker = insan)
Asker üretimi **il nüfusundan düşer** (1 asker = 1 kişi). Nüfus artık vergi tabanı + asker
havuzudur; savaş kayıpları kalıcı insan kaybıdır. Nüfus teşviki $500/kişi'ye indirildi.

### Tarım = gıda (tarım/sanayi tercihi gerçek oldu)
- **Sanayi**: %2/tur salt gelir.
- **Tarım**: %1/tur gelir **+ nüfus büyümesini hızlandırır** — kişi başı $100 tarımda
  doğal artış %0.1 → %0.4/tur (4 kat). İnsan mı para mı, gerçek bir tercih.

### Liman = deniz aşırı sefer lojistiği
Kara sınırı olmayan ülkeye savaş **en az 1 liman** gerektirir. Her liman **25.000 puanlık**
sefer kuvveti taşır (asker 1, tank 25, uçak 50 puan). Kapasiteyi aşan sevkiyat gemilere
sığmaz. Liman nihayet işlevine kavuştu: donanma altyapısı = küresel güç projeksiyonu.

### Savaş yorgunluğu + tahkimat kozu
- Her aktif savaş mutluluğu aşındırır: saldırı savaşı −0.8/tur, savunma −0.4/tur (tavan 3).
  Denge: mutluluk ≈ hedef − 10×yorgunluk → uzun savaş orduyu da zayıflatır (güç çarpanı).
- Düşman gücünün %10'u tahkimattır ve **tank saldırısını %50'ye kadar keser**
  (`tankEff = 1 − 0.5 × min(1, tahkimat / tankSaldırısı)`); asker etkilenmez,
  bombardıman tahkimatı umursamaz. Salt tank ordusu artık optimal değil.

---

## 0.6 Kalkınma, AI karşı hamleleri, terhis (v4 — uygulandı)

### Fethedilen toprağa kalkınma yatırımı
Devralınan ekonomi donuk kalmaz: ülke paneline **Kalkınma Yatırımı** eklendi.
Getiri **%1.5/tur** (yurttaki sanayiden düşük — işgal toprağını yönetmek zordur).
Fetihle devralınan yatırım birikimi de aynı oranda gelir üretir (onların
fabrikaları artık senin).

### AI karşı hamleleri
- **Fırsatçılık**: Mutluluğun 50'nin altına düştükçe AI'ların saldırı ihtimali
  ×2'ye kadar artar; kendi açtığın savaşla cephen meşgulken ×1.5 gelir.
  Zayıf anda savaş açmak artık gerçekten risklidir.
- **Akbaba sınırı**: Aynı anda en fazla 2 AI istilası — dogpile yok.
- **AI-AI savaşları**: Rakip çiftler (Yunanistan–Bulgaristan, Ermenistan–Azerbaycan,
  İran–Irak, Suriye–Irak, Gürcistan–Ermenistan) kendi aralarında savaşa tutuşabilir
  (%0.5/tur/çift). Savaşanlar her tur **%3 güç yitirir**, ekonomik büyümeleri yarılanır;
  savaş 15 turda ya da bir taraf taban gücünün yarısına düşünce biter. Savaşan ülke
  oyuncuya saldırmaz. Haritada zayıflayan komşu = **saldırı fırsatı** (panelde gösterilir).

### Terhis (ordu küçültme)
Bakım sisteminin tamamlayıcısı: il panelindeki **Terhis** menüsünden asker
**il nüfusuna geri döner** (insan kaybolmaz, vergi tabanına katılır);
araç/yapılar hurdaya ayrılır, maliyetin **%25'i** hazineye döner.
Barış döneminde büyük orduyu beslemek yerine terhis edip ekonomiye dönmek
gerçek bir strateji oldu.

---

## 1. Mevcut sistemin sorunları

Bugünkü güç değerleri ($1M başına üretilen güç):

| Birim | Maliyet | Güç | $1M başına güç |
|---|---|---|---|
| Asker | $50K | 1 | **20.0** |
| Tank | $5M | 12 | 2.4 |
| Uçak | $100M | 30 | 0.3 |
| Hava Savunma | $50M | 15 (def) | 0.3 |
| Kara Savunma | $20M | 8 (def) | 0.4 |
| Liman | $500M | 0 | 0 |

**Teşhis:** Asker, paraya göre her birimden 8–70 kat verimli. Optimal strateji "sadece asker bas"
haline geliyor; tank, uçak ve savunma yapıları dekoratif kalıyor. Liman'ın hiçbir işlevi yok.
Ayrıca birimler arası taş-kağıt-makas ilişkisi yok: her şey tek bir güç havuzuna toplanıyor.

---

## 2. Önerilen birim kartları

Tasarım ilkesi: **pahalı birim, ham güçte paraya göre DAHA verimli olmalı** (ölçek ekonomisi),
ama mutlaka bir "kozu" (counter) olmalı. Asker her koşulda çalışan, toprağı tutan evrensel birimdir.

| Birim | Maliyet | Kara atak | Kara savunma | Hava atak | AA gücü | $1M verim (atk/def) |
|---|---|---|---|---|---|---|
| Asker | $50K | 1 | 1.5 | – | – | 20 / 30 |
| Tank | $5M | 150 | 80 | – | – | 30 / 16 |
| Uçak | $100M | 4.000 (bombardıman) | – | 2.500 | – | 40 / – |
| Hava Savunma | $50M | – | – | – | 2.500 | – / 50 (yalnız havaya) |
| Kara Savunma | $20M | – | 900 | – | – | – / 45 (yalnız karada) |
| Liman | $500M | – | – | – | – | lojistik (v2: deniz aşırı sefer şartı) |

**Verim merdiveni:**
- Saldırıda: uçak (40) > tank (30) > asker (20) — ama uçağı AA keser, tankı kara savunması yarılar.
- Savunmada: AA (50, yalnız havaya) > kara savunma (45, yalnız karaya) > asker (30, her ikisine) > tank (16).
- Salt AA veya salt kara savunması tek başına delik bırakır → savunmada da karma kompozisyon zorunlu.

**Koz ilişkileri:**
- Uçak → Tank: bombardıman hasarı tanklara ×2 öncelikli işler.
- Tank → Asker: tank hasarı askerlere ×1.5 öncelikli işler.
- Hava Savunma ⊣ Uçak: AA, uçak etkinliğini (airEff) düşürür; yeterli AA uçağı sıfırlar.
- Kara Savunma ⊣ Tank: tahkimat, tank saldırı etkisini %50'ye kadar keser.
- Asker → Toprak: **fethi yalnız asker tamamlar** ("bayrağı asker diker").

---

## 3. Tur çözümleme akışı (3 faz)

### Faz 1 — Hava muharebesi
```
A_hava  = saldıran uçak adedi × 2.500
D_hava  = savunan AA toplamı + savunan uçak adedi × 2.500
airEff  = A_hava / (A_hava + D_hava)        // uçak yoksa 0, hava savunması yoksa 1
```
- Saldıran uçak kaybı/tur: `uçak × (1 − airEff) × 0.15`
- Savunan uçak kaybı/tur: `uçak × airEff × 0.15`

### Faz 2 — Kara muharebesi
```
tankEff = 1 − 0.5 × min(1, savunanKaraSavDef / saldıranTankAtk)
A = asker×1 + tank×150×tankEff + uçak×4.000×airEff
D = asker×1.5 + tank×80 + karaSav×900
```
- Savunan direnç kaybı/tur: `A × 0.12 × varyans(0.8–1.2)`
- Saldıran kaybı/tur: `D × 0.06 × varyans × (1 + 0.5 × defAirEff)`
  - `defAirEff` = savunanın hava gücü / (savunanın hava gücü + saldıranın AA'sı)
  - Yani AA'sız taarruz eden ordu, düşman havasından ek zayiat alır.

**Kayıp dağılımı:** Gelen hasar birim tiplerine şu ağırlıkla dağıtılır: asker %50, tank %30,
uçak %20 (tip yoksa kalanlara oransal). Yapılar (AA, kara savunma) muharebede %25 hızında
yıpranır — bedava sonsuz kale yok, ama kalıcı yatırım hissi korunur.

### Faz 3 — Sonuç
- **Fetih (oyuncu taarruzu):** direnç ≤ 0 **VE** sahadaki asker ≥ hedef taban gücünün %20'si.
  Salt uçak/tank fetih tamamlayamaz — direnç sıfırlanır ama "işgal için piyade bekleniyor" durumu doğar.
- **İstila (AI taarruzu):** aşağıdaki bölüme bak.

---

## 4. AI ordu kompozisyonu

AI ülkelerin tek `military` skoru şöyle yorumlanır:

| Bileşen | Pay |
|---|---|
| Kara gücü | %65 |
| Hava gücü | %20 |
| AA | %15 |

v2'de ülke bazlı profiller eklenebilir (İsrail AA-ağır, Rusya kara-ağır vb.).

---

## 5. Zorluk seviyeleri

Yeni oyun başlarken seçilir, kayda yazılır, oyun ortasında değiştirilemez.

| Parametre | Kolay | Orta | Zor |
|---|---|---|---|
| AI askeri güç | ×0.5 | ×1.0 | ×2.0 |
| AI ekonomik güç (gelir, ganimet, yağma) | ×0.5 | ×1.0 | ×2.0 |
| AI savaş açma şansı | ×0.5 | ×1.0 | ×2.0 |
| İstila kuvveti (ordusunun payı) | %25 | %40 | %60 |
| Hazırlık dönemi (saldırı yok) | 12 tur | 8 tur | 5 tur |

---

## 6. Hızlı istila ve toprak kaybı

İstenen akış: saldıran ülke ilk turda savaş açar, sonraki turda doğrudan işgal eder ve toprak alır.

- **Tur T:** "X sana savaş ilan etti!" — kart + haritada kırmızı/turuncu. Bu tur muharebe yok
  (oyuncuya tek turluk tepki şansı).
- **Tur T+1 ve sonrası:** her tur karşılaştırma yapılır:
  - `savunmaGücün (D) ≥ istilaKuvveti` → normal muharebe; istila kuvveti erir, püskürtülebilir.
  - `savunmaGücün (D) < istilaKuvveti` → o cephenin **sınır illerinden biri işgal edilir**:
    ilin geliri ve vergi katkısı kesilir, haritada işgalci rengiyle taranır. Her savunmasız tur +1 il.
- **Geri alma (v1):** istila kuvvetini eritip savaşı kazanırsan işgal edilen iller otomatik geri
  döner ve düşman tazminat öder. (v2: il il geri alma muharebesi.)

### Sınır illeri eşlemesi

| Komşu | Sınır illeri (işgal sırası) |
|---|---|
| Yunanistan (300) | Edirne (tr-22) |
| Bulgaristan (100) | Edirne (tr-22), Kırklareli (tr-39) |
| Gürcistan (268) | Artvin (tr-8), Ardahan (tr-75) |
| Ermenistan (051) | Ardahan (tr-75), Kars (tr-36), Iğdır (tr-76) |
| Azerbaycan (031) | Iğdır (tr-76) |
| İran (364) | Ağrı (tr-4), Van (tr-65), Hakkari (tr-30) |
| Irak (368) | Hakkari (tr-30), Şırnak (tr-73) |
| Suriye (760) | Hatay (tr-31), Kilis (tr-79), Gaziantep (tr-27), Şanlıurfa (tr-63), Mardin (tr-47), Şırnak (tr-73) |

Sınır illeri biterse işgal içeri doğru komşu illere ilerler (v1: coğrafi en yakın il).

---

## 7. Örnek muharebeler ve kazanma eşiği

**Kazanma eşiği (Lanchester kuralı):** İki taraf da her tur birbirini erittiği için basit
güç karşılaştırması yanıltır. Simülasyonla doğrulanan kural:

```
Etkili saldırı gücün ≥ düşman direnci × 0.71   (AA korumalıysan)
Etkili saldırı gücün ≥ düşman direnci × 0.87   (AA'sız taarruzda)
```
Bu eşiğin altında ordun, düşman direncinden ÖNCE tükenir ve taarruz çöker (barışla çıkmak
zorunda kalırsın). Eşik oyun içinde "Önerilen saldırı gücü" olarak gösterilir.

### Örnek 1 — Salt asker taarruzu (ders: eşiğin altında taarruz çöker)
Orta zorlukta Yunanistan (150K). Bütçe 5B$ → 100.000 asker, AA yok.
- Eşik: 150K × 0.87 ≈ 130K → 100K < 130K → **taarruz kaybedilir.**
- Simülasyon sonucu: ordunun tamamı erir, Yunanistan direnci ~%55'te kalır.
- Çıkış yolu: barış imzala (f≈0.55 → bedel ödersin) ya da hiç bulaşma.

### Örnek 2 — Doğru hedef: Bulgaristan (60K)
2.5B$: 30K asker (1.5B) + 100 tank (0.5B) + 10 AA (0.5B):
- Etkili güç ≈ 30K + 15K = 45K; eşik: 60K × 0.71 ≈ 42.6K → **kıl payı üstünde, kazanılır.**
- Başlangıç hazinesiyle (4.2B) ilk fetih hedefi Bulgaristan/Gürcistan/Ermenistan olmalı;
  Yunanistan için ~7B$ (60K asker + 400 tank + AA) biriktirmek gerekir.
- Oyun kendiliğinden "zayıf komşudan başla, büyüyerek ilerle" dinamiği kazanır.

### Örnek 3 — Savunma (zor zorlukta)
Zor'da Yunanistan 300K; istila kuvveti %60 = 180K.
- 3B$ savunma (30 kara sav + 20 AA + 30K asker) → D ≈ 72K → **yetmez, il kaybedersin.**
- Zorda sınırları tutmak için ~8–10B$ savunma yatırımı gerekir; kolayda (istila ≈ 7.5K) 500M$ yeter.
- Zorluk hissi doğrudan cüzdana yansır.

---

## 8. Uygulama planı (onay sonrası)

1. `economy.ts` — yeni güç tabloları: `LAND_ATTACK`, `LAND_DEFENSE`, `AIR_ATTACK`, `AA_POWER`
2. `combat.ts` — 3 fazlı çözümleme, kayıp dağılımı, fetihte asker şartı, yapı yıpranması
3. `countries.ts` — `getCountryStats(id, difficulty)`, AI kompozisyon sabitleri
4. `types.ts` — `difficulty` alanı, `occupiedProvinceIds`
5. `ai.ts` — zorluk parametreli saldırganlık, T ilan → T+1 işgal akışı, sınır illeri haritası
6. `save.ts` — `newGame(difficulty)`, eski kayıt migrasyonu
7. `MainMenu` — kolay/orta/zor seçimi
8. `WorldMap` + `GameUI` — işgal edilen il boyaması, işgal/geri alma bildirimleri
9. Simülasyon testleri — üç örnek senaryonun sayısal doğrulaması

## 9. Açık sorular

1. Fetihte **asker şartı** (%20) onaylı mı? (Salt uçak/tankla bayrak dikilemesin.)
2. İşgal edilen iller savaş kazanılınca **otomatik** mi dönsün (v1 önerisi), il il muharebeyle mi?
3. Yapılar (AA/kara savunma) muharebede **%25 hızında yıpransın** mı, hiç mi yıpranmasın?
4. **Liman** deniz aşırı sefer şartı olarak v2'ye kalsın mı? (v1'de işlevsiz kalmaya devam eder.)

### 2026-07-13 mantık düzeltmeleri (ek)
- **Yığınak tavanı**: AI istila yığını bölge başına `taban × 0.7 × 2 / max(cepheSayısı, 4)`
  (MIN_INVASION_SPREAD=4) ile sınırlı — tek bölgelik cephede (Kore DMZ'si) saldırgan
  bütün ordusunu tek yığına dikemez; tavanı aşan kuvvet anavatan rezervinde bekler.
- **AI ordu büyümesi ekonomiye bağlı**: organik büyüme (%0.3/tur) tur başına
  `gelir / POWER_COST` ile sınırlı — K.Kore (10M gelir) artık 800K ordusunu bedavaya
  şişiremez. İran/Irak/Yunanistan gibi normal ekonomiler tavanın altında, değişmedi.
- **Zafer koşulu (mapWar.victoryAchieved, tek kaynak)**: kara komşusu olan ülke tüm
  kara komşularını fetheder; kara komşusu OLMAYAN ada ülkesi (Avustralya vb.)
  ISLAND_VICTORY_CONQUESTS=3 ülke fethiyle kazanır (önceden hiç kazanamıyordu).
- **Kara komşuluğu eşiği 0.35°→0.12°** (örnekleme 240→900 nokta/halka): Almanya–
  Lihtenştayn, İngiltere–Fransa, Japonya–Rusya gibi su/kara üstü sahte komşuluklar
  kalktı; Öresund (~4 km) gibi köprü-mesafesi geçişler korunur. K.Kore etkin gücü
  550K'ya kalibre edildi (teçhizat kalitesi). Ordu iaşesi: ilk 25K asker
  (FREE_ARMY_RATION) tarımsız beslenir — yeni oyunda ilk kışla açlık cezası yemez.
