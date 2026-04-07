"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { MilkdropCanvas } from "@/components/milkdrop";

interface SpotifySegment {
  start: number;
  duration: number;
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  pitches: number[];
  timbre: number[];
}

interface SpotifyBeat {
  start: number;
  duration: number;
  confidence: number;
}

interface SpotifySection {
  start: number;
  duration: number;
  loudness: number;
  tempo: number;
  key: number;
  mode: number;
}

interface AudioAnalysis {
  segments: SpotifySegment[];
  beats: SpotifyBeat[];
  bars: { start: number; duration: number; confidence: number }[];
  sections: SpotifySection[];
  tatums: { start: number; duration: number; confidence: number }[];
}

interface AudioFeatures {
  energy: number;
  danceability: number;
  valence: number;
  tempo: number;
}

interface AnalysisData {
  analysis: AudioAnalysis | null;
  features: AudioFeatures | null;
}

type VisualizationMode = "bars" | "milkdrop" | "scope";

const MODE_NAMES: Record<VisualizationMode, string> = {
  bars: "Bars & Waves",
  milkdrop: "Milkdrop 2",
  scope: "Scope",
};

// Exact Winamp/WMP default VISCOLOR.TXT spectrum analyzer colors
// Row 0 = background, Row 1 = dots, Rows 2-17 = spectrum (top to bottom)
// Row 23 = peak dots
const SPEC_BG: [number, number, number] = [0, 0, 0];
const SPEC_DOTS: [number, number, number] = [24, 33, 41];
const SPEC_PEAK: [number, number, number] = [150, 150, 150];

// Rows 2 (top/red) to 17 (bottom/green) - the 16 spectrum bar colors
const SPEC_COLORS: [number, number, number][] = [
  [239, 49, 16],   // 2  - top (red)
  [206, 41, 16],   // 3
  [214, 90, 0],    // 4
  [214, 102, 0],   // 5
  [214, 115, 0],   // 6
  [198, 123, 8],   // 7
  [222, 165, 24],  // 8
  [214, 181, 33],  // 9
  [189, 222, 41],  // 10
  [148, 222, 33],  // 11
  [41, 206, 16],   // 12
  [50, 190, 16],   // 13
  [57, 181, 16],   // 14
  [49, 156, 8],    // 15
  [41, 148, 0],    // 16
  [24, 132, 8],    // 17 - bottom (dark green)
];

// Oscilloscope colors (rows 18-22, bright to dim)
const OSC_COLORS: [number, number, number][] = [
  [255, 255, 255],
  [214, 214, 222],
  [181, 189, 189],
  [160, 170, 175],
  [148, 156, 165],
];


function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function getCurrentSegment(
  segments: SpotifySegment[],
  progressSec: number
): SpotifySegment | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (progressSec >= segments[i].start) return segments[i];
  }
  return segments[0] ?? null;
}

function getCurrentBeat(
  beats: SpotifyBeat[],
  progressSec: number
): { beat: SpotifyBeat | null; beatProgress: number } {
  for (let i = beats.length - 1; i >= 0; i--) {
    if (progressSec >= beats[i].start) {
      const elapsed = progressSec - beats[i].start;
      const progress = Math.min(1, elapsed / beats[i].duration);
      return { beat: beats[i], beatProgress: progress };
    }
  }
  return { beat: null, beatProgress: 0 };
}

function getCurrentSection(
  sections: SpotifySection[],
  progressSec: number
): SpotifySection | null {
  for (let i = sections.length - 1; i >= 0; i--) {
    if (progressSec >= sections[i].start) return sections[i];
  }
  return sections[0] ?? null;
}

// Generate fake frequency bins from segment data
function getFrequencyBins(
  segment: SpotifySegment,
  beatProgress: number,
  binCount: number
): number[] {
  const bins: number[] = [];
  const loudnessNorm = Math.max(
    0,
    Math.min(1, (segment.loudness_max + 60) / 60)
  );
  const beatPulse = 1 - smoothstep(0, 0.3, beatProgress);

  for (let i = 0; i < binCount; i++) {
    const pitchIdx = Math.floor((i / binCount) * 12);
    const pitchVal = segment.pitches[pitchIdx] ?? 0.5;
    const timbreIdx = Math.min(Math.floor((i / binCount) * 12), 11);
    const timbreVal =
      Math.max(0, Math.min(1, (segment.timbre[timbreIdx] + 100) / 200)) ?? 0.5;

    const base = loudnessNorm * 0.6 + pitchVal * 0.25 + timbreVal * 0.15;
    const withBeat = base + beatPulse * 0.3 * segment.pitches[pitchIdx];
    bins.push(Math.max(0, Math.min(1, withBeat)));
  }
  return bins;
}

// ---- Bars & Waves renderer (WMP style) ----
// WMP Bars: solid yellow-green bars, no segments, black background,
// many thin columns packed together. Color is a smooth gradient from
// green at bottom to yellow-green at top.

function drawBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bins: number[],
  smoothedBins: number[],
  peakBins: number[],
  _time: number
) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  const barCount = bins.length;
  const gap = 1;
  const barWidth = Math.max(2, (w - gap * (barCount + 1)) / barCount);
  const maxBarHeight = h * 0.85;
  const bottomY = h * 0.95;

  for (let i = 0; i < barCount; i++) {
    // Smooth (attack fast, release slow)
    const target = bins[i];
    if (target > smoothedBins[i]) {
      smoothedBins[i] = lerp(smoothedBins[i], target, 0.4);
    } else {
      smoothedBins[i] = lerp(smoothedBins[i], target, 0.08);
    }

    // Peak with gravity
    if (smoothedBins[i] > peakBins[i]) {
      peakBins[i] = smoothedBins[i];
    } else {
      peakBins[i] = Math.max(0, peakBins[i] - 0.007);
    }

    const barHeight = smoothedBins[i] * maxBarHeight;
    const x = gap + i * (barWidth + gap);
    const topY = bottomY - barHeight;

    // Solid bar with gradient: green at bottom -> yellow-green at top
    // This is the classic WMP yellow-green look
    const gradient = ctx.createLinearGradient(x, bottomY, x, topY);
    gradient.addColorStop(0, "rgb(24, 132, 8)");     // dark green at base
    gradient.addColorStop(0.3, "rgb(50, 190, 16)");   // green
    gradient.addColorStop(0.6, "rgb(148, 222, 33)");   // yellow-green
    gradient.addColorStop(0.85, "rgb(214, 181, 33)");  // yellow
    gradient.addColorStop(1, "rgb(239, 49, 16)");      // red at very top

    ctx.fillStyle = gradient;
    ctx.fillRect(x, topY, barWidth, barHeight);
  }
}

// ---- Scope renderer (exact Winamp oscilloscope) ----
// Uses VISCOLOR rows 18-22: white at peaks, dimmer gray at troughs
function drawScope(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bins: number[],
  time: number,
  beatProgress: number,
  loudness: number
) {
  // Black background (viscolor row 0)
  const [bgR, bgG, bgB] = SPEC_BG;
  ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
  ctx.fillRect(0, 0, w, h);

  const centerY = h / 2;
  const amplitude = h * 0.38 * Math.max(0.15, loudness);

  // Draw the waveform using oscilloscope colors
  // Winamp draws each pixel column with a color based on distance from center
  // OSC_COLORS[0] = peak (white), OSC_COLORS[4] = center (dim gray)
  const [cr, cg, cb] = OSC_COLORS[0]; // main line color (white)

  ctx.beginPath();
  ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
  ctx.lineWidth = 1.5;

  const points: number[] = [];
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const binIdx = Math.floor(t * bins.length);
    const binVal = bins[binIdx] ?? 0.5;

    const wave1 = Math.sin(t * Math.PI * 8 + time * 3) * binVal;
    const wave2 = Math.sin(t * Math.PI * 14 + time * 4.5) * binVal * 0.4;
    const wave3 =
      Math.sin(t * Math.PI * 4 + time * 1.8) * (1 - beatProgress) * 0.25;

    const y = centerY + (wave1 + wave2 + wave3) * amplitude;
    points.push(y);

    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Draw a second slightly dimmer line for the Winamp "thickness" effect
  ctx.beginPath();
  const [dr, dg, db] = OSC_COLORS[2];
  ctx.strokeStyle = `rgb(${dr},${dg},${db})`;
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x++) {
    const y = points[x] + 1;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Dot grid background (viscolor row 1) - subtle dots like Winamp
  const [dtR, dtG, dtB] = SPEC_DOTS;
  ctx.fillStyle = `rgb(${dtR},${dtG},${dtB})`;
  const dotSpacing = 4;
  for (let dx = 0; dx < w; dx += dotSpacing) {
    for (let dy = 0; dy < h; dy += dotSpacing) {
      ctx.fillRect(dx, dy, 1, 1);
    }
  }
}


// ---- Idle visualization (no music) ----
function drawIdle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number
) {
  const cx = w / 2;
  const cy = h / 2;

  // Slow pulsing rings
  for (let i = 0; i < 5; i++) {
    const phase = time * 0.5 + i * 0.8;
    const radius = 30 + i * 25 + Math.sin(phase) * 10;
    const alpha = 0.1 + Math.sin(phase + 1) * 0.05;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.font = "14px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Waiting for music...", cx, cy + 100);
}

// ---- Demo mode: generate fake music data ----
function generateDemoSegment(time: number): SpotifySegment {
  // Simulate a dynamic track with varying energy
  const beatPhase = (time * 2.1) % 1; // ~126 BPM
  const sectionPhase = Math.sin(time * 0.15) * 0.5 + 0.5; // slow energy wave
  const drop = Math.sin(time * 0.08) > 0.3 ? 1 : 0.4; // fake drops

  const baseLoudness = -20 + sectionPhase * 15 + drop * 5;
  const pitches: number[] = [];
  const timbre: number[] = [];

  for (let i = 0; i < 12; i++) {
    // Pitches shift over time to simulate melody/chord changes
    const melodyCycle = Math.sin(time * 0.7 + i * 0.5) * 0.4 + 0.5;
    const kick = i < 3 ? (1 - beatPhase) * 0.6 : 0;
    pitches.push(Math.max(0, Math.min(1, melodyCycle + kick)));

    // Timbre varies per section
    timbre.push(
      Math.sin(time * 0.3 + i * 1.2) * 80 + Math.cos(time * 0.5 + i) * 30
    );
  }

  return {
    start: time,
    duration: 0.05,
    loudness_start: baseLoudness - 5,
    loudness_max: baseLoudness,
    loudness_max_time: 0.02,
    pitches,
    timbre,
  };
}

function getDemoBeatProgress(time: number): number {
  const bps = 2.1; // ~126 BPM
  return (time * bps) % 1;
}

function getDemoLoudness(time: number): number {
  const sectionPhase = Math.sin(time * 0.15) * 0.5 + 0.5;
  const drop = Math.sin(time * 0.08) > 0.3 ? 1 : 0.5;
  return Math.max(0.3, Math.min(1, sectionPhase * 0.7 + drop * 0.3));
}

function getDemoSection(time: number): SpotifySection {
  const idx = Math.floor(time * 0.05) % 12;
  return {
    start: 0,
    duration: 20,
    loudness: -10,
    tempo: 126,
    key: idx,
    mode: 1,
  };
}

export function Visualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const smoothedBinsRef = useRef<number[]>([]);
  const peakBinsRef = useRef<number[]>([]);
  const analysisRef = useRef<AnalysisData>({ analysis: null, features: null });
  const progressRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const lastPollRef = useRef(0);
  const trackIdRef = useRef<string | null>(null);
  const timestampRef = useRef(0);
  const lastProgressUpdateRef = useRef(0);
  const [mode, setMode] = useState<VisualizationMode>("bars");
  const [trackInfo, setTrackInfo] = useState<{
    name: string;
    artist: string;
    albumArt: string;
  } | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  // Milkdrop audio data (shared via state so the Milkdrop component can read it)
  const milkdropBinsRef = useRef<number[]>(new Array(32).fill(0));
  const milkdropLoudnessRef = useRef(0);
  const milkdropBeatRef = useRef(0);
  const [milkdropData, setMilkdropData] = useState({
    bins: new Array(32).fill(0) as number[],
    loudness: 0,
    beatProgress: 0,
  });
  const isDemoRef = useRef(false);
  const modeRef = useRef<VisualizationMode>("bars");

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    isDemoRef.current = isDemo;
  }, [isDemo]);

  const pollNowPlaying = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/now-playing");
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      setIsAuthenticated(true);

      const data = await res.json();
      if (!data.is_playing || !data.item) {
        isPlayingRef.current = false;
        setTrackInfo(null);
        return;
      }

      isPlayingRef.current = true;
      progressRef.current = data.progress_ms / 1000;
      lastProgressUpdateRef.current = performance.now();

      setTrackInfo({
        name: data.item.name,
        artist: data.item.artists.map((a: { name: string }) => a.name).join(", "),
        albumArt: data.item.album?.images?.[0]?.url ?? "",
      });

      // Fetch analysis if track changed
      if (data.item.id !== trackIdRef.current) {
        trackIdRef.current = data.item.id;
        const analysisRes = await fetch(
          `/api/spotify/audio-analysis?trackId=${data.item.id}`
        );
        if (analysisRes.ok) {
          analysisRef.current = await analysisRes.json();
        }
      }
    } catch {
      // Silently retry next poll
    }
  }, []);

  useEffect(() => {
    // Initial poll (skip in demo mode)
    if (!isDemo) {
      pollNowPlaying();
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const BIN_COUNT = 32;
    if (smoothedBinsRef.current.length !== BIN_COUNT) {
      smoothedBinsRef.current = new Array(BIN_COUNT).fill(0);
      peakBinsRef.current = new Array(BIN_COUNT).fill(0);
    }

    function render() {
      const now = performance.now();
      timestampRef.current = now / 1000;
      const time = timestampRef.current;
      const w = canvas!.width;
      const h = canvas!.height;

      const demo = isDemoRef.current;

      let segment: SpotifySegment | null = null;
      let beatProgress = 0;
      let loudness = 0;
      let section: SpotifySection | null = null;

      if (demo) {
        // Demo mode: generate fake data from time
        segment = generateDemoSegment(time);
        beatProgress = getDemoBeatProgress(time);
        loudness = getDemoLoudness(time);
        section = getDemoSection(time);
      } else {
        // Poll Spotify every 2 seconds
        if (now - lastPollRef.current > 2000) {
          lastPollRef.current = now;
          pollNowPlaying();
        }

        // Estimate current progress (interpolate between polls)
        const elapsed = (now - lastProgressUpdateRef.current) / 1000;
        const estimatedProgress = isPlayingRef.current
          ? progressRef.current + elapsed
          : progressRef.current;

        const analysis = analysisRef.current.analysis;

        if (!isPlayingRef.current || !analysis) {
          drawIdle(ctx, w, h, time);
          animFrameRef.current = requestAnimationFrame(render);
          return;
        }

        segment = getCurrentSegment(analysis.segments, estimatedProgress);
        const beatData = getCurrentBeat(analysis.beats, estimatedProgress);
        beatProgress = beatData.beatProgress;
        section = getCurrentSection(analysis.sections, estimatedProgress);

        if (!segment) {
          drawIdle(ctx, w, h, time);
          animFrameRef.current = requestAnimationFrame(render);
          return;
        }

        loudness = Math.max(0, Math.min(1, (segment.loudness_max + 60) / 60));
      }

      const bins = getFrequencyBins(segment!, beatProgress, BIN_COUNT);

      const currentMode = modeRef.current;

      if (currentMode === "milkdrop") {
        // Feed data to milkdrop (update refs, batch state updates)
        milkdropBinsRef.current = bins;
        milkdropLoudnessRef.current = loudness;
        milkdropBeatRef.current = beatProgress;
        // Throttle React state updates to ~15fps to avoid perf issues
        if (Math.floor(now / 66) !== Math.floor((now - 16) / 66)) {
          setMilkdropData({ bins, loudness, beatProgress });
        }
        // Clear canvas (milkdrop renders on its own canvas)
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      } else if (currentMode === "bars") {
        drawBars(
          ctx, w, h, bins,
          smoothedBinsRef.current,
          peakBinsRef.current,
          time
        );
      } else if (currentMode === "scope") {
        drawScope(ctx, w, h, bins, time, beatProgress, loudness);
      }

      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [pollNowPlaying, isDemo]);

  const cycleMode = useCallback(() => {
    setMode((prev) => {
      const modes: VisualizationMode[] = ["bars", "milkdrop", "scope"];
      const next = modes[(modes.indexOf(prev) + 1) % modes.length];
      return next;
    });
  }, []);

  if (isAuthenticated === false && !isDemo) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black text-white gap-6">
        <div className="text-2xl font-mono tracking-wider opacity-70">
          Music Visualizer
        </div>
        <a
          href="/api/spotify/login"
          className="px-6 py-3 bg-[#1DB954] text-black font-bold rounded-full hover:bg-[#1ed760] transition-colors font-mono"
        >
          Connect Spotify
        </a>
        <button
          onClick={() => setIsDemo(true)}
          className="px-6 py-3 border border-white/20 text-white/60 rounded-full hover:text-white hover:border-white/40 transition-colors font-mono text-sm cursor-pointer"
        >
          Preview Demo
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ display: mode === "milkdrop" ? "none" : "block" }}
      />

      {/* Milkdrop (Butterchurn) - rendered in its own WebGL canvas */}
      {mode === "milkdrop" && (
        <MilkdropCanvas
          bins={milkdropData.bins}
          loudness={milkdropData.loudness}
          beatProgress={milkdropData.beatProgress}
          isPlaying={isPlayingRef.current || isDemo}
        />
      )}

      {/* Track info overlay (bottom left, WMP style) */}
      {(trackInfo || isDemo) && (
        <div className="absolute bottom-6 left-6 flex items-center gap-4 bg-black/50 backdrop-blur-sm rounded px-4 py-3 border border-white/10">
          {trackInfo?.albumArt && (
            <img
              src={trackInfo.albumArt}
              alt="Album art"
              className="w-12 h-12 rounded"
            />
          )}
          <div className="font-mono">
            <div className="text-white text-sm font-bold truncate max-w-[250px]">
              {isDemo ? "Demo Mode" : trackInfo?.name}
            </div>
            <div className="text-white/60 text-xs truncate max-w-[250px]">
              {isDemo ? "Simulated playback" : trackInfo?.artist}
            </div>
          </div>
        </div>
      )}

      {/* Demo label */}
      {isDemo && (
        <button
          onClick={() => setIsDemo(false)}
          className="absolute top-6 right-6 px-3 py-1.5 bg-white/10 border border-white/20 rounded text-white/50 font-mono text-xs hover:text-white hover:border-white/40 transition-colors cursor-pointer"
        >
          Exit Demo
        </button>
      )}

      {/* Mode switcher (bottom right) */}
      <button
        onClick={cycleMode}
        className="absolute bottom-6 right-6 px-4 py-2 bg-black/50 backdrop-blur-sm border border-white/10 rounded text-white/70 font-mono text-xs hover:text-white hover:border-white/30 transition-colors cursor-pointer"
      >
        {MODE_NAMES[mode]}
      </button>
    </div>
  );
}
