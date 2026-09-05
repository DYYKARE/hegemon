import { defineConfig, devices } from '@playwright/test';

// =============================================================================
// Playwright E2E yapılandırması — POM tabanlı paket: e2e/
//
//   npx playwright test                 → başsız, tüm projeler (masaüstü+tablet+mobil)
//   npx playwright test --headed        → tarayıcıyı izleyerek
//   npx playwright test --project=masaustu   → tek görünüm
//   npx playwright show-report          → son koşumun HTML raporu
//
// webServer: kendi Vite'ını 3988'de açar (dev 3000 ve playtest 3987 ile çakışmaz);
// koşum bitince kapatır. CI'da da aynı mekanizma çalışır.
// =============================================================================

const PORT = 3988;

export default defineConfig({
  testDir: './e2e',
  // Her test kendi tarayıcı context'inde koşar (localStorage İZOLE) ve kendi
  // temiz kaydıyla başlar — paralellik güvenli. Dünya kurulumu CPU-yoğun:
  // CI'ın 2 çekirdeğinde 2, yerelde 4 işçi.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,   // CI'da dünya kurulumu yavaş olabilir
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,           // dünya kurulumu ana thread'i kilitler — cömert tavan
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'tr-TR',
    // Yerelde sistem Chrome'u kullanılır (playtest.mjs ile aynı yaklaşım —
    // tarayıcı indirmez); CI 'npx playwright install chromium' ile kurar.
    ...(process.env.CI ? {} : { channel: 'chrome' as const }),
  },
  webServer: {
    command: `npx vite --port=${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    // Android'de sensorLandscape kilitli ama web/PWA her yönde açılabilir —
    // dikey telefon da matriste (otomatik sığma garantisi 4 çözünürlükte).
    { name: 'masaustu', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: 'mobil', use: { ...devices['Desktop Chrome'], viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true } },
    { name: 'mobil-dikey', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } },
  ],
});
