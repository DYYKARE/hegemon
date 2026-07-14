/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import * as topojson from 'topojson-client';
import { GameUI } from './components/GameUI';
import { MainMenu } from './components/MainMenu';
import { GameSave, Difficulty } from './engine/types';
import { loadSave, newGame, clearSave, hasSave } from './engine/save';
import { setWorldGeo, buildActiveWorld } from './engine/activeWorld';
import { setProvinceData } from './engine/provinceData';

export default function App() {
  const [game, setGame] = useState<GameSave | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const [geoReady, setGeoReady] = useState(false);

  // Dünya coğrafyası + gerçek il sınırları bir kez yüklenir (paralel)
  useEffect(() => {
    const countries = fetch('data/countries-50m.json').then(r => r.json())
      .then(world => setWorldGeo(topojson.feature(world, world.objects.countries)));
    // Gerçek admin-1 il verisi (büyük; başarısız olursa render prosedürele düşer)
    const provinces = fetch('data/provinces.json').then(r => r.json())
      .then(data => setProvinceData(data)).catch(() => {});
    Promise.all([countries, provinces]).finally(() => setGeoReady(true));
  }, []);

  const handleContinue = () => {
    const saved = loadSave();
    if (saved) {
      buildActiveWorld(saved.mapLayout); // kaydın düzeninde dünyayı kur
      setGame(saved);
      setSessionId(id => id + 1);
    }
  };

  const handleNewGame = (difficulty: Difficulty, countryId: string) => {
    clearSave();
    setGame(newGame(difficulty, countryId)); // dünyayı newGame kurar
    setSessionId(id => id + 1);
  };

  if (!geoReady) {
    return (
      <div className="w-full h-dvh font-sans bg-slate-950 flex items-center justify-center text-slate-400">
        Dünya yükleniyor…
      </div>
    );
  }

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
          onContinue={handleContinue}
          onNewGame={handleNewGame}
        />
      )}
    </div>
  );
}
