#!/usr/bin/env node
// =============================================================================
// BAŞSIZ (HEADLESS) PLAY-TEST KOŞUCUSU — otomasyonun giriş kapısı
//
//   npm test              → 6 senaryolu ana suite (?playtest=1)
//   npm run test:guide    → rehber doğrulama matrisi (?playtest=guide)
//
// Ne yapar: kendi Vite sunucusunu AYRI portta açar (3000'deki oyununuza
// dokunmaz), sistemdeki Chrome'u başsız başlatır (playwright-core — tarayıcı
// indirmez), testin ekrana bastığı PLAYTEST_RESULT özetini bekler, insan-okur
// özet basar ve pass/fail'e göre exit code döner (0 = yeşil). Böylece git
// hook'una, watch döngüsüne ve CI'a takılabilir.
// =============================================================================
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const GUIDE = process.argv.includes('--guide');
const VERBOSE = process.argv.includes('--verbose');
const PORT = 3987; // dev sunucunuzla (3000) çakışmasın
const URL = `http://localhost:${PORT}/?playtest=${GUIDE ? 'guide' : '1'}`;
// Dünya kurulumu soğukta yavaş; rehber matrisi 3 kez dünya kurar
const TIMEOUT_MS = (GUIDE ? 15 : 6) * 60 * 1000;

const log = (m) => console.log(`[playtest] ${m}`);

// --- 1) Vite'ı ayağa kaldır ---
log(`Vite başlatılıyor (port ${PORT})…`);
const vite = spawn('npx', ['vite', `--port=${PORT}`, '--strictPort'], {
  stdio: VERBOSE ? 'inherit' : 'ignore',
  detached: false,
});
const stopVite = () => { try { vite.kill('SIGTERM'); } catch { /* kapanmış */ } };
process.on('exit', stopVite);
process.on('SIGINT', () => { stopVite(); process.exit(130); });

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch { /* henüz hazır değil */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Vite 30 saniyede açılmadı');
};

let browser;
try {
  await waitForServer();
  log('Sunucu hazır. Chrome (headless) açılıyor…');

  // Sistemde kurulu Chrome kullanılır — ayrıca tarayıcı indirilmez.
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  if (VERBOSE) page.on('console', msg => console.log(`  [tarayıcı] ${msg.text()}`));

  log(`Test açılıyor: ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Sonucu bekle. Rehber matrisi sayfayı yeniden yükler — evaluate çağrıları
  // navigasyona denk gelirse hata fırlatır; yut ve tekrar dene.
  log(`Koşuyor (${GUIDE ? 'rehber matrisi' : 'ana suite'})… tavan ${TIMEOUT_MS / 60000} dk`);
  const t0 = Date.now();
  let result = null;
  while (Date.now() - t0 < TIMEOUT_MS) {
    try {
      result = await page.evaluate(() => window.__playtestResult ?? null);
      if (result) break;
    } catch { /* sayfa yenileniyor (rehber kombosu geçişi) */ }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!result) throw new Error(`Zaman aşımı: ${TIMEOUT_MS / 60000} dk içinde sonuç gelmedi`);

  // --- İnsan-okur özet ---
  const dt = Math.round((Date.now() - t0) / 1000);
  console.log('');
  console.log(`  ${result.failed === 0 ? '🎉' : '❌'} ${result.mode === 'guide' ? 'REHBER DOĞRULAMA' : 'PLAY-TEST'}: ` +
    `${result.passed}/${result.total} assert geçti (${dt}sn)`);
  for (const f of result.failures) {
    console.log(`     ❌ [${f.scenario}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  console.log('');

  process.exitCode = result.failed === 0 ? 0 : 1;
} catch (err) {
  console.error(`[playtest] ❌ ${err.message}`);
  process.exitCode = 2;
} finally {
  await browser?.close().catch(() => {});
  stopVite();
}
