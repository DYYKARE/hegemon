# Hegemon — Kalan Yayın Adımları (senin makinende)

> Durum (2026-07-17): Console'da uygulama oluşturuldu, TÜM App content beyanları (10/10)
> tamamlandı, gizlilik politikası URL'si girildi, mağaza metinleri hazır.
> Kalan adımlar aşağıda — hepsi senin MacBook'unda yapılmalı (native dosya seçici,
> Android SDK ve imza anahtarı güvenliği nedeniyle Claude bunlara erişemiyor).

---

## ADIM A — Mağaza görsellerini yükle (Console, ~10 dk)

Console → Hegemon → Play Store'daki varlığı → **Mağaza girişleri**.
Metinler zaten girildi (ad, kısa/uzun açıklama). Sadece görselleri yükle:

1. **Uygulama simgesi** → "Öğe ekle" → `store-assets/hegemon-icon-512-noalpha.png`
   (512×512, alfasız — hazır)
2. **Özellik grafiği** → "Öğe ekle" → `store-assets/hegemon-feature-1024x500.png`
   (1024×500 — hazır)
3. **Telefon ekran görüntüleri** (EN AZ 2, ideal 4-8) → aşağıdaki ADIM B'de üret
4. (Opsiyonel) 7" ve 10" tablet görüntüleri
5. **Kaydet**.

## ADIM B — Ekran görüntülerini üret (~15 dk)

Oyun YATAY. En temiz yöntem:

```bash
cd "/Users/yusuf/Documents/Zoom/iCollections/Folders/world-domination-strategy"
npm run dev        # http://localhost:3000
```

Tarayıcıda aç → Chrome DevTools (Cmd+Opt+I) → cihaz emülasyonu (Cmd+Shift+M) →
çözünürlüğü **1920×1080** yatay ayarla. Şu 4 anı yakala (Cmd+Shift+P → "Capture screenshot"):
harita görünümü, savaş/taarruz paneli, diplomasi/ekonomi paneli, zafer/istatistik ekranı.
PNG'leri ADIM A'da "Telefon ekran görüntüleri"ne yükle.

## ADIM C — İmza anahtarı üret (bir kez — ANAHTAR ASLA KAYBOLMAMALI)

```bash
cd "/Users/yusuf/Documents/Zoom/iCollections/Folders/world-domination-strategy/android"
keytool -genkeypair -v -keystore hegemon-release.keystore \
  -alias hegemon -keyalg RSA -keysize 2048 -validity 10000
cp keystore.properties.example keystore.properties
# keystore.properties içine: storeFile, storePassword, keyAlias=hegemon, keyPassword yaz
```

- Parolaları + `.keystore` dosyasını parola yöneticisine VE çevrimdışı yedeğe koy.
- Doğrula: `git status` → `.keystore` ve `keystore.properties` GÖRÜNMEMELİ (.gitignore'da).

## ADIM D — İmzalı AAB üret (~10 dk)

```bash
npm run test:all   # tsc + testler — yeşil değilse paketleme YOK
npm run aab        # çıktı: android/app/build/outputs/bundle/release/app-release.aab
```

## ADIM E — Kapalı test (kişisel hesap ZORUNLULUĞU — 14 gün)

Console → Test edin ve yayınlayın → **Kapalı test** → track oluştur:
1. ADIM D'deki `app-release.aab`'yi yükle.
2. Test kullanıcılarını e-postayla ekle (Console'daki asgari sayı ~12).
   Her tester opt-in linkinden katılıp uygulamayı KURMALI ve AÇMALI.
3. Testi kesintisiz **14 gün** aktif tut (sayaç Console'da).
4. Şart dolunca **Apply for production** → başvur.

## ADIM F — Üretim yayını

1. Production track → kapalı testteki son sürümü terfi ettir.
2. tr-TR sürüm notu yaz · ülke seçimi: tümü.
3. Kademeli yayın %10-20 → Vitals (çökme/ANR) temizse %100.
4. İnceleme 1-7 gün. Ret gelirse gerekçeyi düzelt, versionCode+1 ile yeniden yükle.

---

### Sonraki yüklemelerde
`android/app/build.gradle` → `versionCode` +1 →
`npm run test:all` yeşil → `npm run aab` → Console. Yıllık targetSdk yükseltmesini kaçırma.
