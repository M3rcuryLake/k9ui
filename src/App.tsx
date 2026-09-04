import { TelemetryProvider, useTelemetry } from '@/telemetry/TelemetryProvider';
import { Spectrogram } from '@/components/Spectrogram';
import { RoverMap } from '@/components/RoverMap';
import { MotionGraph, BreathingGraph, AiGraph } from '@/components/LiveGraph';
import { TelemetryPanel } from '@/components/TelemetryPanel';
import { Activity, Radio, Cpu } from 'lucide-react';

function HeaderBar() {
  const { telemetry } = useTelemetry();
  const mvsState = telemetry?.mvs.state ?? 'idle';

  const stateColor =
    mvsState === 'confirmed'
      ? '#22d3ee'
      : mvsState === 'detecting'
        ? '#fbbf24'
        : '#64748b';

  return (
    <header className="flex items-center justify-between border-b border-ink-500/30 bg-ink-900/80 px-5 py-2.5 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/10 ring-1 ring-cyan-400/30">
            <Radio className="h-4 w-4 text-cyan-300" />
          </div>
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-glow" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">
            K9Mesh
          </h1>
          <p className="font-mono text-[9px] text-slate-500">
            WiFi-CSI Search &amp; Rescue
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: stateColor, boxShadow: `0 0 6px ${stateColor}` }}
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            MVS: {mvsState}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="h-3 w-3 text-cyan-400" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            Breath: {telemetry?.breath.rate_bpm.toFixed(1) ?? '—'} BPM
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Cpu
            className={`h-3 w-3 ${telemetry?.ml.enabled ? 'text-violet-400' : 'text-slate-600'}`}
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            ML: {telemetry?.ml.enabled ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>
    </header>
  );
}

function Dashboard() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-900">
      <HeaderBar />
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* Main center column — spectrogram + map stacked */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Spectrogram — top 1/3 */}
          <div className="h-[33%] min-h-0">
            <Spectrogram />
          </div>
          {/* Map — bottom 2/3 */}
          <div className="h-[calc(67%-4px)] min-h-0">
            <RoverMap />
          </div>
        </div>

        {/* Right sidebar — graphs + telemetry */}
        <div className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
          <MotionGraph />
          <BreathingGraph />
          <AiGraph />
          <TelemetryPanel />
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <TelemetryProvider>
      <Dashboard />
    </TelemetryProvider>
  );
}

export default App;
