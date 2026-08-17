// ============================================================
// Nexus RGB OS — App Integrations
// Detects non-game apps (Discord, Spotify, OBS, VS Code…)
// and applies per-app RGB profiles through the core engine.
//
// ARCHITECTURE
// ─────────────
//   useAppIntegrations({ bridge, devices, applyColor, applyEffect, notify })
//     │
//     ├── APP_PROFILES        — static config (id, processes, rgb)
//     ├── useMemoryLeak        — no stale updates after unmount
//     ├── poll loop (3 s)     — bridge.getRunningProcesses()
//     ├── active app state    — which profile is live right now
//     └── callbacks           — applyColor / applyEffect via engine
//
// In App.jsx wire it like this:
//
//   const { activeApp, appEnabled, setAppEnabled } =
//     useAppIntegrations({
//       bridge,
//       devices: state.devices,
//       applyColor,
//       applyEffect,
//       notify,
//     });
//
// PRIORITY:  game > app > manual
// If a game profile is active, call pauseAppIntegrations() on this
// hook and it will silently stand down until resumed.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMemoryLeak } from './hooks/useMemoryLeak';

// ── Static profile registry ────────────────────────────────────────────────

export const APP_PROFILES = [
  {
    id:        'discord',
    name:      'Discord',
    icon:      '💬',
    processes: ['Discord.exe', 'DiscordCanary.exe', 'DiscordPTB.exe'],
    rgb:       { color: '#5865f2', effect: 'breathing', brightness: 50, speed: 30 },
    priority:  10,
  },
  {
    id:        'spotify',
    name:      'Spotify',
    icon:      '🎵',
    processes: ['Spotify.exe'],
    rgb:       { color: '#1db954', effect: 'pulse', brightness: 60, speed: 40 },
    priority:  20,
  },
  {
    id:        'obs',
    name:      'OBS Studio',
    icon:      '🔴',
    processes: ['obs64.exe', 'obs.exe', 'obs-browser.exe'],
    rgb:       { color: '#ff2d2d', effect: 'breathing', brightness: 70, speed: 25 },
    priority:  30,   // Higher = shown over discord/spotify when recording
  },
  {
    id:        'vs_code',
    name:      'VS Code',
    icon:      '💻',
    processes: ['Code.exe', 'code - insiders.exe'],
    rgb:       { color: '#007acc', effect: 'breathing', brightness: 55, speed: 25 },
    priority:  5,
  },
  {
    id:        'chrome',
    name:      'Chrome',
    icon:      '🌐',
    processes: ['chrome.exe'],
    rgb:       { color: '#4285f4', effect: 'static', brightness: 45, speed: 0 },
    priority:  1,
  },
  {
    id:        'firefox',
    name:      'Firefox',
    icon:      '🦊',
    processes: ['firefox.exe'],
    rgb:       { color: '#ff7139', effect: 'static', brightness: 45, speed: 0 },
    priority:  1,
  },
  {
    id:        'steam',
    name:      'Steam',
    icon:      '🎮',
    processes: ['steam.exe', 'steamwebhelper.exe'],
    rgb:       { color: '#1b2838', effect: 'breathing', brightness: 35, speed: 20 },
    priority:  8,
  },
  {
    id:        'slack',
    name:      'Slack',
    icon:      '💼',
    processes: ['slack.exe'],
    rgb:       { color: '#4a154b', effect: 'static', brightness: 40, speed: 0 },
    priority:  10,
  },
  {
    id:        'zoom',
    name:      'Zoom',
    icon:      '📹',
    processes: ['Zoom.exe', 'ZoomLauncher.exe'],
    rgb:       { color: '#2d8cff', effect: 'pulse', brightness: 65, speed: 35 },
    priority:  25,   // High priority — you're in a meeting
  },
  {
    id:        'figma',
    name:      'Figma',
    icon:      '🎨',
    processes: ['Figma.exe', 'figma_agent.exe'],
    rgb:       { color: '#f24e1e', effect: 'breathing', brightness: 50, speed: 30 },
    priority:  12,
  },
  {
    id:        'premiere',
    name:      'Adobe Premiere',
    icon:      '🎬',
    processes: ['Adobe Premiere Pro.exe'],
    rgb:       { color: '#9999ff', effect: 'breathing', brightness: 55, speed: 20 },
    priority:  15,
  },
  {
    id:        'blender',
    name:      'Blender',
    icon:      '🟠',
    processes: ['blender.exe'],
    rgb:       { color: '#ea7600', effect: 'breathing', brightness: 60, speed: 28 },
    priority:  12,
  },
];

// Poll interval (ms) — same as gameDetector for consistency
const POLL_INTERVAL_MS = 3000;

// How long to debounce before switching profiles on app change
const DEBOUNCE_MS = 800;

// ── Hook ──────────────────────────────────────────────────────────────────

/**
 * useAppIntegrations
 *
 * @param {object} opts
 * @param {object}   opts.bridge        — useHardwareBridge instance
 * @param {Device[]} opts.devices       — current device list from engine state
 * @param {Function} opts.applyColor    — engine.applyColor(id, hex)
 * @param {Function} opts.applyEffect   — engine.applyEffect(id, effectId)
 * @param {Function} opts.notify        — engine.notify(msg, type)
 * @param {boolean}  [opts.gamePaused]  — pass true while a game is active
 *
 * @returns {{
 *   activeApp:        AppProfile | null,
 *   runningApps:      AppProfile[],
 *   appEnabled:       boolean,
 *   setAppEnabled:    (v: boolean) => void,
 *   pauseForGame:     () => void,
 *   resumeFromGame:   () => void,
 *   forceApply:       (profile: AppProfile) => void,
 *   APP_PROFILES:     AppProfile[],
 * }}
 */
export function useAppIntegrations({
  bridge,
  devices      = [],
  applyColor   = null,
  applyEffect  = null,
  notify       = null,
  gamePaused   = false,
  onPollSuccess = null,  // CRE heartbeat callback — called on every successful process scan
}) {
  const { safeSet, timers } = useMemoryLeak();
  const { safeInterval, clearSafeInterval, safeTimeout } = timers;

  const [activeApp,    _setActiveApp]    = useState(null);
  const [runningApps,  _setRunningApps]  = useState([]);
  const [appEnabled,   _setAppEnabled]   = useState(true);
  const [paused,       _setPaused]       = useState(gamePaused);

  const setActiveApp   = safeSet(_setActiveApp);
  const setRunningApps = safeSet(_setRunningApps);
  const setAppEnabled  = safeSet(_setAppEnabled);
  const setPaused      = safeSet(_setPaused);

  // Keep refs for values used inside interval callbacks
  const devicesRef    = useRef(devices);
  const enabledRef    = useRef(appEnabled);
  const pausedRef     = useRef(paused);
  const activeRef     = useRef(null);          // currently applied profile id
  const debounceRef   = useRef(null);

  useEffect(() => { devicesRef.current  = devices;    }, [devices]);
  useEffect(() => { enabledRef.current  = appEnabled; }, [appEnabled]);
  useEffect(() => { pausedRef.current   = paused;     }, [paused]);

  // ── Apply a profile to all devices ─────────────────────────────────────

  const applyProfile = useCallback(async (profile) => {
    if (!applyColor || !applyEffect) return;
    const devs = devicesRef.current;
    if (!devs.length) return;

    const { color, effect } = profile.rgb;

    await Promise.all(
      devs.map(async (d) => {
        await applyColor(d.id, color);
        await applyEffect(d.id, effect);
      })
    );
  }, [applyColor, applyEffect]);

  // ── Detect & switch ─────────────────────────────────────────────────────

  // Fix: onPollSuccess via ref so detectAndSwitch doesn't need it in dep array
  const onPollSuccessRef = useRef(onPollSuccess);
  useEffect(() => { onPollSuccessRef.current = onPollSuccess; }, [onPollSuccess]);

  const detectAndSwitch = useCallback(async () => {
    if (!enabledRef.current || pausedRef.current) return;

    // getRunningProcesses is an Electron-side IPC that returns string[]
    // In browser stub mode it returns null / undefined — we bail gracefully.
    let procs;
    try {
      procs = await bridge?.getRunningProcesses?.();
    } catch {
      return;
    }
    // null = rate limited — skip this poll cycle, keep current state
    if (procs === null) return;
    // non-array = error — bail
    if (!Array.isArray(procs)) return;

    const procSet = new Set(procs.map(p => p.toLowerCase()));

    // Beat CRE game detection heartbeat — scan succeeded
    onPollSuccessRef.current?.();

    // Find all matching profiles, sort by priority descending
    const matches = APP_PROFILES.filter(profile =>
      profile.processes.some(exe => procSet.has(exe.toLowerCase()))
    ).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    setRunningApps(matches);

    const topMatch = matches[0] ?? null;
    const topId    = topMatch?.id ?? null;

    // No change — skip
    if (topId === activeRef.current) return;

    // Debounce to avoid flickering when processes briefly appear/disappear
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      activeRef.current = topId;
      setActiveApp(topMatch);

      if (topMatch) {
        await applyProfile(topMatch);
        notify?.(`${topMatch.icon} ${topMatch.name} detected`, 'success');
      }
    }, DEBOUNCE_MS);
  }, [bridge, applyProfile, notify, setActiveApp, setRunningApps]);

  // ── Poll loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!bridge?.isElectron) return;  // Process polling only works in Electron

    const id = safeInterval(detectAndSwitch, POLL_INTERVAL_MS);
    detectAndSwitch();  // Run immediately on mount

    return () => {
      clearSafeInterval(id);
      // Clear any pending debounce on unmount — prevents setState after unmount
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    };
  }, [bridge?.isElectron, detectAndSwitch, safeInterval, clearSafeInterval]);

  // ── Pause / resume for game priority ────────────────────────────────────

  const pauseForGame = useCallback(() => {
    setPaused(true);
    pausedRef.current = true;
    setActiveApp(null);
    activeRef.current = null;
  }, [setPaused, setActiveApp]);

  const resumeFromGame = useCallback(() => {
    setPaused(false);
    pausedRef.current = false;
    // Immediately re-detect so RGB snaps back
    safeTimeout(detectAndSwitch, 200);
  }, [setPaused, detectAndSwitch, safeTimeout]);

  // ── Sync with gamePaused prop ────────────────────────────────────────────

  useEffect(() => {
    if (gamePaused) pauseForGame();
    else resumeFromGame();
  // Only react to external prop changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePaused]);

  // ── Force-apply (called from UI override) ────────────────────────────────

  const forceApply = useCallback(async (profile) => {
    activeRef.current = profile.id;
    setActiveApp(profile);
    await applyProfile(profile);
    notify?.(`${profile.icon} ${profile.name} applied`, 'success');
  }, [applyProfile, notify, setActiveApp]);

  // ── Enable toggle — restore manual control on disable ────────────────────

  const toggleEnabled = useCallback((val) => {
    setAppEnabled(val);
    enabledRef.current = val;
    if (!val) {
      setActiveApp(null);
      activeRef.current = null;
    }
  }, [setAppEnabled, setActiveApp]);

  return {
    activeApp,
    runningApps,
    appEnabled,
    setAppEnabled:  toggleEnabled,
    pauseForGame,
    resumeFromGame,
    forceApply,
    APP_PROFILES,
  };
}

export default useAppIntegrations;
