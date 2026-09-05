// =============================================================================
// Üretim loglama altyapısı — tek doğru kaynak.
//
// Neden var: prod build'de rastgele console.log kirliliği istemiyoruz ama
// ÇÖKME ve beklenmedik hataların izini de kaybetmek istemiyoruz. Bu modül:
//   - info: yalnız DEV'de konsola yazar (prod'da sessiz)
//   - warn/error: her ortamda konsola yazar (cihazda chrome://inspect ve
//     adb logcat üzerinden görünür — saha teşhisinin tek kanalı)
//   - Son 200 kayıt bellek içi halkada tutulur; ErrorBoundary çökme ekranında
//     "hata ayrıntısı"nı bu halkadan gösterebilir.
//
// Oyun hiçbir yere veri GÖNDERMEZ (ağ çağrısı yok) — halka yalnız yereldir.
// =============================================================================

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  t: number;        // Date.now()
  level: LogLevel;
  msg: string;
  detail?: string;  // stack / ek bağlam (String()'e indirgenmiş)
}

const MAX_ENTRIES = 200;
const buffer: LogEntry[] = [];

function toDetail(x: unknown): string | undefined {
  if (x == null) return undefined;
  if (x instanceof Error) return x.stack ?? `${x.name}: ${x.message}`;
  try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); }
}

function push(level: LogLevel, msg: string, detail?: unknown): void {
  buffer.push({ t: Date.now(), level, msg, detail: toDetail(detail) });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  if (level === 'error') console.error(`[hegemon] ${msg}`, detail ?? '');
  else if (level === 'warn') console.warn(`[hegemon] ${msg}`, detail ?? '');
  else if (import.meta.env.DEV) console.info(`[hegemon] ${msg}`, detail ?? '');
}

export const log = {
  info: (msg: string, detail?: unknown) => push('info', msg, detail),
  warn: (msg: string, detail?: unknown) => push('warn', msg, detail),
  error: (msg: string, detail?: unknown) => push('error', msg, detail),
  /** Halkanın anlık kopyası (ErrorBoundary "ayrıntı" bölümü okur). */
  entries: (): LogEntry[] => [...buffer],
};

// Yakalanmamış hatalar ve reddedilen promise'ler halkaya düşsün.
// main.tsx bir kez çağırır; iki kez çağrılırsa ikincisi sessizce yok sayılır.
let installed = false;
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    log.error(`Yakalanmamış hata: ${e.message}`, e.error ?? `${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    log.error('Yakalanmamış promise reddi', e.reason);
  });
}
