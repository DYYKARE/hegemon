# Hegemon — Google Play Store Yayın Rehberi (Adım Adım)

> Bu depoya özel, uçtan uca yayın kılavuzu. Teknik altyapı hazırdır:
> release imzalama `android/app/build.gradle`'a bağlı, AAB çıktısı tek komuttur
> (`npm run aab`). Sıra bu rehberdeki Console adımlarındadır.
>
> Depodaki mevcut değerler: appId `com.yusuf.hegemon` · minSdk 24 ·
> target/compileSdk 36 · versionCode 1 / versionName "1.0".

---

## 0. Ön Koşul Kontrol Listesi (depo tarafı — TAMAM)

| Gereksinim | Durum |
|---|---|
| Android App Bundle üretimi | ✅ `npm run aab` → `android/app/build/outputs/bundle/release/app-release.aab` |
| Release imzalama | ✅ `android/keystore.properties` varsa otomatik imzalar (şablon: `keystore.properties.example`) |
| Target SDK ≥ 35 (2025+ Play şartı) | ✅ 36 (`android/variables.gradle`) |
| İzinler | ✅ Yalnız `INTERNET` (Capacitor WebView standardı; oyun çalışırken ağa çıkmaz, tüm veri cihazda) |
| Çökme siperi + loglama | ✅ `ErrorBoundary` + `src/log.ts` |
| Kayıt güvenliği | ✅ Her tur `localStorage`'a otomatik yazılır; kesinti veri kaybetmez |
| Ekran yönü | `sensorLandscape` (manifest) — mağaza görselleri YATAY hazırlanmalı |

---

## 1. Geliştirici Hesabı ve Console Kurulumu

1. [play.google.com/console](https://play.google.com/console) → Google hesabıyla kaydol.
2. **25 $** tek seferlik kayıt ücretini öde.
3. Hesap türünü seç:
   - **Kişisel**: kimlik doğrulaması (resmî kimlik + adres) zorunlu; ayrıca
     üretime çıkmadan önce **kapalı test şartı** var (aşağıda §5).
   - **Kuruluş**: D-U-N-S numarası ister; kapalı test şartından muaf.
4. Kimlik doğrulamasını tamamla (birkaç gün sürebilir — İLK iş olarak başlat).
5. **Uygulama oluştur** → Ad: `Hegemon`, dil: Türkçe, tür: **Oyun**,
   ücretsiz/ücretli: **Ücretsiz** (ücretsiz seçimi kalıcıdır, sonradan ücretliye çevrilemez).

## 2. İmzalama Anahtarı (bir kez yapılır — anahtarı KAYBETME)

```bash
cd android
keytool -genkeypair -v -keystore hegemon-release.keystore \
  -alias hegemon -keyalg RSA -keysize 2048 -validity 10000
cp keystore.properties.example keystore.properties
# keystore.properties içine parolaları yaz (dosya .gitignore'da — git'e girmez)
```

- Keystore dosyasını + parolaları **parola yöneticisinde ve çevrimdışı yedekte** sakla.
- Console'da **Play App Signing**'i kabul et (varsayılan): Google, mağaza imzasını
  kendi anahtarıyla atar; senin anahtarın "upload key" olur. Upload key kaybolursa
  Google'dan sıfırlatılabilir — Play App Signing bu yüzden açık kalmalı.

## 3. Sürüm Çıktısı (.aab)

Her mağaza yüklemesinden önce `android/app/build.gradle` içinde:

- `versionCode` → **her yüklemede +1** (tam sayı; Play aynı kodu ikinci kez kabul etmez)
- `versionName` → kullanıcıya görünen sürüm ("1.0.1" gibi)

```bash
npm run test:all   # tip kontrolü + 71+75 assert — yeşil olmadan paketleme yok
npm run aab        # dist → cap sync → bundleRelease (imzalı AAB)
```

Çıktı: `android/app/build/outputs/bundle/release/app-release.aab`

> İlk yüklemeden önce cihazda son bir duman testi: `npm run apk` (debug APK kurar).

## 4. Mağaza Girişi (Store Listing)

### 4.1 Görsel standartları (hepsi zorunlu alan)

| Varlık | Boyut / Format | Not |
|---|---|---|
| Uygulama ikonu | **512×512 PNG**, ≤1 MB, alfa yok | Kaynak: `assets/icon-only.png` / `public/icon-512.png` (alfa kanalını kaldırarak dışa aktar) |
| Tanıtım grafiği (feature graphic) | **1024×500** PNG/JPG | Başlık + harita görseli; metni kenarlardan uzak tut |
| Telefon ekran görüntüleri | en az **2**, en çok 8; 16:9 önerilir | Oyun `sensorLandscape` → **yatay** al (örn. 1920×1080) |
| 7" ve 10" tablet görüntüleri | 1'er adet önerilir | Tablet vitrinine girmek için gerekli |

Ekran görüntüsü almanın kolay yolu: `npm run dev` → tarayıcıda
cihaz emülasyonu (1920×1080) → oyunun 3-4 farklı anı (harita, savaş, diplomasi paneli, zafer).

### 4.2 Metinler

- **Uygulama adı** (≤30): `Hegemon — Dünya Fetih Stratejisi`
- **Kısa açıklama** (≤80): `Ülkeni seç, ekonomini büyüt, ordunu kur — dünya hegemonyasını ele geçir.`
- **Uzun açıklama** (≤4000): oynanış özeti (sıra tabanlı, ekonomi/diplomasi/savaş),
  çevrimdışı oynanabilirlik, reklamsız/veri toplamaz vurgusu. Anahtar kelimeler:
  strateji, fetih, harita, sıra tabanlı, savaş oyunu.

### 4.3 Kategori ve iletişim

- Kategori: **Oyunlar → Strateji**; e-posta adresi zorunlu (Console'da görünür).

## 5. Politika Gereksinimleri (App Content — hepsi doldurulmadan yayın olmaz)

Console → **Policy → App content** sırayla:

1. **Gizlilik politikası**: HERKESE açık bir URL zorunlu.
   Hazır metin: `docs/gizlilik-politikasi.md` → GitHub Pages'te yayınla
   (repo Settings → Pages → `docs/` klasörü) ve URL'yi gir.
2. **Veri güvenliği formu (Data safety)**: Hegemon veri **toplamaz** ve **paylaşmaz**
   — tüm oyun durumu cihazda `localStorage`'dadır, çalışma anında ağ çağrısı yoktur.
   Formda: "Does your app collect or share any of the required user data types?" → **No**.
   ("Veri toplama yok" beyanı mağaza kartında güven rozeti olarak görünür.)
3. **Reklam beyanı**: reklam yok → **No ads**.
4. **İçerik derecelendirmesi (IARC anketi)**: kategori "Oyun"; soyut/şematik savaş
   teması işaretlenir (kan/gerçekçi şiddet yok) → beklenen sonuç PEGI 7 / ESRB E10+ civarı.
5. **Hedef kitle**: 13+ öner (çocuk odaklı değil → "Designed for Families" yükümlülüklerinden muaf).
6. **News app / COVID / Government app** soruları: hepsi Hayır.

## 6. Kapalı Test Şartı (kişisel hesaplar)

Kişisel geliştirici hesapları üretime başvurmadan önce **kapalı test** koşulunu
sağlamak zorundadır: testin **kesintisiz 14 gün** sürmesi ve asgari test kullanıcısı
sayısının karşılanması (kural 20 kullanıcıyla başladı; Google 2025'te düşürdü —
Console panosu senin hesabın için güncel sayıyı gösterir, oradaki değeri esas al).

Pratik akış:

1. Console → **Testing → Closed testing** → yeni sürüm (track) oluştur → AAB'yi yükle.
2. Test kullanıcılarını e-posta listesi veya Google Grubu ile ekle
   (arkadaşlar/aile yeterli; her birinin opt-in bağlantısından katılıp uygulamayı
   **kurması ve açması** gerekir).
3. 14 gün boyunca testi aktif tut; Console sayacı doluşu gösterir.
4. Şart dolunca **Apply for production** açılır → başvur (Google birkaç gün içinde yanıtlar).

> Bu bekleme süresini fırsata çevir: test kullanıcılarının geri bildirimiyle
> `versionCode`'u artırarak yeni AAB'ler yükle — track aynı kaldıkça 14 gün sayacı bozulmaz.

## 7. Üretime Çıkış

1. **Production** track → yeni sürüm → son AAB (veya kapalı testteki sürümü terfi ettir).
2. Sürüm notları (tr-TR) yaz.
3. Ülke/bölge seç (tümü önerilir).
4. **Kademeli yayın** (staged rollout) %10-20 ile başla; çökme/ANR metrikleri
   temizse (Console → Vitals) %100'e çıkar.
5. İlk inceleme genelde 1-7 gün sürer. Ret gelirse gerekçe e-postayla gelir;
   düzelt, `versionCode`+1 ile yeniden yükle.

## 8. Yayın Sonrası Bakım Döngüsü

- **Vitals** (çökme/ANR) haftalık kontrol — kötüleşirse görünürlük düşer.
- Her Play hedef SDK yükseltme mevzuatında (yıllık, genelde Ağustos son tarih)
  `android/variables.gradle` → `targetSdkVersion` güncelle + Capacitor'u güncelle.
- Sürüm çıkarken: `npm run test:all` yeşil → `versionCode`+1 → `npm run aab` → Console.
- CI zaten her push'ta oyun mantığını (71+75 assert) ve E2E paketini koşturur;
  kırmızı CI'da mağazaya sürüm YÜKLEME.
