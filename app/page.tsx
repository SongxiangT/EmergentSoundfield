"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

type Experiment = "sand" | "fire" | "lotka" | "cyclic" | "gh";
type DriveMode = "auto" | "hybrid" | "manual";
type Features = {
  rms: number;
  low: number;
  mid: number;
  high: number;
  onset: number;
  centroid: number;
  tempo: number;
};
type Emotion = {
  arousal: number;
  valence: number;
  tension: number;
  stability: number;
};
type SpectrumName = "earth" | "thermal" | "ocean" | "neon" | "aurora" | "magma" | "violet" | "ice" | "solar" | "mono";

const SPECTRUMS: Record<SpectrumName, string[]> = {
  earth: ["#071516", "#183f38", "#3b7858", "#e3b65e", "#ff714b"],
  thermal: ["#100b18", "#47204f", "#b83f5d", "#ff8b38", "#fff0a6"],
  ocean: ["#04151f", "#0d4257", "#168a9e", "#75d6bd", "#e6fff3"],
  neon: ["#080711", "#38236c", "#00b8a9", "#d8f62b", "#ff3b81"],
  aurora: ["#06131c", "#173e6a", "#24a489", "#8df0b2", "#e4d4ff"],
  magma: ["#120608", "#4c0b18", "#b62629", "#ff7b22", "#ffe48a"],
  violet: ["#0d0918", "#2c1952", "#6943a4", "#c47ee8", "#ffe5ff"],
  ice: ["#06141c", "#153e55", "#4a91ad", "#a8e4ee", "#f4ffff"],
  solar: ["#161006", "#5e3510", "#c66b15", "#ffc23d", "#fff7c2"],
  mono: ["#050807", "#26302d", "#60716b", "#b7c3bd", "#ffffff"],
};

const DEFAULT_SIZE = 64;
const DEFAULT_FEATURES: Features = {
  rms: 0,
  low: 0,
  mid: 0,
  high: 0,
  onset: 0,
  centroid: 0,
  tempo: 0,
};
const DEFAULT_EMOTION: Emotion = {
  arousal: 0.5,
  valence: 0.5,
  tension: 0.3,
  stability: 0.7,
};

type StudySample = {
  time: number;
  entropy: number;
  energy: number;
  arousal: number;
  eventSize: number;
  critical: number;
  prey: number;
  predator: number;
};
type MusicReport = {
  count: number;
  meanEntropy: number;
  maxEntropy: number;
  correlation: number;
  lowMean: number;
  highMean: number;
  tScore: number;
  pApprox: number;
  sufficient: boolean;
  duration: number;
  peakEvent: number;
  eventCount: number;
  fingerprint: string;
  samples: StudySample[];
};

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function fmtTime(value: number) {
  if (!Number.isFinite(value)) return "00:00";
  const m = Math.floor(value / 60);
  const s = Math.floor(value % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtMissionTime(value: number) {
  const total = Math.max(0, Math.floor(value));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

function classifyMissionEvent(entry: string) {
  if (entry.includes("新火点")) return { type: "Fire Burst", tone: "fire" };
  if (entry.includes("种群坍塌")) return { type: "Boundary Collapse", tone: "collapse" };
  if (entry.includes("雪崩")) {
    const size = Number(entry.match(/规模\s*(\d+)/)?.[1] ?? 0);
    return size >= 100 ? { type: "Mega Avalanche", tone: "mega" } : { type: "Avalanche", tone: "avalanche" };
  }
  if (entry.includes("重置") || entry.includes("待命") || entry.includes("初始化")) {
    return { type: "Recovery", tone: "recovery" };
  }
  return { type: "Local Criticality", tone: "critical" };
}

function MetricBar({
  label,
  value,
  color,
  text,
}: {
  label: string;
  value: number;
  color: string;
  text?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        <span>{label}</span>
        <strong>{text ?? value.toFixed(2)}</strong>
      </div>
      <div className="track">
        <i style={{ width: `${Math.min(100, value * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chaosCanvasRef = useRef<HTMLCanvasElement>(null);
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);
  const reportTimelineRef = useRef<HTMLCanvasElement>(null);
  const reportScatterRef = useRef<HTMLCanvasElement>(null);
  const reportPhaseRef = useRef<HTMLCanvasElement>(null);
  const pixelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const gridRef = useRef<Uint8Array>(new Uint8Array(DEFAULT_SIZE * DEFAULT_SIZE));
  const ageRef = useRef<Uint8Array>(new Uint8Array(DEFAULT_SIZE * DEFAULT_SIZE));
  const chaosRef = useRef<number[]>(Array(120).fill(0));
  const studyRef = useRef<StudySample[]>([]);
  const rafRef = useRef(0);
  const lastGridDrawRef = useRef(0);
  const randRef = useRef(seeded(2607));
  const lastBeatRef = useRef(0);
  const lastSpectrumSwitchRef = useRef(0);
  const lastAudioSnapshotRef = useRef({ low: 0, mid: 0, high: 0, rms: 0 });
  const visualRandRef = useRef(seeded(9017));
  const lotkaRef = useRef({ prey: 0.62, predator: 0.26 });
  const slowRef = useRef(DEFAULT_EMOTION);
  const metricsRef = useRef({ events: 0, max: 0, active: 0, critical: 0, entropy: 0 });

  const [experiment, setExperiment] = useState<Experiment>("sand");
  const [mode, setMode] = useState<DriveMode>("auto");
  const [preset, setPreset] = useState<"safe" | "critical">("safe");
  const [seed, setSeed] = useState(2607);
  const [gain, setGain] = useState(72);
  const [gridSize, setGridSize] = useState(DEFAULT_SIZE);
  const [customSize, setCustomSize] = useState(96);
  const [spectrum, setSpectrum] = useState<SpectrumName | "random">("earth");
  const [randomSpectrum, setRandomSpectrum] = useState<SpectrumName>("aurora");
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [edgeOpacity, setEdgeOpacity] = useState(72);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [running, setRunning] = useState(false);
  const [fileName, setFileName] = useState("国风-2 · 原创内置曲");
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [current, setCurrent] = useState(0);
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  const [emotion, setEmotion] = useState(DEFAULT_EMOTION);
  const [stats, setStats] = useState({ events: 0, max: 0, active: 0, critical: 0, entropy: 0 });
  const [mappingEnabled, setMappingEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`map-${i}`, true])),
  );
  const [log, setLog] = useState<string[]>([
    "系统初始化：随机种子 2607",
    "沙堆引擎待命 · Safe Preset",
  ]);
  const [error, setError] = useState("");
  const [report, setReport] = useState<MusicReport | null>(null);

  const resetWorld = useCallback(
    (nextExperiment = experiment, nextSeed = seed, nextSize = gridSize) => {
      randRef.current = seeded(nextSeed);
      const grid = new Uint8Array(nextSize * nextSize);
      const age = new Uint8Array(nextSize * nextSize);
      const random = randRef.current;
      if (nextExperiment === "sand") {
        for (let i = 0; i < grid.length; i++) {
          grid[i] = random() > 0.18 ? Math.floor(random() * 4) : 0;
        }
      } else if (nextExperiment === "fire") {
        for (let i = 0; i < grid.length; i++) {
          const p = random();
          grid[i] = p < 0.68 ? 1 : p < 0.75 ? 3 : 0;
          age[i] = Math.floor(random() * 120);
        }
      } else if (nextExperiment === "lotka") {
        lotkaRef.current = { prey: 0.62, predator: 0.26 };
        for (let i = 0; i < grid.length; i++) {
          const p = random();
          grid[i] = p < 0.62 ? 1 : p < 0.88 ? 2 : 0;
        }
      } else if (nextExperiment === "cyclic") {
        for (let i = 0; i < grid.length; i++) grid[i] = Math.floor(random() * 8);
      } else {
        for (let i = 0; i < grid.length; i++) grid[i] = random() < 0.035 ? 1 : random() < 0.08 ? 2 + Math.floor(random() * 7) : 0;
      }
      gridRef.current = grid;
      ageRef.current = age;
      chaosRef.current = Array(120).fill(0);
      studyRef.current = [];
      setReport(null);
      metricsRef.current = { events: 0, max: 0, active: 0, critical: 0, entropy: 0 };
      setStats({ events: 0, max: 0, active: 0, critical: 0, entropy: 0 });
      setLog([
        `世界重置：${nextExperiment === "sand" ? "沙堆临界系统" : nextExperiment === "fire" ? "森林火灾系统" : nextExperiment === "lotka" ? "洛特卡–沃尔泰拉系统" : nextExperiment === "cyclic" ? "循环元胞自动机" : "Greenberg–Hastings 可激发介质"}`,
        `随机种子 ${nextSeed} · ${preset === "safe" ? "Safe" : "Critical"} Preset`,
      ]);
    },
    [experiment, gridSize, preset, seed],
  );

  useEffect(() => {
    resetWorld();
    if (window.matchMedia("(max-width: 760px)").matches) {
      setShowLeft(false);
      setShowRight(false);
      setViewMode("2d");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchExperiment = (next: Experiment) => {
    if (next === experiment) return;
    setExperiment(next);
    resetWorld(next, seed, gridSize);
  };

  const applyGridSize = (next: number) => {
    const safe = Math.max(32, Math.min(512, Math.round(next)));
    setGridSize(safe);
    resetWorld(experiment, seed, safe);
  };

  const addLog = useCallback((entry: string) => {
    setLog((old) => [entry, ...old].slice(0, 8));
  }, []);

  const stepSand = useCallback(
    (f: Features, e: Emotion, t: number) => {
      const grid = gridRef.current;
      const size = gridSize;
      const random = randRef.current;
      const arousalDrive = mappingEnabled["map-6"] ? e.arousal : 0.35;
      const lowDrive = mappingEnabled["map-1"] ? f.low : 0;
      const boost = mode === "manual" ? 0.42 : arousalDrive * (gain / 72);
      const onsetDrive = mappingEnabled["map-4"] ? f.onset : 0;
      const musicIntensity = Math.max(0, Math.min(1, boost * 0.58 + lowDrive * 0.27 + onsetDrive * 0.15 + (preset === "critical" ? 0.08 : 0)));
      const shapedIntensity = Math.pow(musicIntensity, preset === "critical" ? 1.35 : 1.75);
      const input = 1 + Math.min(4, Math.floor(shapedIntensity * 5));
      const centroidDrive = mappingEnabled["map-5"] ? f.centroid : 0.25;
      const spread = Math.max(2, Math.floor(size * (0.025 + centroidDrive * 0.08)));
      const centerX = size / 2 + Math.sin(t * 0.00027) * size * 0.2;
      const centerY = size / 2 + Math.cos(t * 0.00019) * size * 0.16;
      for (let n = 0; n < input; n++) {
        const x = Math.max(
          1,
          Math.min(size - 2, Math.floor(centerX + (random() - 0.5) * spread)),
        );
        const y = Math.max(
          1,
          Math.min(size - 2, Math.floor(centerY + (random() - 0.5) * spread)),
        );
        grid[y * size + x]++;
      }
      const threshold = 4;
      let avalanche = 0;
      const passes = size >= 256 ? 2 : size >= 128 ? 4 : 7;
      for (let pass = 0; pass < passes; pass++) {
        let moved = 0;
        for (let y = 1; y < size - 1; y++) {
          for (let x = 1; x < size - 1; x++) {
            const i = y * size + x;
            if (grid[i] >= threshold) {
              grid[i] -= 4;
              grid[i - 1]++;
              grid[i + 1]++;
              grid[i - size]++;
              grid[i + size]++;
              moved++;
            }
          }
        }
        avalanche += moved;
        if (!moved) break;
      }
      for (let x = 0; x < size; x++) {
        grid[x] = 0;
        grid[(size - 1) * size + x] = 0;
      }
      for (let y = 0; y < size; y++) {
        grid[y * size] = 0;
        grid[y * size + size - 1] = 0;
      }
      let critical = 0;
      let maxHeight = 0;
      const bins = [0, 0, 0, 0, 0];
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] >= threshold - 1) critical++;
        if (grid[i] > maxHeight) maxHeight = grid[i];
        bins[Math.min(4, grid[i])]++;
      }
      const m = metricsRef.current;
      if (avalanche > 3) {
        m.events++;
        m.max = Math.max(m.max, avalanche);
        if (avalanche > Math.max(12, m.max * 0.8)) {
          addLog(`t+${fmtTime(current)} 雪崩 · 规模 ${avalanche}`);
        }
      }
      m.active = avalanche;
      m.critical = critical / grid.length;
      const distributionEntropy = -bins.reduce((sum, count) => {
        const p = count / grid.length;
        return p ? sum + p * Math.log2(p) : sum;
      }, 0) / Math.log2(bins.length);
      const avalancheShock = Math.min(1, Math.log1p(avalanche) / Math.log1p(size * 2));
      m.entropy = Math.min(1, distributionEntropy * 0.72 + avalancheShock * 0.2 + ((input - 1) / 4) * 0.08);
      chaosRef.current.push(m.entropy);
      if (chaosRef.current.length > 120) chaosRef.current.shift();
      return { avalanche, maxHeight };
    },
    [addLog, current, gain, gridSize, mappingEnabled, mode, preset],
  );

  const stepFire = useCallback(
    (f: Features, e: Emotion) => {
      const currentGrid = gridRef.current;
      const size = gridSize;
      const next = currentGrid.slice();
      const ages = ageRef.current;
      const random = randRef.current;
      const tensionDrive = mappingEnabled["map-8"] ? e.tension : 0.3;
      const rmsDrive = mappingEnabled["map-0"] ? f.rms : 0.15;
      const fastEnergy = Math.pow(Math.min(1, rmsDrive * 0.58 + f.low * 0.22 + f.onset * 0.2), 1.55);
      const dry =
        mode === "manual" ? 0.42 : Math.min(0.98, 0.08 + Math.pow(tensionDrive * 0.46 + fastEnergy * 0.84, 1.35));
      const spread =
        (preset === "critical" ? 0.28 : 0.08) +
        dry * 0.42 +
        Math.pow(mappingEnabled["map-1"] ? f.low : 0, 1.65) * 0.22 +
        Math.pow(f.onset, 2) * 0.18;
      let active = 0;
      let burned = 0;
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const i = y * size + x;
          const cell = currentGrid[i];
          if (cell === 2) {
            active++;
            ages[i]++;
            if (ages[i] > 2 + Math.floor(random() * 4) + Math.floor((1 - fastEnergy) * 4)) {
              next[i] = 3;
              ages[i] = 0;
              burned++;
            }
            const neighbors = [i - 1, i + 1, i - size, i + size];
            for (const n of neighbors) {
              if (currentGrid[n] === 1 && random() < spread) next[n] = 2;
            }
          } else if (cell === 0 && random() < 0.0005 + (mappingEnabled["map-7"] ? e.valence : 0.2) * 0.0008) {
            next[i] = 1;
          } else if (cell === 3) {
            ages[i]++;
            if (ages[i] > 90 && random() < 0.002 + (mappingEnabled["map-7"] ? e.valence : 0.2) * 0.004) {
              next[i] = 0;
              ages[i] = 0;
            }
          }
        }
      }
      const beat = mappingEnabled["map-4"] && f.onset > 0.48;
      if (beat && random() < 0.08 + Math.pow(f.onset, 1.8) * 0.62 + dry * 0.2 && active < size * 3) {
        for (let tries = 0; tries < 40; tries++) {
          const i = 1 + Math.floor(random() * (currentGrid.length - 2));
          if (currentGrid[i] === 1) {
            next[i] = 2;
            break;
          }
        }
      }
      gridRef.current = next;
      const m = metricsRef.current;
      if (active > 0 && m.active === 0) {
        m.events++;
        addLog(`t+${fmtTime(current)} 新火点 · 风险 ${Math.round(dry * 100)}%`);
      }
      m.active = active;
      m.max = Math.max(m.max, active + burned);
      m.critical = dry;
      const bins = [0, 0, 0, 0];
      for (let i = 0; i < next.length; i++) bins[next[i]]++;
      const distributionEntropy = -bins.reduce((sum, count) => {
        const p = count / next.length;
        return p ? sum + p * Math.log2(p) : sum;
      }, 0) / Math.log2(bins.length);
      const firelinePressure = Math.min(1, active / Math.max(1, size * 0.8));
      m.entropy = Math.min(1, distributionEntropy * 0.72 + firelinePressure * 0.18 + dry * 0.1);
      chaosRef.current.push(m.entropy);
      if (chaosRef.current.length > 120) chaosRef.current.shift();
      return { active, dry, spread };
    },
    [addLog, current, gridSize, mappingEnabled, mode, preset],
  );

  const stepLotka = useCallback(
    (f: Features, e: Emotion, time: number) => {
      const size = gridSize;
      const previous = lotkaRef.current;
      const alpha = 0.42 + e.valence * 0.55 + e.arousal * 0.18;
      const beta = 0.55 + e.tension * 0.65;
      const delta = 0.35 + (mappingEnabled["map-1"] ? f.low : 0.2) * 0.45;
      const gamma = 0.45 + e.stability * 0.35;
      const dt = 0.045;
      const dx = (alpha * previous.prey * (1 - previous.prey) - beta * previous.prey * previous.predator) * dt;
      const dy = (delta * previous.prey * previous.predator - gamma * previous.predator) * dt;
      const prey = Math.max(0.02, Math.min(0.92, previous.prey + dx));
      const predator = Math.max(0.015, Math.min(0.78, previous.predator + dy));
      lotkaRef.current = { prey, predator };
      const grid = gridRef.current;
      const phase = time * 0.00018;
      const predatorShare = predator / Math.max(0.001, 1 - prey);
      for (let i = 0; i < grid.length; i++) {
        const preyField = (Math.sin(i * 12.9898 + phase * 9) + 1) / 2;
        const predatorField = (Math.sin(i * 4.1414 - phase * 13 + Math.floor(i / size) * 0.37) + 1) / 2;
        grid[i] = preyField < prey ? 1 : predatorField < predatorShare ? 2 : 0;
      }
      const bins = [0, 0, 0];
      for (let i = 0; i < grid.length; i++) bins[grid[i]]++;
      const distributionEntropy = -bins.reduce((sum, count) => {
        const p = count / grid.length;
        return p ? sum + p * Math.log2(p) : sum;
      }, 0) / Math.log2(3);
      const eventSize = Math.round((Math.abs(dx) + Math.abs(dy)) * grid.length);
      const m = metricsRef.current;
      if (eventSize > Math.max(2, size * 0.08)) {
        m.events++;
        if (eventSize > m.max) addLog(`t+${fmtTime(current)} 种群坍塌 · 规模 ${eventSize}`);
      }
      m.active = eventSize;
      m.max = Math.max(m.max, eventSize);
      m.critical = Math.min(1, (Math.abs(dx) + Math.abs(dy)) * 28);
      m.entropy = Math.min(1, distributionEntropy * 0.76 + m.critical * 0.16 + f.rms * 0.08);
      chaosRef.current.push(m.entropy);
      if (chaosRef.current.length > 120) chaosRef.current.shift();
      return { prey, predator, eventSize, alpha, beta, delta, gamma };
    },
    [addLog, current, gridSize, mappingEnabled],
  );

  const stepAutomata = useCallback((kind: "cyclic" | "gh", f: Features, e: Emotion) => {
    const grid = gridRef.current;
    const size = gridSize;
    const next = grid.slice();
    const random = randRef.current;
    let changed = 0;
    let active = 0;
    if (kind === "cyclic") {
      const states = 8;
      const threshold = Math.max(1, 3 - Math.floor(Math.pow(f.onset * 0.7 + f.low * 0.3, 1.4) * 2));
      for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const target = (grid[i] + 1) % states;
        let neighbors = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if ((ox || oy) && grid[i + oy * size + ox] === target) neighbors++;
        }
        if (neighbors >= threshold) { next[i] = target; changed++; }
      }
      active = changed;
    } else {
      const refractory = 8;
      const exciteThreshold = Math.max(1, 3 - Math.floor(Math.pow(f.onset, 1.5) * 2));
      for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (grid[i] === 0) {
          let excited = 0;
          const neighbors = [i - 1, i + 1, i - size, i + size];
          for (const n of neighbors) if (grid[n] === 1) excited++;
          if (excited >= exciteThreshold || (f.onset > 0.62 && random() < Math.pow(f.onset, 2) * 0.0015)) {
            next[i] = 1; changed++;
          }
        } else {
          next[i] = grid[i] >= refractory ? 0 : grid[i] + 1;
          if (grid[i] === 1) active++;
        }
      }
    }
    gridRef.current = next;
    const bins = Array(9).fill(0);
    for (let i = 0; i < next.length; i++) bins[next[i]]++;
    const entropy = -bins.reduce((sum, count) => {
      const p = count / next.length;
      return p ? sum + p * Math.log2(p) : sum;
    }, 0) / Math.log2(bins.length);
    const m = metricsRef.current;
    m.active = active;
    m.max = Math.max(m.max, active);
    m.critical = Math.min(1, changed / Math.max(1, size * 1.5));
    m.entropy = Math.min(1, entropy * 0.82 + e.arousal * 0.1 + f.onset * 0.08);
    if (active > size && m.events % 12 === 0) addLog(`t+${fmtTime(current)} 局部激发 · 规模 ${active}`);
    if (active > 0) m.events++;
    chaosRef.current.push(m.entropy);
    if (chaosRef.current.length > 120) chaosRef.current.shift();
  }, [addLog, current, gridSize]);

  const draw = useCallback(
    (time: number, f: Features, e: Emotion) => {
      const drawInterval = gridSize >= 512 ? 140 : gridSize >= 256 ? 80 : gridSize >= 128 ? 42 : 0;
      if (time - lastGridDrawRef.current < drawInterval) return;
      lastGridDrawRef.current = time;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const ratio = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.35 : 2);
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * ratio)) {
        canvas.width = Math.floor(rect.width * ratio);
        canvas.height = Math.floor(rect.height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const size = gridSize;
      const side = Math.min(rect.width, rect.height);
      const ox = (rect.width - side) / 2;
      const oy = (rect.height - side) / 2;
      const grid = gridRef.current;
      ctx.fillStyle = experiment === "sand" ? "#071516" : "#08130f";
      ctx.fillRect(ox, oy, side, side);
      const activeSpectrum = spectrum === "random" ? randomSpectrum : spectrum;
      const palette = activeSpectrum === "earth" && experiment === "fire"
        ? ["#10251b", "#347653", "#ff7a36", "#382c2b", "#ffd37a"]
        : activeSpectrum === "earth" && experiment === "lotka"
          ? ["#071516", "#75d6bd", "#ff714b", "#e3b65e", "#ffffff"]
        : experiment === "cyclic"
          ? ["#071516", "#173e6a", "#167f80", "#24a489", "#8fcf73", "#e3b65e", "#e9784e", "#b15173"]
        : experiment === "gh"
          ? ["#071516", "#fff3bd", "#ffb45b", "#ef744b", "#b74c55", "#733d64", "#38466f", "#1d6b76", "#1d443f"]
        : SPECTRUMS[activeSpectrum];
      if (viewMode === "2d") {
        if (!pixelCanvasRef.current) pixelCanvasRef.current = document.createElement("canvas");
        const pixels = pixelCanvasRef.current;
        if (pixels.width !== size) {
          pixels.width = size;
          pixels.height = size;
        }
        const pixelCtx = pixels.getContext("2d");
        if (pixelCtx) {
          const image = pixelCtx.createImageData(size, size);
          for (let i = 0; i < grid.length; i++) {
            const hex = palette[Math.min(grid[i], palette.length - 1)];
            const value = Number.parseInt(hex.slice(1), 16);
            image.data[i * 4] = (value >> 16) & 255;
            image.data[i * 4 + 1] = (value >> 8) & 255;
            image.data[i * 4 + 2] = value & 255;
            image.data[i * 4 + 3] = 255;
          }
          pixelCtx.putImageData(image, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(pixels, ox, oy, side, side);
        }
      } else {
        const stride = Math.max(1, Math.ceil(size / 48));
        const count = Math.ceil(size / stride);
        const unit = side / (count * 2.12);
        const centerX = rect.width / 2;
        const baseY = oy + side * 0.17;
        ctx.fillStyle = "rgba(9,29,24,.88)";
        ctx.fillRect(ox, oy, side, side);
        for (let diagonal = 0; diagonal <= (count - 1) * 2; diagonal++) {
          for (let x = 0; x < count; x++) {
            const y = diagonal - x;
            if (y < 0 || y >= count) continue;
            const gx = Math.min(size - 1, x * stride);
            const gy = Math.min(size - 1, y * stride);
            const cellValue = grid[gy * size + gx];
            const px = centerX + (x - y) * unit;
            const groundY = baseY + (x + y) * unit * 0.47;
            ctx.globalAlpha = 0.88;
            ctx.fillStyle = palette[Math.min(cellValue, palette.length - 1)];
            if (experiment === "sand") {
              const height = (0.35 + Math.min(5, cellValue) * 0.72) * unit;
              ctx.beginPath();
              ctx.moveTo(px, groundY - height - unit * 0.42);
              ctx.lineTo(px + unit, groundY - height);
              ctx.lineTo(px, groundY - height + unit * 0.42);
              ctx.lineTo(px - unit, groundY - height);
              ctx.closePath();
              ctx.fill();
              ctx.fillStyle = "rgba(0,0,0,.28)";
              ctx.beginPath();
              ctx.moveTo(px - unit, groundY - height);
              ctx.lineTo(px, groundY - height + unit * 0.42);
              ctx.lineTo(px, groundY + unit * 0.42);
              ctx.lineTo(px - unit, groundY);
              ctx.closePath();
              ctx.fill();
            } else if (experiment === "fire") {
              ctx.fillStyle = "rgba(37,59,50,.4)";
              ctx.beginPath();
              ctx.moveTo(px, groundY - unit * 0.3);
              ctx.lineTo(px + unit, groundY);
              ctx.lineTo(px, groundY + unit * 0.3);
              ctx.lineTo(px - unit, groundY);
              ctx.closePath();
              ctx.fill();
              if (cellValue === 1) {
                ctx.strokeStyle = palette[1];
                ctx.lineWidth = Math.max(1, unit * 0.22);
                ctx.beginPath();
                ctx.moveTo(px, groundY);
                ctx.lineTo(px, groundY - unit * 1.45);
                ctx.stroke();
                ctx.fillStyle = palette[1];
                ctx.beginPath();
                ctx.arc(px, groundY - unit * 1.55, unit * 0.55, 0, Math.PI * 2);
                ctx.fill();
              } else if (cellValue === 2) {
                const flame = unit * (1.3 + f.onset * 1.4);
                ctx.fillStyle = palette[Math.min(4, palette.length - 1)];
                ctx.beginPath();
                ctx.moveTo(px, groundY - flame);
                ctx.lineTo(px + unit * 0.55, groundY);
                ctx.lineTo(px - unit * 0.55, groundY);
                ctx.closePath();
                ctx.fill();
              } else if (cellValue === 3) {
                ctx.fillStyle = palette[3];
                ctx.fillRect(px - unit * 0.18, groundY - unit * 0.7, unit * 0.36, unit * 0.7);
              }
            } else if (cellValue > 0) {
              const radius = unit * (cellValue === 1 ? 0.4 : 0.62);
              const lift = cellValue === 1 ? unit * 0.45 : unit * 1.05;
              ctx.fillStyle = cellValue === 1 ? palette[2] : palette[palette.length - 1];
              ctx.shadowColor = ctx.fillStyle;
              ctx.shadowBlur = cellValue === 2 ? 7 : 3;
              ctx.beginPath();
              ctx.arc(px, groundY - lift, radius, 0, Math.PI * 2);
              ctx.fill();
              ctx.shadowBlur = 0;
            }
          }
        }
        ctx.globalAlpha = 1;
      }
      const pulse = 1 + f.onset * 7 + Math.sin(time / 130) * f.low * 2;
      ctx.strokeStyle = palette[palette.length - 1];
      ctx.globalAlpha = 0.35 + f.rms * 0.65;
      ctx.lineWidth = pulse;
      ctx.strokeRect(ox - pulse / 2, oy - pulse / 2, side + pulse, side + pulse);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(160,255,214,${0.08 + f.high * 0.2})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 4, oy + 4, side - 8, side - 8);
    },
    [experiment, gridSize, randomSpectrum, spectrum, viewMode],
  );

  const drawChaos = useCallback(() => {
    const canvas = chaosCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.35 : 2);
    if (canvas.width !== Math.floor(rect.width * ratio)) {
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const history = chaosRef.current;
    const active = spectrum === "random" ? randomSpectrum : spectrum;
    const palette = active === "earth" && experiment === "fire"
      ? ["#10251b", "#347653", "#ff7a36", "#382c2b", "#ffd37a"]
      : active === "earth" && experiment === "lotka"
        ? ["#071516", "#75d6bd", "#ff714b", "#e3b65e", "#ffffff"]
      : SPECTRUMS[active];
    ctx.strokeStyle = "rgba(168,210,190,.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rect.height / 2);
    ctx.lineTo(rect.width, rect.height / 2);
    ctx.moveTo(rect.width / 2, 0);
    ctx.lineTo(rect.width / 2, rect.height);
    ctx.stroke();
    ctx.strokeStyle = palette[Math.min(3, palette.length - 1)];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    history.forEach((entropyValue, index) => {
      if (!index) return;
      const delta = entropyValue - history[index - 1];
      const x = 4 + entropyValue * (rect.width - 8);
      const y = Math.max(3, Math.min(rect.height - 3, rect.height / 2 - delta * rect.height * 7));
      if (index === 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const latest = history.at(-1) ?? 0;
    const previous = history.at(-2) ?? latest;
    const px = 4 + latest * (rect.width - 8);
    const py = Math.max(3, Math.min(rect.height - 3, rect.height / 2 - (latest - previous) * rect.height * 7));
    ctx.fillStyle = palette[palette.length - 1];
    ctx.shadowColor = palette[palette.length - 1];
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }, [experiment, randomSpectrum, spectrum]);

  const drawRadar = useCallback((e: Emotion) => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.35 : 2);
    if (canvas.width !== Math.floor(rect.width * ratio)) {
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const r = Math.min(rect.width, rect.height) * 0.35;
    const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
    ctx.strokeStyle = "rgba(127,210,172,.22)";
    ctx.lineWidth = 1;
    for (const scale of [0.33, 0.66, 1]) {
      ctx.beginPath();
      angles.forEach((angle, i) => {
        const x = cx + Math.cos(angle) * r * scale;
        const y = cy + Math.sin(angle) * r * scale;
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    angles.forEach((angle) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.stroke();
    });
    const values = [e.arousal, e.valence, e.tension, e.stability];
    ctx.beginPath();
    angles.forEach((angle, i) => {
      const x = cx + Math.cos(angle) * r * values[i];
      const y = cy + Math.sin(angle) * r * values[i];
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(240,189,89,.22)";
    ctx.strokeStyle = "#f0bd59";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }, []);

  useEffect(() => {
    let lastStep = 0;
    let lastUi = 0;
    const loop = (time: number) => {
      let f = DEFAULT_FEATURES;
      const analyser = analyserRef.current;
      const data = dataRef.current;
      const hasActiveAudio = Boolean(running && analyser && data && audioRef.current?.src);
      if (hasActiveAudio && analyser && data) {
        analyser.getByteFrequencyData(data);
        const third = Math.floor(data.length / 3);
        const avg = (start: number, end: number) => {
          let sum = 0;
          for (let i = start; i < end; i++) sum += data[i];
          return sum / Math.max(1, end - start) / 255;
        };
        const low = avg(0, Math.max(8, Math.floor(third * 0.34)));
        const mid = avg(Math.floor(third * 0.25), third * 2);
        const high = avg(third * 2, data.length);
        const rms = Math.min(1, low * 0.52 + mid * 0.34 + high * 0.24);
        const onset = Math.min(1, Math.max(0, (rms - features.rms) * 5.5 + low * 0.48));
        const centroid = Math.min(1, mid * 0.46 + high * 0.74);
        f = { rms, low, mid, high, onset, centroid, tempo: 90 + low * 85 };
        if (onset > 0.72 && time - lastBeatRef.current > 260) lastBeatRef.current = time;
      }
      if (hasActiveAudio) {
        const previous = lastAudioSnapshotRef.current;
        const spectralFlux = Math.min(1, (
          Math.abs(f.low - previous.low) +
          Math.abs(f.mid - previous.mid) +
          Math.abs(f.high - previous.high) +
          Math.abs(f.rms - previous.rms)
        ) * 1.7);
        const beatGate = f.onset > 0.58;
        const climaxGate = f.rms > 0.55 && f.mid > 0.42 && f.high > 0.28;
        const switchProbability = Math.min(0.92, 0.08 + f.onset * 0.34 + spectralFlux * 0.38 + (climaxGate ? 0.28 : 0));
        if (
          spectrum === "random" &&
          time - lastSpectrumSwitchRef.current > 420 &&
          (beatGate || (spectralFlux > 0.2 && climaxGate)) &&
          visualRandRef.current() < switchProbability
        ) {
          const names = Object.keys(SPECTRUMS) as SpectrumName[];
          let next = names[Math.floor(visualRandRef.current() * names.length)];
          if (next === randomSpectrum) next = names[(names.indexOf(next) + 1) % names.length];
          setRandomSpectrum(next);
          lastSpectrumSwitchRef.current = time;
        }
        lastAudioSnapshotRef.current = { low: f.low, mid: f.mid, high: f.high, rms: f.rms };
      }
      const target: Emotion = hasActiveAudio
        ? {
            arousal: Math.min(1, f.rms * 0.76 + (f.tempo / 200) * 0.24),
            valence: Math.min(1, 0.34 + f.centroid * 0.42 + f.mid * 0.14),
            tension: Math.min(1, f.high * 0.42 + f.onset * 0.28 + f.rms * 0.3),
            stability: Math.max(0, 0.82 - Math.abs(f.onset - 0.3) * 0.48 - f.high * 0.14),
          }
        : DEFAULT_EMOTION;
      const old = slowRef.current;
      const e = {
        arousal: old.arousal * 0.992 + target.arousal * 0.008,
        valence: old.valence * 0.996 + target.valence * 0.004,
        tension: old.tension * 0.993 + target.tension * 0.007,
        stability: old.stability * 0.996 + target.stability * 0.004,
      };
      slowRef.current = e;
      const stepInterval = gridSize >= 512 ? 140 : gridSize >= 256 ? 88 : gridSize >= 128 ? 58 : 42;
      if (running && time - lastStep > stepInterval) {
        if (experiment === "sand") stepSand(f, e, time);
        else if (experiment === "fire") stepFire(f, e);
        else if (experiment === "lotka") stepLotka(f, e, time);
        else stepAutomata(experiment, f, e);
        if (hasActiveAudio) {
          studyRef.current.push({
            time: audioRef.current?.currentTime ?? 0,
            entropy: metricsRef.current.entropy,
            energy: f.rms,
            arousal: e.arousal,
            eventSize: metricsRef.current.active,
            critical: metricsRef.current.critical,
            prey: lotkaRef.current.prey,
            predator: lotkaRef.current.predator,
          });
          if (studyRef.current.length > 12000) studyRef.current.shift();
        }
        lastStep = time;
      }
      draw(time, f, e);
      drawChaos();
      drawRadar(e);
      if (time - lastUi > 120) {
        setFeatures(f);
        setEmotion(e);
        setStats({ ...metricsRef.current });
        lastUi = time;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, drawChaos, drawRadar, experiment, gridSize, randomSpectrum, running, spectrum, stepAutomata, stepFire, stepLotka, stepSand]); // features intentionally sampled

  const generateReport = useCallback(() => {
    const samples = studyRef.current;
    const entropies = samples.map((sample) => sample.entropy);
    const energies = samples.map((sample) => sample.energy);
    const entropyMean = mean(entropies);
    const energyMean = mean(energies);
    const covariance = samples.length > 1
      ? samples.reduce((sum, sample) => sum + (sample.entropy - entropyMean) * (sample.energy - energyMean), 0) / (samples.length - 1)
      : 0;
    const correlationDenominator = Math.sqrt(variance(entropies) * variance(energies));
    const correlation = correlationDenominator ? covariance / correlationDenominator : 0;
    const ordered = [...samples].sort((a, b) => a.energy - b.energy);
    const groupSize = Math.max(1, Math.floor(ordered.length / 3));
    const low = ordered.slice(0, groupSize).map((sample) => sample.entropy);
    const high = ordered.slice(-groupSize).map((sample) => sample.entropy);
    const denominator = Math.sqrt(variance(low) / Math.max(1, low.length) + variance(high) / Math.max(1, high.length));
    const tScore = denominator ? (mean(high) - mean(low)) / denominator : 0;
    const pApprox = Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(tScore)))));
    setReport({
      count: samples.length,
      meanEntropy: entropyMean,
      maxEntropy: entropies.length ? Math.max(...entropies) : 0,
      correlation,
      lowMean: mean(low),
      highMean: mean(high),
      tScore,
      pApprox,
      sufficient: samples.length >= 30 && low.length >= 5 && high.length >= 5,
      duration: samples.at(-1)?.time ?? 0,
      peakEvent: samples.length ? Math.max(...samples.map((sample) => sample.eventSize)) : 0,
      eventCount: samples.filter((sample) => sample.eventSize > 0).length,
      fingerprint: `MF-${Math.round(entropyMean * 999).toString(16).padStart(3, "0")}-${Math.round((correlation + 1) * 499).toString(16).padStart(3, "0")}-${Math.round((samples.length ? Math.max(...samples.map((sample) => sample.eventSize)) : 0) + (samples.at(-1)?.time ?? 0)).toString(16).padStart(3, "0")}`.toUpperCase(),
      samples: [...samples],
    });
  }, []);

  useEffect(() => {
    if (!report) return;
    const drawReportCanvas = (
      canvas: HTMLCanvasElement | null,
      painter: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
    ) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.35 : 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      painter(ctx, rect.width, rect.height);
    };
    const samples = report.samples;
    const maxTime = Math.max(1, report.duration);
    const maxEvent = Math.max(1, report.peakEvent);
    drawReportCanvas(reportTimelineRef.current, (ctx, width, height) => {
      ctx.strokeStyle = "rgba(23,63,55,.13)";
      ctx.beginPath();
      ctx.moveTo(36, height - 22);
      ctx.lineTo(width - 8, height - 22);
      ctx.moveTo(36, 8);
      ctx.lineTo(36, height - 22);
      ctx.stroke();
      const plot = (selector: (sample: StudySample) => number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        samples.forEach((sample, index) => {
          const x = 36 + (sample.time / maxTime) * (width - 46);
          const y = 8 + (1 - selector(sample)) * (height - 32);
          if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      };
      plot((sample) => sample.entropy, "#2f9d75");
      plot((sample) => sample.eventSize / maxEvent, "#e06d46");
      ctx.fillStyle = "#718079";
      ctx.font = "8px monospace";
      ctx.fillText("0s", 32, height - 8);
      ctx.fillText(`${maxTime.toFixed(0)}s`, width - 36, height - 8);
      ctx.fillStyle = "#2f9d75";
      ctx.fillText("Entropy", 42, 15);
      ctx.fillStyle = "#e06d46";
      ctx.fillText("Event size", 92, 15);
    });
    drawReportCanvas(reportScatterRef.current, (ctx, width, height) => {
      ctx.strokeStyle = "rgba(23,63,55,.13)";
      ctx.strokeRect(28.5, 8.5, width - 38, height - 31);
      samples.filter((_, index) => index % Math.max(1, Math.floor(samples.length / 320)) === 0).forEach((sample) => {
        const x = 29 + sample.energy * (width - 39);
        const y = 9 + (1 - sample.entropy) * (height - 32);
        ctx.fillStyle = `rgba(198,82,55,${0.22 + sample.critical * 0.65})`;
        ctx.beginPath();
        ctx.arc(x, y, 2 + sample.eventSize / maxEvent * 2.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = "#718079";
      ctx.font = "8px monospace";
      ctx.fillText("响度 →", width - 48, height - 8);
      ctx.save();
      ctx.translate(9, 53);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("Entropy →", 0, 0);
      ctx.restore();
    });
    drawReportCanvas(reportPhaseRef.current, (ctx, width, height) => {
      const phaseSamples = samples.filter((sample, index) =>
        index === 0 || Math.floor(sample.time) !== Math.floor(samples[index - 1].time),
      );
      const left = 40;
      const right = width - 12;
      const top = 18;
      const bottom = height - 28;
      ctx.strokeStyle = "rgba(23,63,55,.11)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const x = left + (right - left) * i / 4;
        const y = top + (bottom - top) * i / 4;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      }
      if (phaseSamples.length) {
        phaseSamples.forEach((sample, index) => {
          if (!index) return;
          const previous = phaseSamples[index - 1];
          const x1 = left + previous.entropy * (right - left);
          const y1 = bottom - previous.critical * (bottom - top);
          const x2 = left + sample.entropy * (right - left);
          const y2 = bottom - sample.critical * (bottom - top);
          const progress = index / Math.max(1, phaseSamples.length - 1);
          ctx.strokeStyle = `hsla(${164 - progress * 122},68%,${38 + progress * 8}%,.88)`;
          ctx.lineWidth = 1.4 + progress * 1.2;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        });
        const last = phaseSamples.at(-1)!;
        const x = left + last.entropy * (right - left);
        const y = bottom - last.critical * (bottom - top);
        ctx.fillStyle = "#e05e3f";
        ctx.beginPath(); ctx.arc(x, y, 4.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#718079";
      ctx.font = "8px monospace";
      ctx.fillText("SYSTEM ENTROPY →", width - 102, height - 8);
      ctx.save();
      ctx.translate(10, 82);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("CRITICALITY →", 0, 0);
      ctx.restore();
      ctx.fillStyle = "#173f37";
      ctx.fillText(`1 s sampling · ${report.fingerprint}`, left, 12);
    });
  }, [report]);

  const ensureAudioGraph = () => {
    if (!audioRef.current || audioContextRef.current) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(audioRef.current);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    analyser.connect(context.destination);
    analyserRef.current = analyser;
    dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    audioContextRef.current = context;
  };

  const resetAudioStudy = () => {
    studyRef.current = [];
    lastAudioSnapshotRef.current = { low: 0, mid: 0, high: 0, rms: 0 };
    lastSpectrumSwitchRef.current = 0;
    setReport(null);
  };

  const importAudio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !audioRef.current) return;
    if (!file.type.startsWith("audio/")) {
      setError("请选择 WAV、MP3、FLAC 或 OGG 音频文件。");
      return;
    }
    setError("");
    resetAudioStudy();
    const url = URL.createObjectURL(file);
    audioRef.current.src = url;
    setFileName(file.name);
    addLog(`载入音乐：${file.name}`);
    ensureAudioGraph();
  };

  const loadAudioUrl = () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      const parsed = new URL(audioUrl.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
      audio.crossOrigin = "anonymous";
      audio.src = parsed.toString();
      audio.load();
      resetAudioStudy();
      ensureAudioGraph();
      setFileName(decodeURIComponent(parsed.pathname.split("/").pop() || parsed.hostname));
      setShowUrlInput(false);
      setError("");
      addLog(`链接音乐：${parsed.hostname}`);
    } catch {
      setError("请输入可直接播放的 http(s) 音频文件地址；普通网页链接不能作为音频源。");
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (audio?.src) {
      if (audio.paused) {
        try {
          ensureAudioGraph();
          await audioContextRef.current?.resume();
          await audio.play();
          setRunning(true);
          setError("");
        } catch {
          setError("无法播放该音频。链接模式需要直接音频文件地址，并且来源服务器允许跨域访问。");
        }
      } else {
        audio.pause();
        setRunning(false);
      }
    } else {
      setRunning((value) => !value);
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (audio?.src) {
      audio.pause();
      audio.currentTime = 0;
    }
    setRunning(false);
    setCurrent(0);
    if (studyRef.current.length) generateReport();
  };

  const risk = experiment === "sand" ? stats.critical : emotion.tension;
  const fastValue = (value: number) => `${Math.round(Math.pow(Math.max(0, Math.min(1, value)), 1.45) * 100)}%`;
  const worldItems =
    experiment === "sand"
      ? [["Threshold", "4", "Toppling gate"], ["Friction", (0.35 + emotion.stability * 0.45).toFixed(2), "Stability"], ["Gravity", `${(0.72 + emotion.arousal * 0.56).toFixed(2)}g`, "Arousal"], ["Diffusion", (0.08 + features.centroid * 0.42).toFixed(2), "Centroid"]]
      : experiment === "fire"
        ? [["Ignition", fastValue(features.onset), "Onset² trigger"], ["Spread", `${Math.round((0.08 + Math.pow(features.low, 1.65) * 0.64) * 100)}%`, "Low-band exponent"], ["Moisture", `${Math.round((1 - risk) * 100)}%`, "Tension inverse"], ["Regrowth", `${(0.001 + emotion.valence * 0.006).toFixed(3)}`, "Valence recovery"]]
        : experiment === "lotka"
          ? [["Prey growth α", (0.42 + emotion.valence * 0.55).toFixed(2), "Valence"], ["Predation β", (0.55 + emotion.tension * 0.65).toFixed(2), "Tension"], ["Conversion δ", (0.35 + features.low * 0.45).toFixed(2), "Low band"], ["Mortality γ", (0.45 + emotion.stability * 0.35).toFixed(2), "Stability"]]
          : experiment === "cyclic"
            ? [["States", "8", "Phase count"], ["Capture threshold", `${Math.max(1, 3 - Math.floor(Math.pow(features.onset * 0.7 + features.low * 0.3, 1.4) * 2))}`, "Beat sensitivity"], ["Neighborhood", "Moore-8", "Local coupling"], ["Phase velocity", fastValue(features.rms), "RMS exponent"]]
            : [["Resting", "0", "Quiescent state"], ["Excited", "1", "Wave front"], ["Refractory", "2–8", "Recovery cycle"], ["Excite threshold", `${Math.max(1, 3 - Math.floor(Math.pow(features.onset, 1.5) * 2))}`, "Onset exponent"]];
  const mappingGroups = [
    {
      title: "FAST LAYER",
      items: [
        ["RMS 能量", fastValue(features.rms), "Exp 1.45 · World energy"],
        ["低频脉冲", fastValue(features.low), "Exp 1.45 · Boundary force"],
        ["中频密度", fastValue(features.mid), "Exp 1.45 · Texture density"],
        ["高频颗粒", fastValue(features.high), "Exp 1.45 · Edge detail"],
        ["Onset 冲击", fastValue(features.onset), "Exp 1.45 · Event impulse"],
        ["频谱质心", fastValue(features.centroid), "Exp 1.45 · Color heat"],
      ],
    },
    {
      title: "SLOW LAYER",
      items: [
        ["激活度", emotion.arousal.toFixed(2), "Input pressure"],
        ["正向度", emotion.valence.toFixed(2), "Recovery bias"],
        ["紧张度", emotion.tension.toFixed(2), "Criticality"],
        ["稳定度", emotion.stability.toFixed(2), "Rule coherence"],
        ["能量趋势", `${Math.round((emotion.arousal - 0.5) * 200)}%`, "Accumulation"],
        ["情绪惯性", `${Math.round((emotion.stability * 0.7 + 0.3) * 100)}%`, "Memory"],
      ],
    },
    {
      title: "WORLD PARAMETERS",
      items: worldItems,
    },
  ];
  const displaySpectrum = spectrum === "random" ? randomSpectrum : spectrum;
  const bpmPalette = displaySpectrum === "earth" && experiment === "fire"
    ? ["#10251b", "#347653", "#ff7a36", "#382c2b", "#ffd37a"]
    : displaySpectrum === "earth" && experiment === "lotka"
      ? ["#071516", "#75d6bd", "#ff714b", "#e3b65e", "#ffffff"]
    : SPECTRUMS[displaySpectrum];
  const telemetryColor = experiment === "fire" ? "#ff8a3d" : experiment === "sand" ? "#f2c765" : experiment === "lotka" ? "#79d9be" : experiment === "cyclic" ? "#73d8c1" : "#ffd06b";
  const experimentMeta: Record<Experiment, { code: string; title: string; stat: string; active: string }> = {
    sand: { code: "SANDPILE", title: "临界正在累积", stat: "临界单元", active: "最近雪崩" },
    fire: { code: "FOREST_FIRE", title: "火线正在寻找路径", stat: "传播风险", active: "活跃火点" },
    lotka: { code: "LOTKA_VOLTERRA", title: "种群正在追逐平衡", stat: "动态压力", active: "种群变化量" },
    cyclic: { code: "CYCLIC_CA", title: "相位正在循环捕获", stat: "相位压力", active: "状态跃迁" },
    gh: { code: "GREENBERG_HASTINGS", title: "激发波正在穿越介质", stat: "激发临界", active: "活跃波前" },
  };

  return (
    <main className="shell">
      <audio
        ref={audioRef}
        src="/guofeng-2-web.wav"
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onEnded={() => {
          setRunning(false);
          generateReport();
        }}
        onError={() => setError("音频无法播放。若使用链接，请确认它是可跨域访问的直接音频地址。")}
      />
      <input ref={fileRef} type="file" accept="audio/*,.flac" hidden onChange={importAudio} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M∿</span>
          <div>
            <strong>涌现声场</strong>
            <small>音乐驱动的复杂系统实验室</small>
          </div>
        </div>
        <div className="transport">
          <button className="import" onClick={() => fileRef.current?.click()}>
            <span>＋</span> 导入音乐
          </button>
          <button className="link-audio" onClick={() => setShowUrlInput((value) => !value)}>↗ 链接</button>
          {showUrlInput && (
            <div className="url-loader">
              <label>直接音频 URL</label>
              <div>
                <input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadAudioUrl()} placeholder="https://example.com/music.mp3" autoFocus />
                <button onClick={loadAudioUrl}>载入</button>
              </div>
              <small>支持服务器允许跨域访问的 MP3、WAV、OGG 等直链。</small>
            </div>
          )}
          <button className="icon-button primary" onClick={togglePlay} aria-label={running ? "暂停" : "播放"}>
            {running ? "Ⅱ" : "▶"}
          </button>
          <button className="icon-button" onClick={stop} aria-label="停止">
            ■
          </button>
          <div className="song">
            <strong title={fileName}>{fileName}</strong>
            <div className="progress">
              <i style={{ width: `${duration ? (current / duration) * 100 : running ? 26 : 0}%` }} />
            </div>
          </div>
          <span className="time">
            {fmtTime(current)} / {fmtTime(duration)}
          </span>
        </div>
        <div className="status panel-visibility">
          <button className={showLeft ? "active" : ""} onClick={() => setShowLeft((v) => !v)} aria-label="显示或隐藏左侧面板">L</button>
          <button className={showRight ? "active" : ""} onClick={() => setShowRight((v) => !v)} aria-label="显示或隐藏右侧面板">R</button>
          <span><i className={running ? "live" : ""} /> {running ? "实验运行中" : "实验待命"}</span>
        </div>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <nav className="mobile-dock" aria-label="手机端实验导航">
        <button className={showLeft ? "active" : ""} onClick={() => {
          setShowLeft((value) => !value);
          setShowRight(false);
          window.setTimeout(() => document.querySelector(".left-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
        }}>◫<span>实验设置</span></button>
        <button onClick={() => {
          setShowLeft(false);
          setShowRight(false);
          window.setTimeout(() => document.querySelector(".stage")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
        }}>◎<span>系统视图</span></button>
        <button className={showRight ? "active" : ""} onClick={() => {
          setShowRight((value) => !value);
          setShowLeft(false);
          window.setTimeout(() => document.querySelector(".right-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
        }}>⌁<span>音乐分析</span></button>
      </nav>

      <section className={`workspace ${!showLeft ? "hide-left" : ""} ${!showRight ? "hide-right" : ""}`}>
        <aside className={`left-panel ${!showLeft ? "panel-hidden" : ""}`}>
          <div className="panel-heading">
            <span>实验场景</span>
            <em>横向切换 · 01</em>
          </div>
          <div className="experiment-switch" role="tablist" aria-label="实验场景">
            <button className={experiment === "sand" ? "active" : ""} onClick={() => switchExperiment("sand")}>
              <span className="scene-glyph sand">⌁</span>
              <span className="scene-copy"><strong>沙堆临界</strong><small>Sandpile</small></span>
            </button>
            <button className={experiment === "fire" ? "active" : ""} onClick={() => switchExperiment("fire")}>
              <span className="scene-glyph fire">♨</span>
              <span className="scene-copy"><strong>森林火灾</strong><small>Forest Fire</small></span>
            </button>
            <button className={experiment === "lotka" ? "active" : ""} onClick={() => switchExperiment("lotka")}>
              <span className="scene-glyph lotka">∞</span>
              <span className="scene-copy"><strong>捕食–被捕食</strong><small>Lotka–Volterra</small></span>
            </button>
            <button className={experiment === "cyclic" ? "active" : ""} onClick={() => switchExperiment("cyclic")}>
              <span className="scene-glyph cyclic">◉</span>
              <span className="scene-copy"><strong>循环元胞</strong><small>Cyclic CA</small></span>
            </button>
            <button className={experiment === "gh" ? "active" : ""} onClick={() => switchExperiment("gh")}>
              <span className="scene-glyph gh">⌁</span>
              <span className="scene-copy"><strong>可激发介质</strong><small>Greenberg–Hastings</small></span>
            </button>
          </div>
          <div className="view-slider">
            <div><span>2D GRID</span><strong>{viewMode === "3d" ? "3D 世界" : "上帝视角"}</strong><span>3D WORLD</span></div>
            <input
              type="range"
              min="0"
              max="1"
              step="1"
              value={viewMode === "3d" ? 1 : 0}
              onChange={(e) => setViewMode(e.target.value === "1" ? "3d" : "2d")}
              aria-label="切换二维和三维实验视角"
            />
          </div>

          <div className="control-block">
            <label>驱动模式</label>
            <div className="segmented">
              {(["auto", "hybrid", "manual"] as DriveMode[]).map((item) => (
                <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
            <p>{mode === "auto" ? "世界参数由音乐与慢速情绪自动映射" : mode === "hybrid" ? "音乐提供基准，你控制映射强度" : "音乐只保留即时视觉反馈"}</p>
          </div>

          <div className="control-block">
            <div className="label-row">
              <label>映射强度</label>
              <strong>{gain}%</strong>
            </div>
            <input type="range" min="0" max="120" value={gain} onChange={(e) => setGain(Number(e.target.value))} />
          </div>

          <div className="control-block">
            <label>世界预设</label>
            <div className="preset-cards">
              <button className={preset === "safe" ? "active safe" : ""} onClick={() => setPreset("safe")}>
                <strong>Safe</strong>
                <span>稳定观察</span>
              </button>
              <button className={preset === "critical" ? "active critical" : ""} onClick={() => setPreset("critical")}>
                <strong>Critical</strong>
                <span>临界敏感</span>
              </button>
            </div>
          </div>

          <div className="control-block">
            <div className="label-row">
              <label>Grid Cells</label>
              <strong>{gridSize} × {gridSize}</strong>
            </div>
            <div className="size-options">
              {[64, 128, 256, 512].map((size) => (
                <button key={size} className={gridSize === size ? "active" : ""} onClick={() => applyGridSize(size)}>
                  {size}
                </button>
              ))}
            </div>
            <div className="custom-size">
              <input type="number" min="32" max="512" value={customSize} onChange={(e) => setCustomSize(Number(e.target.value))} aria-label="自定义网格边长" />
              <button onClick={() => applyGridSize(customSize)}>应用自定义</button>
            </div>
          </div>

          <div className="control-block">
            <label>色彩光谱</label>
            <select value={spectrum} onChange={(e) => setSpectrum(e.target.value as SpectrumName | "random")} aria-label="选择色彩光谱">
              <option value="earth">Earth / 沙地森林</option>
              <option value="thermal">Thermal / 热成像</option>
              <option value="ocean">Ocean / 深海</option>
              <option value="neon">Neon / 霓虹</option>
              <option value="aurora">Aurora / 极光</option>
              <option value="magma">Magma / 岩浆</option>
              <option value="violet">Violet / 紫晶</option>
              <option value="ice">Ice / 冰川</option>
              <option value="solar">Solar / 日冕</option>
              <option value="mono">Mono / 单色</option>
              <option value="random">Random / 音乐触发随机切换</option>
            </select>
            <div className={`spectrum-preview ${spectrum === "random" ? randomSpectrum : spectrum}`}>
              <i /><i /><i /><i /><i />
              <span>{spectrum === "random" ? `当前：${randomSpectrum}` : "与 Grid / BPM 边缘同步"}</span>
            </div>
          </div>

          <div className="control-block">
            <div className="label-row">
              <label>BPM 边缘透明度</label>
              <strong>{edgeOpacity}%</strong>
            </div>
            <input type="range" min="10" max="100" value={edgeOpacity} onChange={(e) => setEdgeOpacity(Number(e.target.value))} />
          </div>

          <div className="control-block seed">
            <div>
              <label>随机种子</label>
              <input value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} aria-label="随机种子" />
            </div>
            <button onClick={() => resetWorld()}>↻ 重置世界</button>
          </div>

          <div className="explain">
            <span>双时间尺度</span>
            <p>节奏与频率改变即时视觉；情绪轨迹缓慢改变世界规则。灾变由系统历史涌现，而非由某一拍直接触发。</p>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-head">
            <div>
              <span className="eyebrow">WORLD / {experimentMeta[experiment].code}</span>
              <h1>{experimentMeta[experiment].title}</h1>
            </div>
            <div className="stage-stats">
              <div>
                <span>{experimentMeta[experiment].stat}</span>
                <strong>{Math.round(stats.critical * 100)}%</strong>
              </div>
              <div>
                <span>{experimentMeta[experiment].active}</span>
                <strong>{stats.active}</strong>
              </div>
            </div>
          </div>
          <div className={`grid-telemetry ${experiment}`}>
            <aside
              className="pulse-window left"
              style={{ opacity: 0.38 + edgeOpacity / 100 * 0.62, borderColor: `${telemetryColor}aa`, color: telemetryColor }}
              aria-label="左侧 BPM 粒子遥测"
            >
              <span className="telemetry-label">L · BEAT VECTOR</span>
              <div className="pulse-field">
                {Array.from({ length: 30 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      ["--travel" as string]: `${8 + Math.min(68, features.low * ((index * 13) % 54) + features.onset * 48)}%`,
                      ["--scale" as string]: `${0.62 + features.onset * 0.95 + ((index % 4) * 0.06)}`,
                      animationDelay: `${-(index % 7) * 43}ms`,
                    }}
                  />
                ))}
              </div>
              <b>GRID EDGE / ZERO</b>
            </aside>
            <div className={`canvas-wrap ${experiment}`}>
            <canvas
              ref={canvasRef}
              className="world-canvas"
              aria-label={experiment === "sand" ? "沙堆临界系统网格" : experiment === "fire" ? "森林火灾系统网格" : "洛特卡沃尔泰拉种群网格"}
            />
            <button className="center-view" onClick={() => {
              lastGridDrawRef.current = 0;
              canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
            }}>◎ 居中</button>
            <div className="chaos-strip">
              <div className="chaos-label">
                <span>ENTROPY 相空间</span>
                <strong className={stats.entropy > 0.82 ? "danger" : ""}>{stats.entropy.toFixed(2)} ENTROPY</strong>
              </div>
              <canvas ref={chaosCanvasRef} aria-label="Entropy 与变化率的实时相空间" />
              <span className="chaos-state">{stats.entropy > 0.82 ? "HIGH" : stats.entropy > 0.55 ? "ACTIVE" : "STABLE"}</span>
            </div>
            <div className="canvas-tag top-left">
              <i /> AUDIO LINKED
            </div>
            <div className="canvas-tag top-right">{gridSize} × {gridSize} CELLS · {viewMode.toUpperCase()}</div>
            <div className="axis vertical">SYSTEM HISTORY ↑</div>
            <div className="legend">
              {experiment === "sand" ? (
                <>
                  <span><i style={{ background: "#183f38" }} />低势</span>
                  <span><i style={{ background: "#3b7858" }} />积累</span>
                  <span><i style={{ background: "#e3b65e" }} />临界</span>
                  <span><i style={{ background: "#ff714b" }} />拓扑</span>
                </>
              ) : experiment === "fire" ? (
                <>
                  <span><i style={{ background: "#10251b" }} />空地</span>
                  <span><i style={{ background: "#347653" }} />树木</span>
                  <span><i style={{ background: "#ff7a36" }} />燃烧</span>
                  <span><i style={{ background: "#382c2b" }} />焦土</span>
                </>
              ) : experiment === "lotka" ? (
                <>
                  <span><i style={{ background: bpmPalette[0] }} />空域</span>
                  <span><i style={{ background: bpmPalette[2] }} />猎物</span>
                  <span><i style={{ background: bpmPalette[4] }} />捕食者</span>
                  <span>prey {lotkaRef.current.prey.toFixed(2)} / predator {lotkaRef.current.predator.toFixed(2)}</span>
                </>
              ) : experiment === "cyclic" ? (
                <>
                  <span><i style={{ background: "#173e6a" }} />Phase 1</span>
                  <span><i style={{ background: "#24a489" }} />Phase 3</span>
                  <span><i style={{ background: "#e3b65e" }} />Phase 5</span>
                  <span><i style={{ background: "#b15173" }} />Phase 7</span>
                </>
              ) : (
                <>
                  <span><i style={{ background: "#071516" }} />Resting</span>
                  <span><i style={{ background: "#fff3bd" }} />Excited</span>
                  <span><i style={{ background: "#ef744b" }} />Early refractory</span>
                  <span><i style={{ background: "#1d443f" }} />Recovery</span>
                </>
              )}
            </div>
            </div>
            <aside
              className="pulse-window right"
              style={{ opacity: 0.38 + edgeOpacity / 100 * 0.62, borderColor: `${telemetryColor}aa`, color: telemetryColor }}
              aria-label="右侧 BPM 粒子遥测"
            >
              <span className="telemetry-label">R · BEAT VECTOR</span>
              <div className="pulse-field">
                {Array.from({ length: 30 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      ["--travel" as string]: `${8 + Math.min(68, features.mid * ((index * 17) % 54) + features.onset * 48)}%`,
                      ["--scale" as string]: `${0.62 + features.onset * 0.95 + ((index % 5) * 0.05)}`,
                      animationDelay: `${-(index % 9) * 37}ms`,
                    }}
                  />
                ))}
              </div>
              <b>GRID EDGE / ZERO</b>
            </aside>
          </div>
          <div className="event-strip">
            <header>
              <span>MISSION EVENT LOG</span>
              <em>LIVE TELEMETRY · {experiment.toUpperCase()}</em>
            </header>
            <div className="mission-log">
              {log.map((item, index) => {
                const event = classifyMissionEvent(item);
                const eventTime = Math.max(0, current - index * 1.7);
                return (
                  <article key={`${item}-${index}`} className={event.tone}>
                    <time>{fmtMissionTime(eventTime)}</time>
                    <i />
                    <div><strong>{event.type}</strong><small>{item.replace(/^t\+\d{2}:\d{2}\s*/, "")}</small></div>
                    <b>{String(log.length - index).padStart(3, "0")}</b>
                  </article>
                );
              })}
            </div>
          </div>
          {report && (
            <section className="music-report">
              <header>
                <div>
                  <span>POST-TRACK STUDY</span>
                  <h2>音乐 × 系统混乱度报告</h2>
                </div>
                <button onClick={() => setReport(null)} aria-label="关闭报告">×</button>
              </header>
              <div className="report-grid">
                <div><span>平均 Entropy</span><strong>{report.meanEntropy.toFixed(3)}</strong></div>
                <div><span>最高 Entropy</span><strong>{report.maxEntropy.toFixed(3)}</strong></div>
                <div><span>能量相关 r</span><strong>{report.correlation.toFixed(3)}</strong></div>
                <div><span>近似 p 值</span><strong>{report.sufficient ? report.pApprox.toFixed(3) : "样本不足"}</strong></div>
                <div><span>记录长度</span><strong>{fmtTime(report.duration)}</strong></div>
                <div><span>最大坍塌/事件</span><strong>{report.peakEvent}</strong></div>
                <div><span>活跃时间点</span><strong>{report.eventCount}</strong></div>
                <div><span>有效样本</span><strong>{report.count}</strong></div>
              </div>
              <div className="report-charts">
                <figure>
                  <figcaption>时间轴：Entropy 与坍塌/事件规模</figcaption>
                  <canvas ref={reportTimelineRef} aria-label="音乐时间、混乱度和事件规模时间序列图" />
                </figure>
                <figure>
                  <figcaption>响度–混乱度相图（点大小＝事件规模）</figcaption>
                  <canvas ref={reportScatterRef} aria-label="音乐响度与系统混乱度散点图" />
                </figure>
                <figure className="fingerprint-chart">
                  <figcaption>
                    <span>系统相图 · MUSIC FINGERPRINT</span>
                    <code>{report.fingerprint}</code>
                  </figcaption>
                  <canvas ref={reportPhaseRef} aria-label="每秒记录的系统熵与临界度轨迹，构成该歌曲的系统指纹" />
                  <small>轨迹按时间由绿转橙；终点以实心圆标记。相同初态下，不同歌曲会形成不同的动力学路径。</small>
                </figure>
              </div>
              <h3>分析结论</h3>
              <p>
                高能量片段的平均混乱度为 <b>{report.highMean.toFixed(3)}</b>，低能量片段为 <b>{report.lowMean.toFixed(3)}</b>；
                差值方向为 <b>{report.highMean >= report.lowMean ? "增加" : "降低"}</b>，近似 t = {report.tScore.toFixed(2)}。
                能量与混乱度的线性关系为
                <b> {Math.abs(report.correlation) < 0.2 ? "较弱" : Math.abs(report.correlation) < 0.5 ? "中等" : "较强"}的{report.correlation >= 0 ? "正相关" : "负相关"}</b>。
                {report.sufficient && report.pApprox < 0.05
                  ? " 在本次启发式检验中，高低能量组差异达到近似显著水平。"
                  : " 本次结果未达到稳定的近似显著水平，可能与曲长、系统初态或事件稀疏有关。"}
                {!report.sufficient && ` 当前只有 ${report.count} 个有效时间点，统计量不稳定，建议使用更长音乐。`}
              </p>
              <footer>仅供娱乐与交互探索：特征和 p 值为浏览器端启发式估计，不构成正式科学结论。</footer>
            </section>
          )}
        </section>

        <aside className={`right-panel ${!showRight ? "panel-hidden" : ""}`}>
          <div className="panel-heading">
            <span>音乐特征</span>
            <em>FAST · 20–250ms</em>
          </div>
          <div className="tempo-card">
            <div>
              <span>BPM</span>
              <strong>{Math.round(features.tempo)}</strong>
            </div>
            <div className="beat-viz">
              {Array.from({ length: 16 }, (_, i) => (
                <i key={i} style={{ height: `${18 + ((i * 17) % 42) * features.low}px` }} />
              ))}
            </div>
          </div>
          <div className="metrics">
            <MetricBar label="RMS 能量" value={features.rms} color="#f6c25f" />
            <MetricBar label="LOW 低频" value={features.low} color="#ff7552" />
            <MetricBar label="MID 中频" value={features.mid} color="#7acb9b" />
            <MetricBar label="HIGH 高频" value={features.high} color="#62aee8" />
            <MetricBar label="CENTROID" value={features.centroid} color="#b591e8" />
          </div>

          <div className="panel-heading emotion-head">
            <span>连续情绪</span>
            <em>SLOW · 2–8s</em>
          </div>
          <div className="radar-instrument">
            <canvas ref={radarCanvasRef} aria-label="音乐情绪四维雷达驾驶仪" />
            <span className="radar-label top">激活</span>
            <span className="radar-label right">正向</span>
            <span className="radar-label bottom">紧张</span>
            <span className="radar-label left">稳定</span>
            <i className="radar-crosshair" />
          </div>
          <div className="emotion-grid">
            {[
              ["激活", "AROUSAL", emotion.arousal, "#f2ba52"],
              ["正向", "VALENCE", emotion.valence, "#62c58e"],
              ["紧张", "TENSION", emotion.tension, "#ee7057"],
              ["稳定", "STABILITY", emotion.stability, "#68a9de"],
            ].map(([zh, en, value, color]) => (
              <div key={String(en)} className="emotion-card">
                <span>{zh}<small>{en}</small></span>
                <strong style={{ color: String(color) }}>{Number(value).toFixed(2)}</strong>
                <i><b style={{ width: `${Number(value) * 100}%`, background: String(color) }} /></i>
              </div>
            ))}
          </div>

          <div className="panel-heading world-head">
            <span>世界参数</span>
            <em>{mode.toUpperCase()} MAPPING</em>
          </div>
          <div className="mapping-list">
            {mappingGroups.map((group, groupIndex) => (
              <section key={group.title} className="mapping-group">
                <header><span>{group.title}</span><em>{group.items.length}</em></header>
                {group.items.map(([label, value, source], itemIndex) => {
                  const id = `map-${groupIndex === 0 ? itemIndex : groupIndex === 1 ? itemIndex + 6 : itemIndex + 12}`;
                  return (
                    <div key={id} className={!mappingEnabled[id] ? "disabled" : ""}>
                      <button
                        className={`mapping-toggle ${mappingEnabled[id] ? "active" : ""}`}
                        onClick={() => setMappingEnabled((old) => ({ ...old, [id]: !old[id] }))}
                        aria-label={`${mappingEnabled[id] ? "关闭" : "开启"}${label}映射`}
                      >
                        <i />
                      </button>
                      <span>{label}<small>← {source}</small></span>
                      <strong>{value}</strong>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
          <div className="summary">
            <div><span>事件总数</span><strong>{stats.events}</strong></div>
            <div><span>{experiment === "sand" ? "最大雪崩" : "最大火势"}</span><strong>{stats.max}</strong></div>
          </div>
        </aside>
      </section>
    </main>
  );
}

