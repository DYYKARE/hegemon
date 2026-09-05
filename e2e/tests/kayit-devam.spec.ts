import { test, expect } from '../fixtures';

// =============================================================================
// Kayıt yönetimi: ÇOKLU YUVA sistemi (2026-07-17). Her oyun kendi yuvasına
// otomatik kaydedilir; "Yeni Oyun" yıkıcı değildir. Bu paket doğrular:
// yeniden yüklemede devam · Kaydet ve Çık · yeni oyunun eski kaydı KORUMASI ·
// Kayıtlar ekranından yükleme/silme.
// =============================================================================

test.beforeEach(async ({ mainMenu, gamePage }) => {
  await mainMenu.gotoFresh();
  await mainMenu.startNewGame({ country: 'Türkiye', difficulty: 'Kolay' });
  await gamePage.waitUntilLoaded();
  await gamePage.advanceTurns(2); // tur 3'te kayıt oluşur (her tur otomatik yazılır)
});

test('yeniden yükleme sonrası Devam Et aynı turdan sürdürür', async ({ page, mainMenu, gamePage }) => {
  await page.reload();
  await expect(mainMenu.continueButton).toBeVisible();
  await mainMenu.continueGame();
  await gamePage.waitUntilLoaded();
  expect(await gamePage.currentTurn()).toBe(3);
});

test('Kaydet ve Çık: menüye döner, kayıt korunur', async ({ mainMenu, gamePage }) => {
  await gamePage.saveAndExit();
  await expect(mainMenu.title).toBeVisible();
  await expect(mainMenu.continueButton).toBeVisible();
  await mainMenu.continueGame();
  await gamePage.waitUntilLoaded();
  expect(await gamePage.currentTurn()).toBe(3);
});

test('yeni oyun eski kaydı SİLMEZ: iki yuva ayrı ayrı yüklenir', async ({ page, mainMenu, gamePage }) => {
  // Türkiye (tur 3) yuvadayken ikinci oyun: Almanya
  await gamePage.saveAndExit();
  await mainMenu.startNewGame({ country: 'Almanya', difficulty: 'Orta' });
  await gamePage.waitUntilLoaded();
  await gamePage.advanceTurn(); // Almanya tur 2
  await gamePage.saveAndExit();

  // İki yuva da listede
  await mainMenu.openSaves();
  await expect(mainMenu.slotRows()).toHaveCount(2);
  await expect(page.getByTestId('save-slot').filter({ hasText: 'Türkiye' })).toBeVisible();
  await expect(page.getByTestId('save-slot').filter({ hasText: 'Almanya' })).toBeVisible();

  // Eski (Türkiye) yuvayı yükle → tur 3 aynen durur
  await page.getByTestId('save-slot').filter({ hasText: 'Türkiye' })
    .getByRole('button', { name: 'Yükle' }).click();
  await gamePage.waitUntilLoaded();
  expect(await gamePage.currentTurn()).toBe(3);
  const save = await gamePage.readSave();
  expect(save.playerCountryId).toBe('792');
});

test('kayıt silme: iki aşamalı onay, silinen yuva listeden düşer', async ({ page, mainMenu, gamePage }) => {
  await gamePage.saveAndExit();
  await mainMenu.startNewGame({ country: 'Almanya', difficulty: 'Orta' });
  await gamePage.waitUntilLoaded();
  await gamePage.saveAndExit();

  await mainMenu.openSaves();
  await expect(mainMenu.slotRows()).toHaveCount(2);

  const almanya = page.getByTestId('save-slot').filter({ hasText: 'Almanya' });
  await almanya.getByRole('button', { name: /kaydını sil/ }).click();
  // Vazgeç geri alır
  await almanya.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(mainMenu.slotRows()).toHaveCount(2);
  // Sil onaylanınca düşer, Türkiye kalır
  await almanya.getByRole('button', { name: /kaydını sil/ }).click();
  await almanya.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(mainMenu.slotRows()).toHaveCount(1);
  await expect(page.getByTestId('save-slot').filter({ hasText: 'Türkiye' })).toBeVisible();
});

test('ana menüye çıkış ve geri dönüş kaydı bozmaz', async ({ mainMenu, gamePage }) => {
  await gamePage.exitToMainMenu();
  await expect(mainMenu.title).toBeVisible();
  await mainMenu.continueGame();
  await gamePage.waitUntilLoaded();
  expect(await gamePage.currentTurn()).toBe(3);
});

test('eski tek anahtarlı kayıt (hegemon_save_v1) yuvaya göç eder', async ({ page, mainMenu, gamePage }) => {
  // Mevcut kaydı eski biçime çevir: yuvaları sil, aynı kaydı eski anahtara koy
  const save = await gamePage.readSave();
  await gamePage.saveAndExit();
  await page.evaluate((legacy) => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('hegemon_slot') || k === 'hegemon_active_slot' || k === 'hegemon_slots_v1') {
        localStorage.removeItem(k);
      }
    }
    localStorage.setItem('hegemon_save_v1', JSON.stringify(legacy));
  }, save);
  await page.reload();

  // Göç: "Devam Et" eski kaydı yuva olarak açar
  await expect(mainMenu.continueButton).toBeVisible();
  await mainMenu.continueGame();
  await gamePage.waitUntilLoaded();
  expect(await gamePage.currentTurn()).toBe(3);
  // Eski anahtar silinmiş, yuva sistemi devrede
  const migrated = await page.evaluate(() => ({
    legacy: localStorage.getItem('hegemon_save_v1'),
    index: JSON.parse(localStorage.getItem('hegemon_slots_v1') ?? '[]').length,
  }));
  expect(migrated.legacy).toBeNull();
  expect(migrated.index).toBe(1);
});
