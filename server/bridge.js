import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const REST_PORT = 3001;
const WS_PORT = 8080;

const app = express();
app.use(cors());
app.use(express.json());

let childProc = null;
let status = 'stopped';
let errorMsg = null;

// ── WebSocket telemetry server ──────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT }, () => {
  console.log(`[bridge] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);
});

let seq = 10000;
const startTime = Date.now();

// Rover simulation state
let poseX = 0, poseY = 0, theta = 0, speed = 0, turnRate = 0;
let phase = 'idle', phaseTimer = 0;
let rssi = -52, dropped = 0, temp = 38.5;
let breathBpm = 18, breathSnr = 8;
let mlScore = 30, mlDetection = null, mlDetectionTimer = 0;

const GPS_ORIGIN = { latitude: 12.9716, longitude: 77.5946 };
const SPECTRUM_BINS = 12;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function noise(amp) { return (Math.random() - 0.5) * 2 * amp; }

function advancePhase() {
  phaseTimer--;
  if (phaseTimer > 0) return;
  const r = Math.random();
  if (phase === 'idle') {
    phase = r < 0.6 ? 'idle' : 'moving';
    phaseTimer = 40 + Math.floor(Math.random() * 60);
  } else if (phase === 'moving') {
    phase = r < 0.3 ? 'detected' : r < 0.6 ? 'breathing' : 'idle';
    phaseTimer = 60 + Math.floor(Math.random() * 80);
  } else if (phase === 'detected') {
    phase = r < 0.4 ? 'breathing' : 'idle';
    phaseTimer = 50 + Math.floor(Math.random() * 60);
  } else {
    phase = r < 0.3 ? 'breathing' : 'idle';
    phaseTimer = 50 + Math.floor(Math.random() * 70);
  }
}

function genSpectrumRow() {
  const row = [];
  const hasEvent = phase === 'detected' || phase === 'breathing';
  const eventBand = 4 + Math.floor(Math.random() * 4);
  const eventWidth = phase === 'breathing' ? 1 : 3;
  for (let i = 0; i < SPECTRUM_BINS; i++) {
    let v = Math.random() * 0.12;
    v += Math.sin(i * 0.3 + phaseTimer * 0.1) * 0.04;
    if (hasEvent && Math.abs(i - eventBand) < eventWidth) {
      const dist = Math.abs(i - eventBand);
      const intensity = (1 - dist / eventWidth) * (0.6 + Math.random() * 0.4);
      v += intensity;
    }
    if (Math.random() < 0.01) v += 0.3;
    const intensity = clamp(v, 0, 1);
    row.push([Math.round(intensity * 255), Math.round(intensity * 220), Math.round(intensity * 180)]);
  }
  return row;
}

function generateTelemetry() {
  advancePhase();
  if (phase === 'moving' || phase === 'detected') {
    speed = lerp(speed, 0.3 + Math.random() * 0.2, 0.1);
    turnRate = lerp(turnRate, noise(2), 0.05);
  } else {
    speed = lerp(speed, 0.02, 0.1);
    turnRate = lerp(turnRate, noise(0.5), 0.05);
  }
  theta += turnRate;
  if (theta > 360) theta -= 360;
  if (theta < 0) theta += 360;
  const rad = (theta * Math.PI) / 180;
  poseX += Math.cos(rad) * speed;
  poseY += Math.sin(rad) * speed;
  const distFromOrigin = Math.sqrt(poseX * poseX + poseY * poseY);
  if (distFromOrigin > 18) turnRate += 5;
  rssi = clamp(rssi + noise(1.5), -75, -35);
  if (Math.random() < 0.02) dropped++;
  const isStale = Math.random() < 0.008;
  temp = clamp(temp + noise(0.3), 35, 55);

  let mvsVariance = noise(0.5) + 0.5;
  let mvsConfidence = clamp(Math.random() * 15, 0, 100);
  let mvsState = 'idle';
  if (phase === 'detected') {
    mvsVariance = 5 + Math.random() * 4;
    mvsConfidence = clamp(60 + Math.random() * 35, 0, 100);
    mvsState = 'confirmed';
  } else if (phase === 'moving') {
    mvsVariance = 2 + Math.random() * 2;
    mvsConfidence = clamp(30 + Math.random() * 30, 0, 100);
    mvsState = 'detecting';
  }

  let breathConfidence = clamp(Math.random() * 20, 0, 100);
  if (phase === 'breathing') {
    breathBpm = lerp(breathBpm, 14 + Math.random() * 8, 0.05);
    breathSnr = lerp(breathSnr, 8 + Math.random() * 6, 0.05);
    breathConfidence = clamp(55 + Math.random() * 40, 0, 100);
  } else {
    breathBpm = lerp(breathBpm, 16 + Math.random() * 4, 0.02);
    breathSnr = lerp(breathSnr, 3 + Math.random() * 3, 0.02);
  }

  mlScore = clamp(lerp(mlScore, 20 + Math.random() * 30, 0.1), 0, 100);
  if (phase === 'detected' || phase === 'breathing') {
    mlScore = clamp(mlScore + 20 + Math.random() * 20, 0, 100);
  }
  mlDetectionTimer--;
  if (mlDetectionTimer <= 0) mlDetection = null;
  if ((phase === 'detected' || phase === 'breathing') && Math.random() < 0.05) {
    mlDetection = phase === 'breathing' ? 'VITAL_SIGNS' : 'MOTION_ENTITY';
    mlDetectionTimer = 15;
  }

  seq++;
  const elapsed = Date.now() - startTime;

  return {
    seq,
    timestamp_us: elapsed * 1000,
    channel: 3,
    rssi: Math.round(rssi),
    dropped,
    band: [11, 12, 13, 14, 15, 16, 17, 43, 48, 50, 51, 52],
    temperature_c: parseFloat(temp.toFixed(1)),
    mvs: { state: mvsState, variance: parseFloat(mvsVariance.toFixed(2)), threshold: 5.22, confidence: parseFloat(mvsConfidence.toFixed(1)) },
    ml: { ready: true, score: parseFloat(mlScore.toFixed(1)), detection: mlDetection, enabled: true },
    breath: { rate_bpm: parseFloat(breathBpm.toFixed(1)), snr: parseFloat(breathSnr.toFixed(1)), confidence: parseFloat(breathConfidence.toFixed(1)) },
    pose: { x: parseFloat(poseX.toFixed(2)), y: parseFloat(poseY.toFixed(2)), theta_deg: parseFloat(theta.toFixed(1)) },
    gps_origin: GPS_ORIGIN,
    csi_spectrogram_row: genSpectrumRow(),
    stale: isStale,
  };
}

let broadcastInterval = null;

function startBroadcasting() {
  if (broadcastInterval) return;
  broadcastInterval = setInterval(() => {
    const data = JSON.stringify(generateTelemetry());
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(data);
    });
  }, 200);
}

function stopBroadcasting() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
  }
}

wss.on('connection', (ws) => {
  console.log('[bridge] WebSocket client connected');
  ws.on('close', () => console.log('[bridge] WebSocket client disconnected'));
});

// ── REST control endpoints ──────────────────────────────────

app.post('/api/start', (req, res) => {
  if (childProc) {
    return res.json({ ok: true, status, message: 'already running' });
  }

  const { interface: iface, calibrationSeconds, skipCalibration } = req.body || {};
  const args = [];
  if (iface) args.push(`--interface=${iface}`);
  if (calibrationSeconds != null) args.push(`--calibration=${calibrationSeconds}`);
  if (skipCalibration) args.push('--skip-calibration');

  status = 'starting';
  errorMsg = null;

  try {
    childProc = spawn(join(projectRoot, 'runner.sh'), args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    status = 'running';

    childProc.stdout.on('data', (data) => {
      process.stdout.write(`[runner] ${data}`);
    });

    childProc.stderr.on('data', (data) => {
      process.stderr.write(`[runner:err] ${data}`);
    });

    childProc.on('exit', (code) => {
      console.log(`[bridge] runner.sh exited with code ${code}`);
      childProc = null;
      status = 'stopped';
      stopBroadcasting();
    });

    childProc.on('error', (err) => {
      console.error('[bridge] Failed to spawn runner.sh:', err.message);
      childProc = null;
      status = 'error';
      errorMsg = err.message;
      stopBroadcasting();
    });

    startBroadcasting();
    res.json({ ok: true, status });
  } catch (err) {
    status = 'error';
    errorMsg = err.message;
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/stop', (req, res) => {
  if (!childProc) {
    return res.json({ ok: true, status: 'stopped', message: 'not running' });
  }

  status = 'stopping';
  try {
    childProc.kill('SIGTERM');
    childProc = null;
    status = 'stopped';
    stopBroadcasting();
    res.json({ ok: true, status });
  } catch (err) {
    status = 'error';
    errorMsg = err.message;
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ status, error: errorMsg });
});

app.listen(REST_PORT, () => {
  console.log(`[bridge] REST control API listening on http://127.0.0.1:${REST_PORT}`);
});
