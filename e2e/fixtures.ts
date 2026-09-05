import { test as base, expect } from '@playwright/test';
import { MainMenuPage } from './pages/MainMenuPage';
import { GamePage } from './pages/GamePage';

// =============================================================================
// Ortak fixture'lar: her test POM nesnelerini hazır alır; sayfa konsolundaki
// hatalar toplanır ve test sonunda BEYAZ LİSTE dışındakiler koşumu kırar —
// "görünüşte çalışan ama konsolu hata kusan" regresyonlar da yakalanır.
// =============================================================================

interface Fixtures {
  mainMenu: MainMenuPage;
  gamePage: GamePage;
  consoleErrors: string[];
}

export const test = base.extend<Fixtures>({
  mainMenu: async ({ page }, use) => { await use(new MainMenuPage(page)); },
  gamePage: async ({ page }, use) => { await use(new GamePage(page)); },
  consoleErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await use(errors);
    // Bilinen zararsızlar: kaynak yükleme 404'ü değilse her hata regresyondur
    const real = errors.filter(e => !/favicon|manifest/i.test(e));
    expect(real, `Konsol hataları:\n${real.join('\n')}`).toHaveLength(0);
  }, { auto: true }],
});

export { expect };
