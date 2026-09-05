import { test, expect } from '../fixtures';

// =============================================================================
// Oyun sonu durum geçişleri: ZAFER ve YENİLGİ bindirmeleri + sonrası akışlar
// (devam et / ana menüye dön). Bu geçişler tur tur oynayarak dakikalar sürer;
// DEV test köprüsü (window.__hegemonTest — yalnız dev build'de var) state'i
// doğrudan kurar, UI'nin geçişi DOĞRU ÇİZDİĞİ uçtan uca doğrulanır.
// =============================================================================

async function setSaveViaBridge(page: import('@playwright/test').Page, patch: Record<string, unknown>) {
  await page.evaluate((p) => {
    const bridge = (window as any).__hegemonTest;
    if (!bridge) throw new Error('DEV test köprüsü yok (__hegemonTest)');
    bridge.setSave((s: any) => ({ ...s, ...p }));
  }, patch);
}

test.beforeEach(async ({ mainMenu, gamePage }) => {
  await mainMenu.gotoFresh();
  await mainMenu.startNewGame({ country: 'Türkiye', difficulty: 'Orta' });
  await gamePage.waitUntilLoaded();
});

test('zafer: tüm komşular fethedilince bindirme çıkar, devam edilebilir', async ({ page, gamePage }) => {
  // Kara komşuları motordan (DEV köprüsü) — zafer koşulu tam bu listeye bakar
  const neighbors: string[] = await page.evaluate(() =>
    (window as any).__hegemonTest.getLandNeighbors());
  expect(neighbors.length).toBeGreaterThan(0);
  await setSaveViaBridge(page, { conqueredCountryIds: neighbors });

  await expect(page.getByRole('heading', { name: 'BÖLGESEL HEGEMON' })).toBeVisible();
  // "Devam Et" seçeneği: bindirme kapanır, oyun oynanabilir kalır
  await page.getByRole('button', { name: /Dünya Hegemonyasına Devam Et/ }).click();
  await expect(page.getByRole('heading', { name: 'BÖLGESEL HEGEMON' })).toBeHidden();
  await gamePage.advanceTurn();
});

test('yenilgi: ülkenin 1/3+ işgalinde bindirme çıkar; ana menüye dönüş kaydı korur', async ({ page, mainMenu, gamePage }) => {
  // Oyuncunun bölge kimlikleri kayıttan okunur (harita düzeninden bağımsız)
  const save = await gamePage.readSave();
  const regions: string[] = Object.keys(save.provinceInvestments);
  const occupyCount = Math.floor(regions.length / 3) + 1;
  const occupied: Record<string, string> = {};
  for (const rid of regions.slice(0, occupyCount)) occupied[rid] = '364'; // işgalci: İran

  await setSaveViaBridge(page, { occupiedProvinces: occupied });

  await expect(page.getByRole('heading', { name: 'ÜLKE DÜŞÜYOR' })).toBeVisible();
  // "Direnmeye devam" bindirmeyi kapatır, oyun sürer
  await page.getByRole('button', { name: /Direnmeye Devam/ }).click();
  await expect(page.getByRole('heading', { name: 'ÜLKE DÜŞÜYOR' })).toBeHidden();
  await gamePage.advanceTurn();

  // Yeniden başlatma yolu: ana menüye dön → kayıt durur → yeni oyun onay ister
  await gamePage.exitToMainMenu();
  await expect(mainMenu.title).toBeVisible();
  await expect(mainMenu.continueButton).toBeVisible(); // kayıt silinmedi
});
