import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Mode, PipelineEvent, Settings, StageId } from '../pipeline/events';
import { deriveView, emptyView, type ViewState } from '../pipeline/derive';
import {
  DEFAULT_SPEED,
  Scheduler,
  SPEED_PRESETS,
  clampSpeed,
  type SchedulerState,
} from '../pipeline/scheduler';
import type { EventSource } from '../pipeline/sources/EventSource';
import { LabSource } from '../pipeline/sources/LabSource';
import { LiveSource } from '../pipeline/sources/LiveSource';
import { MockSource } from '../pipeline/sources/MockSource';
import { deleteRun, listRuns, loadRun, saveRun, summarize, type RunSummary } from '../persistence/runs';
import { DEFAULT_PRESET_ID, PRESETS } from '../sim/presets';

export type ExplainLevel = 'simple' | 'math';

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-sonnet-5-5',
  systemPrompt: 'You are a concise, friendly assistant.',
  maxTokens: 256,
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
};

export const MODE_LABEL: Record<Mode, string> = {
  mock: 'Mock',
  live: 'Live API',
  lab: 'Lab model',
};

interface Prefs {
  speed: number;
  explainLevel: ExplainLevel;
  mode: Mode;
  autoPause: boolean;
  cameraFollow: boolean;
  soundOn: boolean;
  settings: Settings;
  proxyUrl: string;
  prompt: string;
  tourDone: boolean;
}

const PREFS_KEY = 'tokenscope:prefs:v1';

function loadPrefs(): Partial<Prefs> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. */
  }
}

const prefs = loadPrefs();
const defaultPrompt =
  PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)?.prompt ?? PRESETS[0]?.prompt ?? '';

/** The single scheduler instance; the store mirrors its state. */
export const scheduler = new Scheduler({ speed: prefs.speed ?? DEFAULT_SPEED, autoPauseOnStage: prefs.autoPause ?? false });

export interface HealthInfo {
  ok: boolean;
  provider: string;
  hasKey: boolean;
  model: string | null;
  lab: { ok: boolean; model?: string; nLayers?: number };
}

export type Availability = 'ready' | 'unavailable' | 'unknown';

export function modeAvailability(mode: Mode, health: HealthInfo | null): { state: Availability; detail: string } {
  if (mode === 'mock') return { state: 'ready', detail: 'Canned run — always available' };
  if (!health) return { state: 'unknown', detail: 'Proxy not reachable — start it with npm run dev' };
  if (mode === 'live') {
    return health.hasKey
      ? { state: 'ready', detail: `${health.provider} · ${health.model ?? 'default model'}` }
      : { state: 'unavailable', detail: `No API key for ${health.provider}: copy .env.example to server/.env` };
  }
  return health.lab.ok
    ? { state: 'ready', detail: `${health.lab.model ?? 'model'} loaded (${health.lab.nLayers ?? '?'} layers)` }
    : { state: 'unavailable', detail: 'Lab server not running: npm run lab' };
}

export interface AppState {
  transport: SchedulerState;
  view: ViewState;
  health: HealthInfo | null;
  checkHealth: () => Promise<void>;

  mode: Mode;
  prompt: string;
  settings: Settings;
  proxyUrl: string;
  running: boolean;
  error: string | null;
  notice: string | null;
  history: RunSummary[];
  historyOpen: boolean;

  explainLevel: ExplainLevel;
  inspectorOpen: boolean;
  /** Event pinned in the inspector; null = follow the latest. */
  selectedSeq: number | null;
  /** Stage the user expanded by hand; null = follow the pipeline. */
  focusedStage: StageId | null;
  cameraFollow: boolean;
  soundOn: boolean;
  settingsOpen: boolean;
  tourStep: number | null;

  setPrompt: (p: string) => void;
  setMode: (m: Mode) => void;
  setSettings: (s: Partial<Settings>) => void;
  setProxyUrl: (u: string) => void;
  send: () => Promise<void>;
  stop: () => void;
  refreshHistory: () => Promise<void>;
  openRun: (id: string) => Promise<void>;
  removeRun: (id: string) => Promise<void>;
  setHistoryOpen: (open: boolean) => void;

  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: number) => void;
  bumpSpeed: (dir: 1 | -1) => void;
  stepEvent: (dir: 1 | -1) => void;
  stepStage: (dir: 1 | -1) => void;
  seekTime: (ms: number) => void;
  seekEvent: (i: number) => void;
  seekStage: (stage: StageId) => void;
  catchUp: () => void;
  setAutoPause: (on: boolean) => void;

  setExplainLevel: (l: ExplainLevel) => void;
  toggleInspector: (open?: boolean) => void;
  select: (seq: number | null) => void;
  setFocusedStage: (s: StageId | null) => void;
  setCameraFollow: (on: boolean) => void;
  setSoundOn: (on: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setTourStep: (step: number | null) => void;
  dismissNotice: () => void;
}

/** Sources registered per mode. */
export const SOURCE_FACTORIES: Partial<Record<Mode, (proxyUrl: string) => EventSource>> = {
  mock: () => new MockSource(),
  live: (proxyUrl) => new LiveSource(proxyUrl),
  lab: (proxyUrl) => new LabSource(proxyUrl),
};

let abortRef: AbortController | null = null;
let pending: PipelineEvent[] = [];
let flushQueued = false;

/** Batch appends into one scheduler update per microtask. */
function queueAppend(e: PipelineEvent): void {
  pending.push(e);
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    const batch = pending;
    pending = [];
    scheduler.appendMany(batch);
  });
}

async function persistCurrentRun(done: boolean): Promise<void> {
  const events = scheduler.events.slice();
  const summary = summarize(events, done);
  if (!summary || events.length < 3) return;
  try {
    await saveRun({ ...summary, events });
  } catch {
    /* quota or private mode: history is a convenience */
  }
}

export const useStore = create<AppState>()(
  subscribeWithSelector((set, get) => {
    const persist = (): void => {
      const s = get();
      savePrefs({
        speed: s.transport.speed,
        explainLevel: s.explainLevel,
        mode: s.mode,
        autoPause: s.transport.autoPauseOnStage,
        cameraFollow: s.cameraFollow,
        soundOn: s.soundOn,
        settings: s.settings,
        proxyUrl: s.proxyUrl,
        prompt: s.prompt,
        tourDone: s.tourStep === null,
      });
    };

    return {
      transport: scheduler.getState(),
      view: emptyView(),
      health: null,
      checkHealth: async () => {
        try {
          const res = await fetch(`${get().proxyUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
          set({ health: res.ok ? ((await res.json()) as HealthInfo) : null });
        } catch {
          set({ health: null });
        }
      },

      mode: prefs.mode ?? 'mock',
      prompt: prefs.prompt ?? defaultPrompt,
      settings: { ...DEFAULT_SETTINGS, ...prefs.settings },
      proxyUrl: prefs.proxyUrl ?? '/api',
      running: false,
      error: null,
      notice: null,
      history: [],
      historyOpen: false,

      explainLevel: prefs.explainLevel ?? 'simple',
      inspectorOpen: false,
      selectedSeq: null,
      focusedStage: null,
      cameraFollow: prefs.cameraFollow ?? true,
      soundOn: prefs.soundOn ?? false,
      settingsOpen: false,
      tourStep: prefs.tourDone ? null : 0,

      setPrompt: (prompt) => {
        set({ prompt });
        persist();
      },
      setMode: (mode) => {
        const changed = mode !== get().mode;
        set({ mode });
        persist();
        if (changed && get().transport.eventCount > 0) {
          set({ notice: `Switched to ${MODE_LABEL[mode]}. Press Send to run the prompt through it.` });
        }
        if (mode !== 'mock') void get().checkHealth();
      },
      setSettings: (patch) => {
        set({ settings: { ...get().settings, ...patch } });
        persist();
      },
      setProxyUrl: (proxyUrl) => {
        set({ proxyUrl });
        persist();
        void get().checkHealth();
      },

      send: async () => {
        const { prompt, mode, settings, proxyUrl } = get();
        if (!prompt.trim()) return;
        get().stop();
        const controller = new AbortController();
        abortRef = controller;
        pending = [];
        scheduler.reset();
        set({ running: true, error: null, selectedSeq: null, focusedStage: null, historyOpen: false });
        const factory = SOURCE_FACTORIES[mode] ?? SOURCE_FACTORIES.mock;
        const source = factory ? factory(proxyUrl) : new MockSource();
        if (source.kind !== mode) {
          set({ notice: `${MODE_LABEL[mode]} mode is not available yet — showing a Mock run instead.` });
        }
        scheduler.play();
        let ok = false;
        try {
          await source.run(prompt, settings, queueAppend, controller.signal);
          await Promise.resolve(); // let the last microtask flush land
          ok = !controller.signal.aborted;
          if (ok) scheduler.markSourceDone();
        } catch (err) {
          if (!controller.signal.aborted) {
            await Promise.resolve();
            set({ error: err instanceof Error ? err.message : String(err) });
            scheduler.markSourceDone();
          }
        } finally {
          if (abortRef === controller) {
            abortRef = null;
            set({ running: false });
          }
        }
        if (!controller.signal.aborted) {
          await persistCurrentRun(ok);
          void get().refreshHistory();
        }
      },
      stop: () => {
        if (abortRef) {
          abortRef.abort();
          abortRef = null;
          scheduler.markSourceDone();
        }
        set({ running: false });
      },
      refreshHistory: async () => {
        try {
          set({ history: await listRuns() });
        } catch {
          set({ history: [] });
        }
      },
      openRun: async (id) => {
        const rec = await loadRun(id);
        if (!rec) return;
        get().stop();
        scheduler.load(rec.events, { done: rec.done });
        set({ prompt: rec.prompt, selectedSeq: null, focusedStage: null, historyOpen: false, error: null });
        scheduler.seekEvent(-1);
        scheduler.play();
      },
      removeRun: async (id) => {
        await deleteRun(id);
        await get().refreshHistory();
      },
      setHistoryOpen: (historyOpen) => {
        set({ historyOpen });
        if (historyOpen) void get().refreshHistory();
      },

      play: () => scheduler.play(),
      pause: () => scheduler.pause(),
      toggle: () => scheduler.toggle(),
      setSpeed: (s) => {
        scheduler.setSpeed(s);
        persist();
      },
      bumpSpeed: (dir) => {
        const cur = get().transport.speed;
        const idx = SPEED_PRESETS.findIndex((p) => p >= cur - 1e-9);
        const base = idx < 0 ? SPEED_PRESETS.length - 1 : idx;
        const nextIdx = Math.max(0, Math.min(SPEED_PRESETS.length - 1, base + dir));
        scheduler.setSpeed(clampSpeed(SPEED_PRESETS[nextIdx] ?? cur));
        persist();
      },
      stepEvent: (dir) => scheduler.stepEvent(dir),
      stepStage: (dir) => scheduler.stepStage(dir),
      seekTime: (ms) => scheduler.seekTime(ms),
      seekEvent: (i) => scheduler.seekEvent(i),
      seekStage: (stage) => {
        const i = scheduler.events.findIndex((e) => e.stage === stage);
        if (i >= 0) {
          scheduler.pause();
          scheduler.seekEvent(i);
        }
        set({ focusedStage: null });
      },
      catchUp: () => scheduler.catchUp(),
      setAutoPause: (on) => {
        scheduler.setAutoPauseOnStage(on);
        persist();
      },

      setExplainLevel: (explainLevel) => {
        set({ explainLevel });
        persist();
      },
      toggleInspector: (open) => set({ inspectorOpen: open ?? !get().inspectorOpen }),
      select: (selectedSeq) => set({ selectedSeq, inspectorOpen: true }),
      setFocusedStage: (focusedStage) => set({ focusedStage }),
      setCameraFollow: (cameraFollow) => {
        set({ cameraFollow });
        persist();
      },
      setSoundOn: (soundOn) => {
        set({ soundOn });
        persist();
      },
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setTourStep: (tourStep) => {
        set({ tourStep });
        persist();
      },
      dismissNotice: () => set({ notice: null, error: null }),
    };
  }),
);

// Mirror scheduler state into the store; re-derive the view only when the cursor moves.
scheduler.subscribe((t) => {
  const prev = useStore.getState();
  const sameCursor = t.cursor === prev.view.cursor && t.eventCount >= prev.transport.eventCount;
  const view = sameCursor ? prev.view : deriveView(scheduler.events, t.cursor, prev.view);
  useStore.setState({ transport: t, view });
});

/** Convenience: the event currently shown in the inspector. */
export function selectInspectedEvent(s: AppState): PipelineEvent | null {
  if (s.selectedSeq !== null) return scheduler.events[s.selectedSeq] ?? null;
  return s.view.lastEvent;
}
