import { test, expect } from '../fixtures';

// =============================================================================
// Ana menü: açılış, ayarlar ve ayar kalıcılığı.
// Her test temiz depolama ile başlar (kayıt/oturum sızıntısı olmasın).
// =============================================================================

test.beforeEach(async ({ mainMenu }) => {
  await mainMenu.gotoFresh();
});

test('açılış: başlık ve ana eylemler görünür', async ({ mainMenu }) => {
  await expect(mainMenu.title).toBeVisible();
  await expect(mainMenu.newGameButton).toBeVisible();
  await expect(mainMenu.settingsButton).toBeVisible();
  // Temiz depolamada kayıt yok → "Devam Et" ÇİZİLMEZ
  await expect(mainMenu.continueButton).toBeHidden();
});

test('ayarlar: harita düzeni seçimi yeniden yüklemede korunur', async ({ page, mainMenu }) => {
  // Varsayılan 'detayli' — kalıcılığı kanıtlamak için VARSAYILAN OLMAYAN seçilir
  await mainMenu.openSettings();
  await page.getByRole('button', { name: /^Basit/ }).click();
  await page.getByRole('button', { name: 'Tamam' }).click();

  await page.reload();
  await mainMenu.openSettings();
  await expect(page.getByRole('button', { name: /^Basit/ })).toBeVisible();
  const selected = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hegemon_settings') ?? '{}').mapLayout);
  expect(selected).toBe('basit');
});

test('ülke arama: eşleşme yoksa boş durum mesajı', async ({ page, mainMenu }) => {
  await mainMenu.newGameButton.click();
  await mainMenu.countrySearch.fill('zzzz-olmayan-ülke');
  await expect(page.getByText('Ülke bulunamadı.')).toBeVisible();
  // Geri ile ana menüye dönüş
  await page.getByRole('button', { name: 'Geri' }).click();
  await expect(mainMenu.newGameButton).toBeVisible();
});
