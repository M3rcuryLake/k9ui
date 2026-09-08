import { useCallback, useEffect, useRef, useState } from 'react';

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

interface StartOptions {
  interface?: string;
  calibrationSeconds?: number;
  skipCalibration?: boolean;
}

const BRIDGE_URL = 'http://127.0.0.1:3001';

export function useProcessControl() {
  const [status, setStatus] = useState<ProcessStatus>('stopped');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    async function pollStatus() {
      if (!active) return;
      try {
        const res = await fetch(`${BRIDGE_URL}/api/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active || !mountedRef.current) return;
        if (data.status) {
          setStatus(data.status as ProcessStatus);
        }
        if (data.error) {
          setErrorMsg(data.error);
        }
      } catch {
        // Bridge not reachable — leave status as-is
      }
    }

    const interval = setInterval(pollStatus, 3000);
    return () => {
      active = false;
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const start = useCallback(async (opts?: StartOptions) => {
    setStatus('starting');
    setErrorMsg(null);
    try {
      const res = await fetch(`${BRIDGE_URL}/api/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts || {}),
      });
      const data = await res.json();
      if (!mountedRef.current) return;
      if (data.ok) {
        setStatus(data.status || 'running');
      } else {
        setStatus('error');
        setErrorMsg(data.error || 'Failed to start');
      }
    } catch {
      if (!mountedRef.current) return;
      setStatus('error');
      setErrorMsg(
        'Cannot reach the bridge server. Make sure it is running: npm run bridge'
      );
    }
  }, []);

  const stop = useCallback(async () => {
    setStatus('stopping');
    try {
      const res = await fetch(`${BRIDGE_URL}/api/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!mountedRef.current) return;
      if (data.ok) {
        setStatus(data.status || 'stopped');
      } else {
        setStatus('error');
        setErrorMsg(data.error || 'Failed to stop');
      }
    } catch {
      if (!mountedRef.current) return;
      setStatus('error');
      setErrorMsg(
        'Cannot reach the bridge server. Make sure it is running: npm run bridge'
      );
    }
  }, []);

  return { status, errorMsg, start, stop };
}
