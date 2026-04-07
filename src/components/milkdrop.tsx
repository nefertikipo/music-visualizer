"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface MilkdropProps {
  bins: number[];
  loudness: number;
  beatProgress: number;
  isPlaying: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedPresets: Record<string, any> | null = null;

async function loadModules() {
  const butterchurnMod = await import("butterchurn");
  const presetsMod = await import("butterchurn-presets");

  if (!cachedPresets) {
    // butterchurn-presets exports a function with getPresets()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = presetsMod.default ?? presetsMod;
    if (typeof mod === "function" && typeof mod.getPresets === "function") {
      cachedPresets = mod.getPresets();
    } else if (typeof mod.getPresets === "function") {
      cachedPresets = mod.getPresets();
    } else if (typeof mod === "object" && Object.keys(mod).length > 0) {
      cachedPresets = mod;
    } else {
      cachedPresets = {};
    }
  }

  const butterchurn = butterchurnMod.default ?? butterchurnMod;
  return { butterchurn, presets: cachedPresets! };
}

export function MilkdropCanvas({
  bins,
  loudness,
  beatProgress,
}: MilkdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visualizerRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const presetKeysRef = useRef<string[]>([]);
  const presetIndexRef = useRef(0);
  const lastPresetChangeRef = useRef(0);
  const [presetName, setPresetName] = useState("");
  const [ready, setReady] = useState(false);
  const binsRef = useRef(bins);
  const loudnessRef = useRef(loudness);
  const beatProgressRef = useRef(beatProgress);

  useEffect(() => {
    binsRef.current = bins;
    loudnessRef.current = loudness;
    beatProgressRef.current = beatProgress;
  }, [bins, loudness, beatProgress]);

  const initMilkdrop = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || visualizerRef.current) return;

    try {
      const { butterchurn, presets } = await loadModules();

      const keys = Object.keys(presets);
      if (keys.length === 0) {
        console.error("No Milkdrop presets found");
        return;
      }

      // Audio context with synthetic audio driven by Spotify data
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = 0; // silent output

      const bufferSize = 2048;
      const scriptNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);

      scriptNode.onaudioprocess = (e) => {
        const output = e.outputBuffer.getChannelData(0);
        const curBins = binsRef.current;
        const curLoud = loudnessRef.current;
        const curBeat = beatProgressRef.current;

        for (let i = 0; i < bufferSize; i++) {
          const t = i / audioCtx.sampleRate;
          let sample = 0;

          for (let b = 0; b < Math.min(curBins.length, 16); b++) {
            const freq = 60 + b * 200;
            const amp = curBins[b] * curLoud * 0.3;
            sample += Math.sin(2 * Math.PI * freq * t) * amp;
          }

          const beatAmp = (1 - curBeat) * 0.2 * curLoud;
          sample += Math.sin(2 * Math.PI * 80 * t) * beatAmp;
          output[i] = Math.max(-1, Math.min(1, sample));
        }
      };

      scriptNode.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      // Need a source node to keep the script processor alive
      const osc = audioCtx.createOscillator();
      osc.connect(scriptNode);
      osc.start();

      // Create visualizer
      const visualizer = butterchurn.createVisualizer(audioCtx, canvas, {
        width: canvas.width,
        height: canvas.height,
        pixelRatio: window.devicePixelRatio || 1,
        textureRatio: 1,
      });

      visualizerRef.current = visualizer;
      visualizer.connectAudio(analyser);

      presetKeysRef.current = keys;
      const startIdx = Math.floor(Math.random() * keys.length);
      presetIndexRef.current = startIdx;
      visualizer.loadPreset(presets[keys[startIdx]], 0);
      setPresetName(keys[startIdx]);
      setReady(true);
    } catch (err) {
      console.error("Failed to init Milkdrop:", err);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initMilkdrop();

    const handleResize = () => {
      if (canvas && visualizerRef.current) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        visualizerRef.current.setRendererSize(canvas.width, canvas.height);
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", handleResize);
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      visualizerRef.current = null;
    };
  }, [initMilkdrop]);

  // Render loop
  useEffect(() => {
    if (!ready) return;

    function render() {
      const viz = visualizerRef.current;
      if (!viz) return;

      const now = performance.now();

      // Auto-cycle presets every 25s
      if (now - lastPresetChangeRef.current > 25000) {
        lastPresetChangeRef.current = now;
        const keys = presetKeysRef.current;
        if (keys.length > 0 && cachedPresets) {
          presetIndexRef.current =
            (presetIndexRef.current + 1) % keys.length;
          const nextKey = keys[presetIndexRef.current];
          viz.loadPreset(cachedPresets[nextKey], 2.0);
          setPresetName(nextKey);
        }
      }

      viz.render();
      animFrameRef.current = requestAnimationFrame(render);
    }

    lastPresetChangeRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [ready]);

  const loadPresetByOffset = useCallback((offset: number) => {
    const viz = visualizerRef.current;
    const keys = presetKeysRef.current;
    if (!viz || keys.length === 0 || !cachedPresets) return;

    if (offset === 0) {
      presetIndexRef.current = Math.floor(Math.random() * keys.length);
    } else {
      presetIndexRef.current =
        (presetIndexRef.current + offset + keys.length) % keys.length;
    }
    const key = keys[presetIndexRef.current];
    viz.loadPreset(cachedPresets[key], 1.5);
    setPresetName(key);
    lastPresetChangeRef.current = performance.now();
  }, []);

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Preset controls */}
      <div className="absolute top-6 left-6 flex items-center gap-3 z-10">
        <button
          onClick={() => loadPresetByOffset(-1)}
          className="px-2 py-1 bg-black/40 backdrop-blur-sm border border-white/10 rounded text-white/60 font-mono text-xs hover:text-white transition-colors cursor-pointer"
        >
          &#9664;
        </button>
        <button
          onClick={() => loadPresetByOffset(0)}
          className="px-2 py-1 bg-black/40 backdrop-blur-sm border border-white/10 rounded text-white/60 font-mono text-xs hover:text-white transition-colors cursor-pointer"
        >
          &#x27F3;
        </button>
        <button
          onClick={() => loadPresetByOffset(1)}
          className="px-2 py-1 bg-black/40 backdrop-blur-sm border border-white/10 rounded text-white/60 font-mono text-xs hover:text-white transition-colors cursor-pointer"
        >
          &#9654;
        </button>
        {presetName && (
          <span className="text-white/40 font-mono text-[10px] max-w-[300px] truncate">
            {presetName}
          </span>
        )}
      </div>

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          <span className="text-white/30 font-mono text-sm">
            Loading Milkdrop...
          </span>
        </div>
      )}
    </div>
  );
}
