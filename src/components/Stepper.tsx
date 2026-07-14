import React, { useRef } from 'react';
import { Minus, Plus } from 'lucide-react';

interface StepperProps {
  value: number | string;
  step: number;
  format: (v: number) => string;
  onStep: (delta: number) => void;
}

// Klavyesiz sayı girişi: dokun = 1 adım, basılı tut = hızlanarak artar.
export function Stepper({ value, step, format, onStep }: StepperProps) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ticksRef = useRef(0);

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    ticksRef.current = 0;
  };

  const start = (dir: 1 | -1) => {
    stop();
    onStep(dir * step);
    timerRef.current = setInterval(() => {
      ticksRef.current += 1;
      const mult = ticksRef.current > 25 ? 50 : ticksRef.current > 10 ? 10 : 1;
      onStep(dir * step * mult);
    }, 120);
  };

  const val = parseInt(value?.toString() || '0') || 0;
  const btnClass = 'w-7 h-7 flex items-center justify-center rounded bg-slate-800 border border-slate-700 text-slate-300 active:bg-blue-800 active:border-blue-600 disabled:opacity-30 select-none';

  return (
    <div className="flex items-center gap-1" style={{ touchAction: 'manipulation' }}>
      <button
        type="button"
        aria-label="Azalt"
        onPointerDown={() => start(-1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={e => e.preventDefault()}
        disabled={val <= 0}
        className={btnClass}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <div className={`w-16 py-1 px-1 text-xs text-center font-mono rounded border bg-slate-950 select-none ${val > 0 ? 'text-white border-blue-700' : 'text-slate-500 border-slate-700'}`}>
        {val > 0 ? format(val) : '0'}
      </div>
      <button
        type="button"
        aria-label="Artır"
        onPointerDown={() => start(1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={e => e.preventDefault()}
        className={btnClass}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
