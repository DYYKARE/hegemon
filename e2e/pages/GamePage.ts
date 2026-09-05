import { Page, Locator, expect } from '@playwright/test';

// =============================================================================
// POM — Oyun ekranı (HUD + harita). Kritik göstergeler data-testid ile çapalı:
//   turn-indicator[data-turn]  → tur numarası (metin biçiminden bağımsız)
//   treasury[data-money]       → hazinenin ham değeri (animasyonlu metin değil)
//   next-turn                  → Sonraki Tur butonu
// Yeni HUD öğeleri bu çapaları etkilemez; testler kırılmadan büyür.
// =============================================================================

// Çoklu yuva düzeni: aktif yuva imleci + yuva anahtarı (src/engine/save.ts)
const ACTIVE_SLOT_KEY = 'hegemon_active_slot';
const SLOT_PREFIX = 'hegemon_slot_';

export class GamePage {
  readonly page: Page;
  readonly turnIndicator: Locator;
  readonly treasury: Locator;
  readonly nextTurnButton: Locator;
  readonly menuButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.turnIndicator = page.getByTestId('turn-indicator');
    this.treasury = page.getByTestId('treasury');
    this.nextTurnButton = page.getByTestId('next-turn');
    this.menuButton = page.getByTitle('Menü');
  }

  /** Dünya kurulumu bitene ve HUD çizilene kadar bekler; ilk açılış rehberini kapatır. */
  async waitUntilLoaded(): Promise<void> {
    await expect(this.turnIndicator).toBeVisible({ timeout: 60_000 });
    await this.dismissGuideIfOpen();
  }

  /** "Nasıl Oynanır" rehberi ilk oyunda otomatik açılır — açıksa kapat. */
  async dismissGuideIfOpen(): Promise<void> {
    const closeGuide = this.page.getByRole('button', { name: /Anladım, Fethe Başla/ });
    if (await closeGuide.isVisible().catch(() => false)) {
      await closeGuide.click();
      await expect(closeGuide).toBeHidden();
    }
  }

  async currentTurn(): Promise<number> {
    const v = await this.turnIndicator.getAttribute('data-turn');
    return Number(v);
  }

  async currentMoney(): Promise<number> {
    const v = await this.treasury.getAttribute('data-money');
    return Number(v);
  }

  /** Bir tur ilerletir ve tur sayacının arttığını doğrular. */
  async advanceTurn(): Promise<void> {
    const before = await this.currentTurn();
    await this.nextTurnButton.click();
    await expect(this.turnIndicator).toHaveAttribute('data-turn', String(before + 1));
  }

  /** N turu, her adımı doğrulayarak ilerletir. */
  async advanceTurns(n: number): Promise<void> {
    for (let i = 0; i < n; i++) await this.advanceTurn();
  }

  /** Sayaç doğrulaması beklemeden art arda hızlı tıklar (yarış durumu testi). */
  async rapidClickNextTurn(times: number): Promise<void> {
    for (let i = 0; i < times; i++) await this.nextTurnButton.click({ delay: 10 });
  }

  async openPauseMenu(): Promise<void> {
    await this.menuButton.click();
  }

  async saveFromPauseMenu(): Promise<void> {
    await this.openPauseMenu();
    // exact: 'Kaydet' alt dize olarak 'Kaydet ve Çık'la da eşleşir
    await this.page.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Kaydedildi' })).toBeVisible();
    // Duraklatma menüsünü kapat (modal içindeki "Devam Et")
    await this.page.getByRole('button', { name: 'Devam Et' }).click();
    await expect(this.nextTurnButton).toBeVisible();
  }

  /** Ana menüye çıkar: Menü → Oyundan Çık → Giriş Ekranına Dön (kayıt yazılır). */
  async exitToMainMenu(): Promise<void> {
    await this.openPauseMenu();
    await this.page.getByRole('button', { name: 'Oyundan Çık' }).click();
    await this.page.getByRole('button', { name: 'Giriş Ekranına Dön' }).click();
  }

  /** AKTİF yuvadaki kayıt nesnesini okur (veri tutarlılığı doğrulamaları için). */
  async readSave(): Promise<any | null> {
    return this.page.evaluate(([activeKey, prefix]) => {
      const id = localStorage.getItem(activeKey);
      const raw = id ? localStorage.getItem(prefix + id) : null;
      return raw ? JSON.parse(raw) : null;
    }, [ACTIVE_SLOT_KEY, SLOT_PREFIX] as const);
  }

  /** Duraklatma menüsündeki "Kaydet ve Çık" ile ana menüye döner. */
  async saveAndExit(): Promise<void> {
    await this.openPauseMenu();
    await this.page.getByRole('button', { name: 'Kaydet ve Çık' }).click();
  }
}
