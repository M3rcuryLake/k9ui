import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTelemetry } from '@/telemetry/TelemetryProvider';
import { poseToLatLng, GPS_ORIGIN } from '@/telemetry/mockGenerator';

// Meters to degrees
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos((GPS_ORIGIN.latitude * Math.PI) / 180);

// Zoom level for ~50m view
const MAP_ZOOM = 18;

// Rover marker icon (SVG directional puck)
function createRoverIcon(theta: number, stale: boolean): L.DivIcon {
  const color = stale ? '#64748b' : '#22d3ee';
  const glowColor = stale ? '#475569' : '#22d3ee';
  const svg = `
    <div style="transform: rotate(${theta}deg); transition: transform 0.3s ease;">
      <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <radialGradient id="halo">
            <stop offset="0%" stop-color="${glowColor}" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="${glowColor}" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="18" cy="18" r="16" fill="url(#halo)"/>
        <g filter="url(#glow)">
          <path d="M18 6 L24 24 L18 20 L12 24 Z" fill="${color}" stroke="${glowColor}" stroke-width="1.5" opacity="${stale ? 0.5 : 1}"/>
        </g>
        <circle cx="18" cy="18" r="2" fill="${stale ? '#94a3b8' : '#fff'}"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    html: svg,
    className: 'rover-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

export function RoverMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const roverMarkerRef = useRef<L.Marker | null>(null);
  const moveCircleRef = useRef<L.Circle | null>(null);
  const breathCircleRef = useRef<L.Circle | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const trailPointsRef = useRef<{ lat: number; lng: number }[]>([]);
  const sweepMarkerRef = useRef<L.Marker | null>(null);
  const [stale, setStale] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  const { telemetry } = useTelemetry();

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [GPS_ORIGIN.latitude, GPS_ORIGIN.longitude],
      zoom: MAP_ZOOM,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 22,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position: GeolocationPosition) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setUserLocation(location);
          map.setView([location.lat, location.lng], MAP_ZOOM, { animate: true });
        },
        () => {
          // Keep the fixed mock origin when location access is unavailable.
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    }

    // Rover marker
    const roverIcon = createRoverIcon(0, false);
    const roverMarker = L.marker([GPS_ORIGIN.latitude, GPS_ORIGIN.longitude], {
      icon: roverIcon,
      zIndexOffset: 1000,
    }).addTo(map);

    // Movement circle — 12m radius for visibility in 50m² map
    const moveCircle = L.circle(
      [GPS_ORIGIN.latitude, GPS_ORIGIN.longitude],
      {
        radius: 12,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0,
        weight: 1.5,
        opacity: 0,
      }
    ).addTo(map);

    // Breathing circle — 8m radius
    const breathCircle = L.circle(
      [GPS_ORIGIN.latitude, GPS_ORIGIN.longitude],
      {
        radius: 8,
        color: '#fbbf24',
        fillColor: '#fbbf24',
        fillOpacity: 0,
        weight: 1.5,
        opacity: 0,
      }
    ).addTo(map);

    // Trail line
    const trail = L.polyline([], {
      color: '#22d3ee',
      weight: 2,
      opacity: 0.4,
      dashArray: '4,6',
    }).addTo(map);

    mapRef.current = map;
    roverMarkerRef.current = roverMarker;
    moveCircleRef.current = moveCircle;
    breathCircleRef.current = breathCircle;
    trailRef.current = trail;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep the map focused on the browser's current location.
  useEffect(() => {
    if (!userLocation || !mapRef.current) return;
    mapRef.current.setView([userLocation.lat, userLocation.lng], MAP_ZOOM, {
      animate: true,
    });
  }, [userLocation]);

  // Update from telemetry
  useEffect(() => {
    if (!telemetry || !mapRef.current || !roverMarkerRef.current) return;

    const origin = userLocation
      ? { latitude: userLocation.lat, longitude: userLocation.lng }
      : telemetry.gps_origin;
    const pos = poseToLatLng(telemetry.pose, origin);
    const map = mapRef.current;
    const rover = roverMarkerRef.current;
    const moveCircle = moveCircleRef.current;
    const breathCircle = breathCircleRef.current;
    const trail = trailRef.current;

    // Stale state
    setStale(telemetry.stale);

    // Update rover icon (rotation + stale)
    rover.setIcon(createRoverIcon(telemetry.pose.theta_deg, telemetry.stale));

    // Smooth move
    rover.setLatLng([pos.lat, pos.lng]);
    sweepMarkerRef.current?.setLatLng([pos.lat, pos.lng]);

    // Trail
    if (!telemetry.stale) {
      trailPointsRef.current.push({ lat: pos.lat, lng: pos.lng });
      if (trailPointsRef.current.length > 200) trailPointsRef.current.shift();
      trail?.setLatLngs(trailPointsRef.current);
    }

    // Movement overlay
    const moveConf = telemetry.mvs.confidence;
    if (moveConf > 50 && moveCircle) {
      const opacity = ((moveConf - 50) / 50) * 0.45;
      moveCircle.setLatLng([pos.lat, pos.lng]);
      moveCircle.setStyle({
        fillOpacity: opacity,
        opacity: opacity * 0.7,
        weight: 1.5,
      });
    } else if (moveCircle) {
      moveCircle.setStyle({ fillOpacity: 0, opacity: 0 });
    }

    // Breathing overlay
    const breathConf = telemetry.breath.confidence;
    if (breathConf > 50 && breathCircle) {
      const opacity = ((breathConf - 50) / 50) * 0.45;
      breathCircle.setLatLng([pos.lat, pos.lng]);
      breathCircle.setStyle({
        fillOpacity: opacity,
        opacity: opacity * 0.7,
        weight: 1.5,
      });
    } else if (breathCircle) {
      breathCircle.setStyle({ fillOpacity: 0, opacity: 0 });
    }
  }, [telemetry, userLocation]);

  // Radar sweep — a marker-based div that stays glued to the rover
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sweepSize = 120;
    const sweepIcon = L.divIcon({
      className: 'radar-sweep',
      html: `<div style="width:${sweepSize}px;height:${sweepSize}px;">
        <svg width="${sweepSize}" height="${sweepSize}" viewBox="0 0 100 100" style="animation: radar-sweep 4s linear infinite;">
          <defs>
            <radialGradient id="sweep-bg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.06"/>
              <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.5"/>
              <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="48" fill="url(#sweep-bg)"/>
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(34,211,238,0.12)" stroke-width="0.5"/>
          <path d="M50 50 L50 2 A48 48 0 0 1 98 50 Z" fill="url(#sweep-grad)"/>
        </svg>
      </div>`,
      iconSize: [sweepSize, sweepSize],
      iconAnchor: [sweepSize / 2, sweepSize / 2],
    });

    const sweepMarker = L.marker([GPS_ORIGIN.latitude, GPS_ORIGIN.longitude], {
      icon: sweepIcon,
      interactive: false,
      zIndexOffset: 500,
    }).addTo(map);

    sweepMarkerRef.current = sweepMarker;

    return () => {
      sweepMarker.remove();
      sweepMarkerRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-ink-500/40 bg-ink-800">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Header overlay */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-[500] flex items-start justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-medium tracking-wide text-slate-200">
            Rover Position — Live Map
          </h2>
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">
            {(userLocation?.lat ?? telemetry?.gps_origin.latitude)?.toFixed(4)}, {(userLocation?.lng ?? telemetry?.gps_origin.longitude)?.toFixed(4)} · 50m × 50m · GPS
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stale && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              <span className="font-mono text-[10px] text-amber-300">STALE</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-500/5 px-2.5 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            <span className="font-mono text-[10px] text-cyan-300">
              {telemetry?.pose.x.toFixed(1)}, {telemetry?.pose.y.toFixed(1)}m · {telemetry?.pose.theta_deg.toFixed(0)}°
            </span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-[500] flex flex-col gap-1.5 rounded-lg border border-ink-500/40 bg-ink-900/80 px-3 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-glow" />
          <span className="font-mono text-[10px] text-slate-400">Rover</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500/60" />
          <span className="font-mono text-[10px] text-slate-400">Movement</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
          <span className="font-mono text-[10px] text-slate-400">Breathing</span>
        </div>
      </div>

      {/* Gradient vignette */}
      <div className="pointer-events-none absolute inset-0 z-[450] rounded-xl shadow-inner-glow" />
    </div>
  );
}
