import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { log } from '../log';

// =============================================================================
// Üst seviye çökme siperi: render sırasında fırlayan HERHANGİ bir hata beyaz
// ekran yerine bu panele düşer. Kayıt her state değişiminde localStorage'a
// yazıldığından (GameUI persistSave effect'i) oyuncunun ilerlemesi güvendedir —
// panel bunu açıkça söyler ve tek dokunuşla yeniden yükleme sunar.
// =============================================================================

interface Props { children: React.ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.error('React render hatası (ErrorBoundary)', error);
    if (info.componentStack) log.error('Bileşen yığını', info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="w-full h-dvh font-sans bg-slate-950 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-400" />
        <h1 className="text-slate-100 text-lg font-semibold">Beklenmedik bir hata oluştu</h1>
        <p className="text-slate-400 text-sm max-w-md">
          Oyun kaydınız güvende — ilerleme her turda otomatik kaydedilir.
          Yeniden yükleyip kaldığınız yerden devam edebilirsiniz.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold transition-colors"
        >
          <RotateCcw className="w-4 h-4" /> Yeniden Yükle
        </button>
        <details className="text-left max-w-md w-full">
          <summary className="text-slate-600 text-xs cursor-pointer">Hata ayrıntısı</summary>
          <pre className="mt-2 p-3 rounded bg-slate-900 text-slate-500 text-[10px] overflow-auto max-h-40 whitespace-pre-wrap">
            {this.state.error.stack ?? String(this.state.error)}
          </pre>
        </details>
      </div>
    );
  }
}
