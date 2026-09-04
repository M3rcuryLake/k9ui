import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Telemetry, TelemetryHistory } from '@/types/telemetry';
import {
  generateTelemetry,
  createHistoryTracker,
} from '@/telemetry/mockGenerator';

interface TelemetryContextValue {
  telemetry: Telemetry | null;
  history: TelemetryHistory;
  uptime: number; // seconds
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

const TICK_MS = 200;

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<TelemetryHistory>({
    motion: [],
    breathing: [],
    ai: [],
    spectrogram: [],
  });
  const [uptime, setUptime] = useState(0);
  const trackerRef = useRef(createHistoryTracker());
  const startRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const t = generateTelemetry();
      const hist = trackerRef.current.update(t);
      setTelemetry(t);
      setHistory({
        motion: [...hist.motion],
        breathing: [...hist.breathing],
        ai: [...hist.ai],
        spectrogram: [...hist.spectrogram],
      });
      setUptime(Math.floor((Date.now() - startRef.current) / 1000));
    }, TICK_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <TelemetryContext.Provider value={{ telemetry, history, uptime }}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) {
    throw new Error('useTelemetry must be used within TelemetryProvider');
  }
  return ctx;
}
