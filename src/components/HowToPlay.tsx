import React from 'react';
import { Globe2, Coins, Swords, Flame, Flag, ShieldCheck, Handshake, Hourglass, X } from 'lucide-react';

// Nasıl Oynanır rehberi: yeni oyuna girişte bir kez gösterilir (save.guideSeen),
// duraklatma menüsünden her zaman tekrar açılabilir. Biçim bilinçli: paragraf
// DEĞİL, taranabilir tek satırlık maddeler — oyuncu okumaz, göz gezdirir.
const SECTIONS: { icon: React.ElementType; color: string; title: string; items: React.ReactNode[] }[] = [
  {
    icon: Coins, color: 'text-yellow-400', title: 'Ekonomini Kur',
    items: [
      <>İline dokun → <b>Sanayi</b> = gelir · <b>Tarım</b> = gelir + ordunun gıdası (ele geçirdiğin bölgeler dahil)</>,
      <>Üst barda <b>HAZİNE / NÜFUS / SALDIRI</b>'ya dokun → kalem kalem döküm</>,
      <>Yüksek vergi → mutsuz halk → zayıf ordu (%0.5 adım; butonu basılı tut = hızlı)</>,
    ],
  },
  {
    icon: Swords, color: 'text-red-400', title: 'Ordunu Yetiştir',
    items: [
      <>İl → <b>Ordu</b>: asker savunur, tank saldırır, uçak bombalar (toprak tutamaz)</>,
      <><b>Ordu Çağır</b> = orduyu tek ile topla; <b>✎</b> ile il/birim/adet seç — tur sonunda varır</>,
      <>Ordu bakım + gıda yer: barışta küçült, savaştan önce büyüt</>,
    ],
  },
  {
    icon: Flame, color: 'text-orange-400', title: 'Savaş ve Fethet',
    items: [
      <>Ülkeye dokun → <b>Savaş İlan Et</b> — panelde bölge sayısı yazar (denizaşırıya liman/uçak şart)</>,
      <>Düşman bölgesi → <b>Taarruz Emri Ver</b> — önizleme kazanma şansını önceden gösterir</>,
      <>Emirler tur sonunda işlenir; vazgeçersen sağ altta <b>Emir Kuyruğu → ✕ İptal</b></>,
      <>Aldığın bölgeye garnizon bırak — boş bölgeyi güçlü düşman geri alır</>,
      <>Tüm bölgeler düşünce ülke fethedilir → ekonomisi sana çalışır</>,
    ],
  },
  {
    icon: Flag, color: 'text-amber-300', title: 'Savaştan Akıllıca Çık',
    items: [
      <><b>İlhakla Bitir</b>: aldıkların sende kalır — düşman zayıf + yorgunsa kabul eder (puan kartta)</>,
      <><b>Geri Çekil</b>: bedelsiz çıkış ama bölgeler iade + prestij düşer</>,
      <>Yorgun düşman barışa hazırsa 🕊️ ile kendisi haber verir</>,
    ],
  },
  {
    icon: ShieldCheck, color: 'text-green-400', title: 'Sınırını Koru',
    items: [
      <>Sınır illerine <b>tabya + hava savunma</b> kur, asker konuşlandır</>,
      <>Ülke panelindeki <b>"saldırı riski"</b> caydırıcılığının yetip yetmediğini söyler</>,
    ],
  },
  {
    icon: Handshake, color: 'text-blue-400', title: 'Diplomasiyi Kullan',
    items: [
      <><b>Ticaret</b> = her tur gelir · <b>Pakt</b> = sınır donar · <b>İttifak</b> = sana saldırana cephe açar · <b>Ültimatom</b> = savaşsız haraç (ilişki −40)</>,
      <>Kilitli anlaşma neyin eksik olduğunu yazar; <b>🎁 Gereken hediyeyi hazırla</b> farkı tek dokunuşla doldurur</>,
      <>Genişledikçe komşular soğur — tek cephede savaş, arkanı anlaşmayla kapat</>,
    ],
  },
  {
    icon: Hourglass, color: 'text-purple-400', title: 'Zamanı İyi Kullan',
    items: [
      <>Komşu ordular her tur büyür: <b>erken savaş ucuz, geç savaş pahalı</b></>,
      <>Art arda savaş yorgunluk biriktirir — fetihler arasında nefes al</>,
    ],
  },
];

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[92dvh]">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors z-10"
          aria-label="Kapat"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-6 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <Globe2 className="w-6 h-6 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.4)]" />
            <h2 className="text-xl font-black tracking-wide text-white">NASIL OYNANIR</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Tur tabanlı strateji (1 tur = 1 ay). Hedef: ekonomini büyüt, ordunu kur, dünyaya hükmet.
          </p>
        </div>

        <div className="px-6 overflow-y-auto flex flex-col gap-2.5 min-h-0">
          {SECTIONS.map((s, i) => (
            <div key={s.title} className="flex gap-3 p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
              <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <span className="text-[9px] font-black text-slate-600">{i + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-slate-100 mb-1">{s.title}</div>
                <ul className="flex flex-col gap-1">
                  {s.items.map((it, j) => (
                    <li key={j} className="text-[11px] leading-snug text-slate-400 flex gap-1.5">
                      <span className="text-slate-600 shrink-0">•</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 pt-3 pb-6 shrink-0">
          <p className="text-[10px] text-slate-500 text-center mb-3">
            İlk fetihe kadar haritanın köşesindeki ipuçları adım adım yol gösterir.
            Bu rehbere menüden her zaman dönebilirsin.
          </p>
          <button
            onClick={onClose}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors shadow-lg shadow-blue-900/20"
          >
            ⚔️ Anladım, Fethe Başla
          </button>
        </div>
      </div>
    </div>
  );
}
