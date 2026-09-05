import { test, expect } from '../fixtures';

// =============================================================================
// Görünüm/responsive: her test zaten 3 projede (masaüstü/tablet/mobil-yatay)
// koşar — buradaki assert'ler "kritik kontroller viewport İÇİNDE ve tıklanabilir"
// garantisidir. (2026-07-14'te dar ekranda Menü butonu ekran dışına taşmıştı;
// bu paket o sınıf hatayı her çözünürlükte yakalar.)
// =============================================================================

test.beforeEach(async ({ mainMenu, gamePage }) => {
  await mainMenu.gotoFresh();
  await mainMenu.startNewGame();
  await gamePage.waitUntilLoaded();
});

test('kritik HUD kontrolleri viewport içinde kalır', async ({ page, gamePage }) => {
  const viewport = page.viewportSize()!;
  for (const [name, loc] of [
    ['Sonraki Tur', gamePage.nextTurnButton],
    ['Menü', gamePage.menuButton],
    ['Hazine', gamePage.treasury],
    ['Tur göstergesi', gamePage.turnIndicator],
  ] as const) {
    await expect(loc, `${name} görünür olmalı`).toBeVisible();
    const box = await loc.boundingBox();
    expect(box, `${name} kutusu olmalı`).not.toBeNull();
    expect(box!.x, `${name} solda taşmış`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${name} sağda taşmış (viewport ${viewport.width}px)`)
      .toBeLessThanOrEqual(viewport.width + 1);
  }
});

test('harita çizilir ve tur ilerletince oyun akar', async ({ page, gamePage }) => {
  // Harita SVG'si DOM'da ve boyutlu (ilk svg'yi almak lucide İKONUNA denk
  // gelebilir — data-testid dünya haritasını hedefler)
  const svg = page.getByTestId('world-map');
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(box!.width).toBeGreaterThan(100);
  await gamePage.advanceTurn();
});
