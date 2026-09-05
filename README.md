# Hegemon

Sıra tabanlı küresel strateji oyunu: ülkeni seç, ekonomini büyüt, ordunu kur,
dünya hegemonyasını ele geçir. React + Vite + Capacitor (Android) —
tamamen çevrimdışı, API anahtarı/sunucu gerektirmez.

## Geliştirme

```bash
npm install
npm run dev          # http://localhost:3000
npm run android      # cihaza adb reverse ile dev sunucu
```

## Testler

```bash
npm run lint             # TypeScript tip kontrolü
npm test                 # motor play-test paketi (başsız Chrome, ~15 sn)
npm run test:guide       # rehber doğrulama matrisi (3 ülke×zorluk×harita)
npm run test:e2e         # Playwright E2E — POM, 4 görünüm (masaüstü/tablet/mobil yatay+dikey)
npm run test:e2e:headed  # E2E'yi tarayıcıyı izleyerek koş
npm run test:all         # hepsi birden (CI kapısı)
```

CI: `.github/workflows/playtest.yml` (her push/PR) ve
`.github/workflows/playwright.yml` (her push/PR + **her gün 06:00 UTC**).

## Android paketleri

```bash
npm run apk   # debug APK derle + bağlı cihaza kur
npm run aab   # imzalı release AAB (Play Store yükü) — imza kurulumu için aşağıya bak
```

## Belgeler

- [docs/oyun-mantigi.md](docs/oyun-mantigi.md) — oyun döngüsü, ekonomi, savaş matematiği, AI
- [docs/savas-matematigi.md](docs/savas-matematigi.md) — savaş sisteminin tasarım tarihçesi
- [docs/play-store-yayin.md](docs/play-store-yayin.md) — Google Play yayın rehberi (adım adım)
- [docs/gizlilik-politikasi.md](docs/gizlilik-politikasi.md) — gizlilik politikası (TR+EN)
