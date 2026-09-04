import { useEffect, useRef } from 'react';
import { useTelemetry } from '@/telemetry/TelemetryProvider';
import { SPECTRUM_BINS, SPECTROGRAM_COLS } from '@/telemetry/mockGenerator';
import { AwaitingSignal } from '@/components/AwaitingSignal';

// Colormap: black → dark blue → blue → cyan → green → yellow → orange → red → white
function heatColor(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.08) {
    const f = t / 0.08;
    return [Math.round(f * 6), Math.round(f * 4), Math.round(f * 20)];
  } else if (t < 0.2) {
    const f = (t - 0.08) / 0.12;
    return [Math.round(6 + f * 4), Math.round(4 + f * 30), Math.round(20 + f * 100)];
  } else if (t < 0.38) {
    const f = (t - 0.2) / 0.18;
    return [Math.round(10 - f * 8), Math.round(34 + f * 140), Math.round(120 + f * 80)];
  } else if (t < 0.55) {
    const f = (t - 0.38) / 0.17;
    return [Math.round(2 + f * 40), Math.round(174 + f * 60), Math.round(200 - f * 140)];
  } else if (t < 0.72) {
    const f = (t - 0.55) / 0.17;
    return [Math.round(42 + f * 180), Math.round(234 - f * 80), Math.round(60 - f * 40)];
  } else if (t < 0.88) {
    const f = (t - 0.72) / 0.16;
    return [Math.round(222 + f * 33), Math.round(154 - f * 100), Math.round(20 + f * 10)];
  } else {
    const f = (t - 0.88) / 0.12;
    return [255, Math.round(54 + f * 180), Math.round(30 + f * 200)];
  }
}

export function Spectrogram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { telemetry, history, connectionStatus } = useTelemetry();
  const spectrogram = history.spectrogram;

  const isAwaiting = connectionStatus === 'awaiting' && !telemetry;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const cols = spectrogram.length;
    if (cols === 0) return;

    const colWidth = rect.width / SPECTROGRAM_COLS;
    const rowHeight = rect.height / SPECTRUM_BINS;

    // Draw waterfall — newest on right, scrolling left
    const startCol = Math.max(0, cols - SPECTROGRAM_COLS);
    for (let c = startCol; c < cols; c++) {
      const row = spectrogram[c];
      const xPos = (c - startCol) * colWidth;
      for (let r = 0; r < SPECTRUM_BINS; r++) {
        const v = row[r] || 0;
        const [cr, cg, cb] = heatColor(v);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        const yPos = rect.height - (r + 1) * rowHeight;
        ctx.fillRect(xPos, yPos, colWidth + 0.5, rowHeight + 0.5);
      }
    }

    // Glow overlay on bright regions
    ctx.globalCompositeOperation = 'screen';
    for (let c = startCol; c < cols; c++) {
      const row = spectrogram[c];
      const xPos = (c - startCol) * colWidth;
      for (let r = 0; r < SPECTRUM_BINS; r++) {
        const v = row[r] || 0;
        if (v > 0.45) {
          const [cr, cg, cb] = heatColor(v);
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.25)`;
          const yPos = rect.height - (r + 1) * rowHeight;
          ctx.fillRect(xPos - 1, yPos - 1, colWidth + 2, rowHeight + 2);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // Horizontal grid lines
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = (rect.height / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }
  }, [spectrogram]);

  const displayWindows = spectrogram.length;
  const bandFirst = telemetry?.band[0] ?? 11;
  const bandLast = telemetry ? telemetry.band[telemetry.band.length - 1] : 52;

  if (isAwaiting) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-xl border border-ink-500/40 bg-ink-900">
        <AwaitingSignal />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-ink-500/40 bg-ink-900">
      {/* Header */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-start justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">
            Live CSI Spectrogram
          </h2>
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            Subcarriers {bandFirst}–{bandLast} · CH {telemetry?.channel ?? 3} · 0–10 Hz
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/5 px-2.5 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            <span className="font-mono text-[10px] text-cyan-300">
              {displayWindows} windows
            </span>
          </div>
        </div>
      </div>

      {/* Y-axis labels */}
      <div className="absolute left-1.5 top-12 z-10 flex h-[calc(100%-3.5rem)] flex-col justify-between py-1">
        {[10, 8, 6, 4, 2, 0].map((freq) => (
          <span key={freq} className="font-mono text-[9px] text-slate-600">
            {freq}Hz
          </span>
        ))}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute left-7 top-12 h-[calc(100%-3.5rem)] w-[calc(100%-2rem)]"
      />

      {/* Top fade */}
      <div className="pointer-events-none absolute left-7 right-0 top-0 h-12 bg-gradient-to-b from-ink-900 to-transparent" />
      {/* Bottom fade */}
      <div className="pointer-events-none absolute bottom-0 left-7 right-0 h-6 bg-gradient-to-t from-ink-900 to-transparent" />
    </div>
  );
}
