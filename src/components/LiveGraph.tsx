import { useEffect, useRef } from 'react';
import { useTelemetry } from '@/telemetry/TelemetryProvider';
import { useRollingWindow } from '@/telemetry/useRollingWindow';
import { AwaitingSignal } from '@/components/AwaitingSignal';
import { HISTORY_LEN } from '@/telemetry/mockGenerator';

interface GraphProps {
  data: { t: number; value: number | null }[];
  threshold?: number;
  color: string;
  glowColor: string;
  fillColor: string;
  label: string;
  unit: string;
  currentValue: number | string | null;
  secondaryValue?: { label: string; value: string };
  eventMarkers?: { t: number; label: string }[];
  max?: number;
  alarm?: boolean;
  awaiting?: boolean;
}

function LiveGraph({
  data,
  threshold,
  color,
  glowColor,
  fillColor,
  label,
  unit,
  currentValue,
  secondaryValue,
  eventMarkers,
  max = 100,
  alarm = false,
  awaiting = false,
}: GraphProps) {
  const activeColor = alarm ? '#fb7185' : color;
  const activeGlow = alarm ? 'rgba(248, 113, 113, 0.52)' : glowColor;
  const activeFill = alarm ? 'rgba(248, 113, 113, 0.16)' : fillColor;
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    ctx.clearRect(0, 0, rect.width, rect.height);

    const padL = 8;
    const padR = 8;
    const padT = 8;
    const padB = 8;
    const w = rect.width - padL - padR;
    const h = rect.height - padT - padB;

    if (data.length < 2) return;

    const n = data.length;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rect.width, rect.height);
    ctx.clip();

    // Threshold line
    if (threshold !== undefined) {
      const ty = padT + h * (1 - threshold / max);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, ty);
      ctx.lineTo(padL + w, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Build path — null values create gaps in the line
    const points = data.map((d, i) => ({
      x: Math.max(padL, Math.min(padL + w, padL + (i / (n - 1)) * w)),
      y: d.value === null
        ? null
        : Math.max(
            padT,
            Math.min(padT + h, padT + h * (1 - Math.min(Math.max(d.value, 0), max) / max))
          ),
    }));

    // Split into contiguous segments (null values create gaps)
    const segments: { x: number; y: number }[][] = [];
    let currentSegment: { x: number; y: number }[] = [];
    for (const p of points) {
      if (p.y === null) {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
          currentSegment = [];
        }
      } else {
        currentSegment.push({ x: p.x, y: p.y });
      }
    }
    if (currentSegment.length > 0) segments.push(currentSegment);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, padT, 0, padT + h);
    grad.addColorStop(0, activeFill);
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    for (const seg of segments) {
      if (seg.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(seg[0].x, padT + h);
      for (const p of seg) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(seg[seg.length - 1].x, padT + h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Glow stroke (wide, low opacity)
    for (const seg of segments) {
      if (seg.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      for (let i = 1; i < seg.length; i++) {
        ctx.lineTo(seg[i].x, seg[i].y);
      }
      ctx.strokeStyle = activeGlow;
      ctx.lineWidth = 4;
      ctx.shadowBlur = 8;
      ctx.shadowColor = activeGlow;
      ctx.stroke();
    }

    // Main stroke
    ctx.shadowBlur = 0;
    for (const seg of segments) {
      if (seg.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      for (let i = 1; i < seg.length; i++) {
        ctx.lineTo(seg[i].x, seg[i].y);
      }
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Latest point dot — only if last point is real
    const lastPoint = points[points.length - 1];
    if (lastPoint && lastPoint.y !== null) {
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = activeColor;
      ctx.shadowBlur = 10;
      ctx.shadowColor = activeGlow;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Flatline baseline — when awaiting, draw a dim horizontal line at 0
    if (awaiting) {
      const baselineY = padT + h;
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, baselineY);
      ctx.lineTo(padL + w, baselineY);
      ctx.stroke();
    }

    // Event markers
    if (eventMarkers && eventMarkers.length > 0) {
      const now = Date.now();
      const oldest = data[0]?.t ?? now;
      const newest = data[data.length - 1]?.t ?? now;
      const span = newest - oldest || 1;
      for (const evt of eventMarkers) {
        if (evt.t < oldest) continue;
        const ratio = (evt.t - oldest) / span;
        const ex = padL + ratio * w;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ex, padT);
        ctx.lineTo(ex, padT + h);
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [data, threshold, activeColor, activeGlow, activeFill, eventMarkers, max, awaiting]);

  const displayValue =
    typeof currentValue === 'number'
      ? currentValue.toFixed(1)
      : currentValue ?? '—';

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border p-5 transition-all duration-300 hover:border-ink-400/40 ${
        alarm
          ? 'border-red-400/50 bg-red-950/20 shadow-[0_0_24px_rgba(248,113,113,0.12)]'
          : 'border-ink-500/30 bg-ink-800/60'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              {label}
            </span>
            {alarm && (
              <span className="animate-pulse rounded-full border border-red-400/50 bg-red-400/10 px-1.5 py-0.5 font-mono text-[8px] font-semibold tracking-widest text-red-300">
                ALERT
              </span>
            )}
          </div>
          {secondaryValue && (
            <div className="mt-1 font-mono text-[10px] text-slate-500">
              {secondaryValue.label}: {secondaryValue.value}
            </div>
          )}
        </div>
        <div className="text-right">
          <span
            className="font-mono text-3xl font-semibold tabular-nums"
            style={{ color: activeColor }}
          >
            {displayValue}
          </span>
          <span className="ml-1 font-mono text-[10px] text-slate-500">
            {unit}
          </span>
        </div>
      </div>
      <div className="relative mt-5 h-24 overflow-hidden rounded-md">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block h-full w-full"
          style={{ clipPath: 'inset(0)' }}
        />
        {awaiting && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <AwaitingSignal />
          </div>
        )}
      </div>
    </div>
  );
}

export function MotionGraph() {
  const { telemetry, connectionStatus } = useTelemetry();
  const data = useRollingWindow('motion', HISTORY_LEN);
  const awaiting = connectionStatus === 'awaiting' && !telemetry;
  return (
    <LiveGraph
      data={data}
      awaiting={awaiting}
      threshold={50}
      color="#22d3ee"
      glowColor="rgba(34, 211, 238, 0.4)"
      fillColor="rgba(34, 211, 238, 0.12)"
      label="Motion Confidence"
      unit="%"
      currentValue={telemetry?.mvs.confidence ?? null}
      alarm={Boolean(telemetry && telemetry.mvs.confidence > 50)}
      secondaryValue={{
        label: 'Var',
        value: `${telemetry?.mvs.variance.toFixed(2) ?? '—'} / ${telemetry?.mvs.threshold.toFixed(2) ?? '—'}`,
      }}
    />
  );
}

export function BreathingGraph() {
  const { telemetry, connectionStatus } = useTelemetry();
  const data = useRollingWindow('breathing', HISTORY_LEN);
  const awaiting = connectionStatus === 'awaiting' && !telemetry;
  return (
    <LiveGraph
      data={data}
      awaiting={awaiting}
      threshold={50}
      color="#fbbf24"
      glowColor="rgba(251, 191, 36, 0.4)"
      fillColor="rgba(251, 191, 36, 0.12)"
      label="Breathing Confidence"
      unit="%"
      currentValue={telemetry?.breath.confidence ?? null}
      alarm={Boolean(telemetry && telemetry.breath.confidence > 50)}
      secondaryValue={{
        label: 'Rate',
        value: `${telemetry?.breath.rate_bpm.toFixed(1) ?? '—'} BPM · SNR ${telemetry?.breath.snr.toFixed(1) ?? '—'}`,
      }}
    />
  );
}

export function AiGraph() {
  const { telemetry, connectionStatus } = useTelemetry();
  const data = useRollingWindow('ai', HISTORY_LEN);
  const awaiting = connectionStatus === 'awaiting' && !telemetry;
  const events = data
    .filter((d) => d.value !== null)
    .map((d) => ({ t: d.t, label: 'event' }));
  return (
    <LiveGraph
      data={data}
      threshold={50}
      color="#a78bfa"
      glowColor="rgba(167, 139, 250, 0.4)"
      fillColor="rgba(167, 139, 250, 0.12)"
      label="AI / ML Score"
      unit="%"
      currentValue={telemetry?.ml.score ?? null}
      secondaryValue={{
        label: 'Detection',
        value: telemetry?.ml.detection ?? 'scanning…',
      }}
      eventMarkers={events}
      awaiting={awaiting}
    />
  );
}
