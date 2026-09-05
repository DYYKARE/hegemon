import { Page, Locator, expect } from '@playwright/test';

// =============================================================================
// POM — Ana Menü. Seçiciler dayanıklılık sırasına göre: rol + erişilebilir ad
// (aria-label/metin). Yeni buton eklenmesi bu sınıfı KIRMAZ; yalnız buradaki
// akışlara dokunan metin değişirse tek satır güncellenir.
// =============================================================================

export type Difficulty = 'Kolay' | 'Orta' | 'Zor';

export class MainMenuPage {
  readonly page: Page;
  readonly title: Locator;
  readonly continueButton: Locator;
  readonly newGameButton: Locator;
  readonly settingsButton: Locator;
  readonly countrySearch: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.getByRole('heading', { name: 'HEGEMON' });
    this.continueButton = page.getByRole('button', { name: 'Devam Et' });
    this.newGameButton = page.getByRole('button', { name: 'Yeni Oyun' });
    this.settingsButton = page.getByRole('button', { name: 'Ayarlar' });
    this.countrySearch = page.getByPlaceholder('Ülke ara…');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.title).toBeVisible();
  }

  /**
   * TEMİZ depolamayla menüye gider. Sıra önemli: önce ilk yükleme TAMAMLANIR
   * (menü çizildi = coğrafya fetch'leri bitti), sonra temizlik + yeniden yükleme.
   * Yüklenme ortasında ikinci navigasyon, yarım fetch'leri iptal edip konsola
   * "Failed to fetch" düşürür — konsol denetimi (fixtures) onu regresyon sayar.
   */
  async gotoFresh(): Promise<void> {
    await this.goto();
    await this.page.evaluate(() => localStorage.clear());
    await this.page.reload();
    await expect(this.title).toBeVisible();
  }

  /** Kayıtlı oyun var mı? ("Devam Et" yalnız kayıt varken çizilir) */
  async hasSave(): Promise<boolean> {
    await expect(this.newGameButton).toBeVisible();
    return this.continueButton.isVisible();
  }

  /**
   * Menü, ekran geçişinden sonraki 300 ms içindeki tıkları BİLEREK yutar
   * (mobil ghost-click koruması — MainMenu.guarded). Playwright insandan hızlı
   * tıkladığından korumalı butonlardan önce kilit süresi kadar beklenir.
   */
  private async clickGuarded(locator: Locator): Promise<void> {
    await this.page.waitForTimeout(350);
    await locator.click();
  }

  /**
   * Yeni oyun başlatır: Yeni Oyun → (kayıt varsa onay) → ülke seç → zorluk seç.
   * Dünya kurulumu ana thread'i kilitler; çağıran GamePage.waitUntilLoaded bekler.
   */
  async startNewGame(opts: { country?: string; difficulty?: Difficulty } = {}): Promise<void> {
    const { country = 'Türkiye', difficulty = 'Orta' } = opts;
    // Yeni oyun yeni yuvada başlar — yıkıcı değil, onay modalı yok
    await this.newGameButton.click();

    // Ülke seçimi (arama daraltır — liste uzun)
    await expect(this.countrySearch).toBeVisible();
    await this.countrySearch.fill(country);
    await this.clickGuarded(this.page.getByRole('button', { name: country, exact: true }));

    // Zorluk (aria-label: "<Zorluk> zorlukta başla")
    await this.clickGuarded(this.page.getByRole('button', { name: `${difficulty} zorlukta başla` }));
  }

  async continueGame(): Promise<void> {
    await this.continueButton.click();
  }

  async openSettings(): Promise<void> {
    await this.settingsButton.click();
    await expect(this.page.getByRole('heading', { name: 'HARİTA DÜZENİ' })).toBeVisible();
  }

  /** Kayıtlar modalını açar (buton yalnız en az bir yuva varken çizilir). */
  async openSaves(): Promise<void> {
    await this.page.getByRole('button', { name: /^Kayıtlar/ }).click();
    await expect(this.page.getByRole('heading', { name: 'KAYITLAR' })).toBeVisible();
  }

  /** Kayıtlar modalındaki yuva satırları. */
  slotRows() {
    return this.page.getByTestId('save-slot');
  }
}
