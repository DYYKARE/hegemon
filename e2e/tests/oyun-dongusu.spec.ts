import { test, expect } from '../fixtures';

// =============================================================================
// Ana oyun döngüsü: başlat → oyna → durum geçişleri → veri tutarlılığı.
// Motorun içi 71+75 assert'lik playtest paketinde; burada KULLANICI YOLU ve
// UI ↔ localStorage tutarlılığı doğrulanır (harici veritabanı yok — kayıt
// deposu localStorage'dır, "veri tabanı tutarlılığı" onun üstünde koşar).
// =============================================================================

test.beforeEach(async ({ mainMenu, gamePage }) => {
  await mainMenu.gotoFresh();
  await mainMenu.startNewGame({ country: 'Türkiye', difficulty: 'Orta' });
  await gamePage.waitUntilLoaded();
});

test('yeni oyun: HUD tur 1 ve başlangıç hazinesiyle açılır', async ({ gamePage }) => {
  expect(await gamePage.currentTurn()).toBe(1);
  // Başlangıç hazinesi $4.2B (newGame sabiti) — denge değişirse bilinçli güncellenir
  expect(await gamePage.currentMoney()).toBe(4_200_000_000);
  await expect(gamePage.nextTurnButton).toBeVisible();
});

test('tur ilerleme: 3 tur → sayaç, hazine ve kayıt senkron', async ({ gamePage }) => {
  const startMoney = await gamePage.currentMoney();
  await gamePage.advanceTurns(3);

  expect(await gamePage.currentTurn()).toBe(4);
  // Ekonomi işledi (gelir − bakım ≠ 0 → hazine değişmiş olmalı)
  expect(await gamePage.currentMoney()).not.toBe(startMoney);

  // Veri tutarlılığı: localStorage kaydı UI ile aynı turu ve şemayı taşır
  const save = await gamePage.readSave();
  expect(save).not.toBeNull();
  expect(save.version).toBe(1);
  expect(save.turn).toBe(4);
  expect(save.playerCountryId).toBe('792');
  expect(typeof save.money).toBe('number');
});

test('edge case: hızlı ardışık tıklama tur kaybetmez/çiftlemez', async ({ gamePage }) => {
  // Fonksiyonel setState garantisinin UI'dan doğrulanması: 5 hızlı tık = +5 tur
  await gamePage.rapidClickNextTurn(5);
  await expect(gamePage.turnIndicator).toHaveAttribute('data-turn', '6');
  const save = await gamePage.readSave();
  expect(save.turn).toBe(6);
});

test('kesinti: arka plana alınınca otomatik oynatma durur', async ({ page, gamePage }) => {
  // Otomatik oynatmayı en hızlı kipte başlat
  await page.getByTitle('Çok Hızlı (0.5s)').click();
  // En az bir tur aksın
  await expect.poll(() => gamePage.currentTurn(), { timeout: 10_000 }).toBeGreaterThan(1);

  // Uygulama arka plana alınmış gibi: document.hidden=true + visibilitychange
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const frozenTurn = await gamePage.currentTurn();
  await page.waitForTimeout(2_000); // 0.5s kipinde ~4 tur akacak kadar bekle
  expect(await gamePage.currentTurn()).toBe(frozenTurn); // akmadı → durdu

  // Öne dönüş: oyun oynanabilir kalır (elle tur ilerler)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await gamePage.advanceTurn();
});

test('duraklatma menüsü: kaydet onayı ve oyuna dönüş', async ({ page, gamePage }) => {
  await gamePage.advanceTurn();
  await gamePage.openPauseMenu();
  // exact: 'Kaydet' alt dize olarak 'Kaydet ve Çık'la da eşleşir
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kaydedildi' })).toBeVisible();
});
