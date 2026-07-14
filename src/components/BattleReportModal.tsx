import React from 'react';
import { BattleReport } from '../engine/types';
import { formatCount } from '../engine/economy';
import { X, Swords, Shield, Plane, Trophy, Flag, AlertTriangle } from 'lucide-react';

interface BattleReportModalProps {
  reports: BattleReport[];
  onClose: () => void;
}

const RESULT_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; bgClass: string }> = {
  ongoing: { label: 'Savaş Devam Ediyor', color: 'text-yellow-300', icon: <Swords className="w-4 h-4" />, bgClass: 'border-yellow-700/60' },
  conquest: { label: 'Fetih!', color: 'text-amber-300', icon: <Trophy className="w-4 h-4" />, bgClass: 'border-amber-600/60' },
  repelled: { label: 'Düşman Püskürtüldü!', color: 'text-green-300', icon: <Shield className="w-4 h-4" />, bgClass: 'border-green-600/60' },
  peace: { label: 'Zorunlu Barış', color: 'text-blue-300', icon: <Flag className="w-4 h-4" />, bgClass: 'border-blue-600/60' },
  occupation: { label: 'İl İşgal Edildi!', color: 'text-orange-300', icon: <AlertTriangle className="w-4 h-4" />, bgClass: 'border-orange-600/60' },
  attrition: { label: 'Yıpratma Savaşı', color: 'text-yellow-300', icon: <Swords className="w-4 h-4" />, bgClass: 'border-yellow-700/60' },
  attack_failed: { label: 'Taarruz Kırıldı!', color: 'text-red-300', icon: <AlertTriangle className="w-4 h-4" />, bgClass: 'border-red-600/60' },
  meeting: { label: 'Sınır Muharebesi!', color: 'text-purple-300', icon: <Swords className="w-4 h-4" />, bgClass: 'border-purple-600/60' },
};

export function BattleReportModal({ reports, onClose }: BattleReportModalProps) {
  if (reports.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="panel-in relative bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        {/* Başlık */}
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h2 className="text-lg font-black tracking-wider text-white flex items-center gap-2">
            <Swords className="w-5 h-5 text-red-400" />
            SAVAŞ RAPORU — Tur {reports[0]?.turn}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            title="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Raporlar listesi */}
        <div className="flex-1 overflow-y-auto space-y-3 -mr-1 pr-1">
          {reports.map((report, idx) => {
            const cfg = RESULT_CONFIG[report.result] || RESULT_CONFIG.ongoing;
            const enemyPctDestroyed = report.enemyArmyBefore > 0
              ? Math.round((report.enemyLoss / report.enemyArmyBefore) * 100)
              : 0;
            const playerPctLost = report.playerArmyBefore > 0
              ? Math.round((report.playerLoss / report.playerArmyBefore) * 100)
              : 0;

            return (
              <div
                key={`${report.countryId}-${idx}`}
                className={`bg-slate-950/60 border rounded-xl p-3.5 ${cfg.bgClass}`}
              >
                {/* Ülke adı ve sonuç */}
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-sm ${cfg.color}`}>
                      {report.countryName}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {report.initiator === 'ai' ? '(saldıran)' : '(saldırıyoruz)'}
                    </span>
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs font-bold ${cfg.color}`}>
                    {cfg.icon}
                    {cfg.label}
                  </div>
                </div>

                {/* Güç karşılaştırması tablosu */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {/* Ordumuz */}
                  <div className="bg-slate-900/80 rounded-lg p-2.5 border border-slate-800">
                    <div className="text-[9px] text-blue-400 font-bold uppercase tracking-wider mb-1.5">🇹🇷 Ordumuz</div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                      <span>Savaş Öncesi:</span>
                      <span className="font-mono text-slate-300">{formatCount(report.playerArmyBefore)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                      <span>Savaş Sonrası:</span>
                      <span className="font-mono text-slate-300">{formatCount(report.playerArmyAfter)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-red-400 font-medium">Zayiat:</span>
                      <span className="font-mono text-red-400 font-bold">
                        -{formatCount(report.playerLoss)} ({playerPctLost}%)
                      </span>
                    </div>
                    {report.planesLost > 0 && (
                      <div className="flex items-center gap-1 text-[10px] text-purple-400">
                        <Plane className="w-3 h-3" />
                        <span>{report.planesLost} uçak kaybedildi</span>
                      </div>
                    )}
                  </div>

                  {/* Düşman */}
                  <div className="bg-slate-900/80 rounded-lg p-2.5 border border-slate-800">
                    <div className="text-[9px] text-red-400 font-bold uppercase tracking-wider mb-1.5">⚔️ Düşman</div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                      <span>Savaş Öncesi:</span>
                      <span className="font-mono text-slate-300">{formatCount(report.enemyArmyBefore)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                      <span>Savaş Sonrası:</span>
                      <span className="font-mono text-slate-300">{formatCount(report.enemyArmyAfter)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-green-400 font-medium">Verilen Hasar:</span>
                      <span className="font-mono text-green-400 font-bold">
                        -{formatCount(report.enemyLoss)} ({enemyPctDestroyed}%)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Düşman güç barı */}
                <div className="mb-1">
                  <div className="flex justify-between text-[9px] text-slate-500 mb-0.5">
                    <span>Düşman Gücü</span>
                    <span className="font-mono">
                      {formatCount(report.enemyArmyAfter)} / {formatCount(report.enemyArmyBefore)}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        report.result === 'conquest' || report.result === 'repelled'
                          ? 'bg-green-500'
                          : report.result === 'occupation'
                          ? 'bg-orange-500'
                          : 'bg-red-500'
                      }`}
                      style={{
                        width: `${report.enemyArmyBefore > 0 ? Math.round((report.enemyArmyAfter / report.enemyArmyBefore) * 100) : 0}%`
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Alt buton */}
        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors shrink-0"
        >
          Tamam
        </button>
      </div>
    </div>
  );
}
