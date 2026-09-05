/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import * as topojson from 'topojson-client';
import { Globe2, WifiOff } from 'lucide-react';
import { log } from './log';
import { GameUI } from './components/GameUI';
import { MainMenu } from './components/MainMenu';
import { GameSave, Difficulty } from './engine/types';
import { loadSave, loadSlot, newGame, startNewSlot, hasSave, listSaveSlots, deleteSlot } from './engine/save';
import { setWorldGeo, buildActiveWorld } from './engine/activeWorld';
import { setProvinceData } from './engine/provinceData';

// Tam ekran "dünya kuruluyor" göstergesi: dönen küre + metin. Ağır dünya kurulumu
// ana iş parçacığını kilitler; bu ekran o kilitten ÖNCE çizilir, oyuncu tepkisiz
// bir butona değil, ilerleyen bir yükleyiciye bakar.
function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="w-full h-dvh font-sans bg-slate-950 flex flex-col items-center justify-center gap-4 text-slate-400">
      <Globe2 className="w-12 h-12 text-amber-400 animate-spin drop-shadow-[0_0_14px_rgba(251,191,36,0.45)]" style={{ animationDuration: '1.5s' }} />
      <span className="text-sm tracking-wide">{text}</span>
    </div>
  );
}

export default function App() {
  const [game, setGame] = useState<GameSave | null>(null);
  const [sessionId, setSessionId] = useState(0);
  // Coğrafya yüklemesi: ülke sınırları ZORUNLUDUR — başarısız olursa oyun
  // kurulamayacağından hata ekranı + yeniden deneme sunulur (sessiz bozulma yok).
  const [geoStatus, setGeoStatus] = useState<'yukleniyor' | 'hazir' | 'hata'>('yukleniyor');
  // Dünya kurulurken (yeni oyun / devam) tam ekran yükleyici göster
  const [building, setBuilding] = useState(false);

  // Dünya coğrafyası + gerçek il sınırları (paralel). Ülke verisi zorunlu,
  // il verisi opsiyonel (yoksa render prosedürel sınırlara düşer).
  const loadGeo = useCallback(() => {
    setGeoStatus('yukleniyor');
    const countries = fetch('data/countries-50m.json').then(r => {
      if (!r.ok) throw new Error(`countries-50m.json ${r.status}`);
      return r.json();
    }).then(world => setWorldGeo(topojson.feature(world, world.objects.countries)));
    const provinces = fetch('data/provinces.json').then(r => r.json())
      .then(data => setProvinceData(data))
      .catch(err => log.warn('İl sınırları yüklenemedi (prosedürele düşülüyor)', err));
    Promise.all([countries, provinces])
      .then(() => setGeoStatus('hazir'))
      .catch(err => {
        log.error('Dünya coğrafyası yüklenemedi', err);
        setGeoStatus('hata');
      });
  }, []);
  useEffect(loadGeo, [loadGeo]);

  // Ağır (senkron, ana iş parçacığını kilitleyen) dünya kurulumunu, yükleyici
  // ekranı BOYANDIKTAN sonra çalıştırır. Çift requestAnimationFrame: ilk kare
  // yükleyiciyi devreye alır, ikinci kare tarayıcının onu ekrana çizmesini
  // garantiler; ağır iş ancak ondan sonra başlar → buton asla "ölü" hissettirmez.
  const runAfterPaint = (work: () => void) => {
    setBuilding(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { work(); } finally { setBuilding(false); }
    }));
  };

  // Kayıt silme sonrası menü listesi tazelensin diye sürüm sayacı
  const [slotsVersion, setSlotsVersion] = useState(0);

  const openSave = (saved: GameSave | null) => {
    if (!saved) return;
    runAfterPaint(() => {
      buildActiveWorld(saved.mapLayout); // kaydın düzeninde dünyayı kur
      setGame(saved);
      setSessionId(id => id + 1);
    });
  };

  const handleContinue = () => openSave(loadSave());          // en son oynanan yuva
  const handleLoadSlot = (id: string) => openSave(loadSlot(id)); // seçilen yuva

  const handleDeleteSlot = (id: string) => {
    deleteSlot(id);
    setSlotsVersion(v => v + 1);
  };

  const handleNewGame = (difficulty: Difficulty, countryId: string, color: string) => {
    runAfterPaint(() => {
      // Yeni oyun YENİ yuvada başlar — mevcut kayıtlar silinmez
      const save = newGame(difficulty, countryId, color); // dünyayı newGame kurar
      startNewSlot(save);
      setGame(save);
      setSessionId(id => id + 1);
    });
  };

  if (geoStatus === 'yukleniyor') return <LoadingScreen text="Dünya yükleniyor…" />;
  if (geoStatus === 'hata') {
    return (
      <div className="w-full h-dvh font-sans bg-slate-950 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <WifiOff className="w-12 h-12 text-amber-400" />
        <h1 className="text-slate-100 text-lg font-semibold">Dünya haritası yüklenemedi</h1>
        <p className="text-slate-400 text-sm max-w-md">
          Harita verisine ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.
        </p>
        <button
          onClick={loadGeo}
          className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold transition-colors"
        >
          Tekrar Dene
        </button>
      </div>
    );
  }
  if (building) return <LoadingScreen text="Dünya kuruluyor…" />;

  return (
    <div className="w-full h-dvh font-sans bg-slate-950">
      {game ? (
        <GameUI
          key={sessionId}
          initialSave={game}
          onExitToMenu={() => setGame(null)}
        />
      ) : (
        <MainMenu
          hasSave={hasSave()}
          slots={listSaveSlots()}
          onContinue={handleContinue}
          onNewGame={handleNewGame}
          onLoadSlot={handleLoadSlot}
          onDeleteSlot={handleDeleteSlot}
        />
      )}
    </div>
  );
}
