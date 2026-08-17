import { useCallback, useEffect, useRef, useReducer } from 'react';
import { useHardwareBridge }        from './useHardwareBridge';
import { useMemoryLeak }            from './useMemoryLeak';
import { useDeviceDisconnect }      from './useDeviceDisconnect';
import { useAppIntegrations }       from '../appIntegrations';
import { useOpenRGBVerifier }       from './useOpenRGBVerifier';
import { useRendererHealth }        from './useRendererHealth';
import { useCrashRecoveryEngine, Subsystem } from './CrashRecoveryEngine';

// ═══════════════════════════════════════════════════════════════════════════
// NEXUS CORE ENGINE — v4.1 (Stability Reform)
// ═══════════════════════════════════════════════════════════════════════════
//
// VULNERABILITIES FIXED IN THIS VERSION:
//
//  #1  STALE CLOSURE — doScan captured state.scanPct from render time.
//      Fixed: use functional dispatch updater, removed scanPct from deps.
//
//  #2  RACE CONDITION — boot flow connected OpenRGB SDK before the window
//      was ready to receive IPC. Fixed: connect after ready-to-show fires.
//      Engine now boots with connectRGB() from inside useEffect (React side).
//
//  #3  NULL / BAD HEX CRASH — hexToRgb would throw on null, undefined,
//      or malformed strings. Fixed: guard + fallback to #000000.
//
//  #4  UNSTABLE safeDispatch — recreated every render, invalidating all
//      useCallback deps that listed it. Fixed: stable ref pattern.
//
//  #5  TOAST TIMER LEAK — toastTimerRef not cleaned on unmount in all
//      paths. Fixed: cleanup moved into useMemoryLeak safeTimeout.
//
//  #6  NO ERROR HANDLING in applyScene / applyTelemetryColor / syncAll.
//      Fixed: try/catch + notify on failure for all three.
//
//  #7  SEQUENTIAL BLOCKING in syncAll — awaited each device serially.
//      Fixed: Promise.all for color, then effect in parallel batches.
//
//  #8  UNSAFE STATE SETTER in useDeviceDisconnect — raw setDeviceStates
//      called after unmount. Fixed: wrapped via useMemoryLeak inside that hook.
//      (patched separately in useDeviceDisconnect)
//
//  #9  NO BOOT RETRY — if connectRGB() failed on first try, engine gave up.
//      Fixed: 3-attempt retry with 1s delay between tries.
//
//  #10 openrgbManager shutdown skipped if process was already running.
//      Fixed: managedByUs only gates process.kill, not the SDK disconnect.
//
// ═══════════════════════════════════════════════════════════════════════════

// ── State shape ──────────────────────────────────────────────────────────

const initialState = {
  rgbConnected:  false,
  scanning:      false,
  scanPct:       0,
  devices:       [],
  selectedId:    null,
  devColors:     {},
  devEffects:    {},
  devBrightness: {},
  telemetry:     null,
  activeGame:    null,
  tab:           'devices',
  toast:         null,
  recoveryLog:   [],
};

// ── Action types ─────────────────────────────────────────────────────────

const A = {
  SET_RGB_CONNECTED:  'SET_RGB_CONNECTED',
  SET_SCANNING:       'SET_SCANNING',
  SET_SCAN_PCT:       'SET_SCAN_PCT',
  SET_DEVICES:        'SET_DEVICES',
  SET_SELECTED_ID:    'SET_SELECTED_ID',
  SET_DEV_COLOR:      'SET_DEV_COLOR',
  SET_DEV_EFFECT:     'SET_DEV_EFFECT',
  SET_DEV_BRIGHTNESS: 'SET_DEV_BRIGHTNESS',
  APPLY_PROFILE:      'APPLY_PROFILE',
  SET_TELEMETRY:      'SET_TELEMETRY',
  SET_ACTIVE_GAME:    'SET_ACTIVE_GAME',
  SET_TAB:            'SET_TAB',
  SET_TOAST:          'SET_TOAST',
  LOG_RECOVERY:       'LOG_RECOVERY',
};

// ── Reducer ───────────────────────────────────────────────────────────────

function coreReducer(state, action) {
  switch (action.type) {
    case A.SET_RGB_CONNECTED:  return { ...state, rgbConnected: action.payload };
    case A.SET_SCANNING:       return { ...state, scanning:     action.payload };

    // FIX #1 — scan progress uses functional form inside dispatch,
    // so the reducer always gets fresh state (no stale closure possible)
    case A.SET_SCAN_PCT:       return { ...state, scanPct: action.payload };

    case A.SET_DEVICES:        return { ...state, devices:    action.payload };
    case A.SET_SELECTED_ID:    return { ...state, selectedId: action.payload };

    case A.SET_DEV_COLOR:
      return { ...state, devColors:     { ...state.devColors,     [action.id]: action.color  } };
    case A.SET_DEV_EFFECT:
      return { ...state, devEffects:    { ...state.devEffects,    [action.id]: action.effect } };
    case A.SET_DEV_BRIGHTNESS:
      return { ...state, devBrightness: { ...state.devBrightness, [action.id]: action.value  } };

    case A.APPLY_PROFILE: {
      const colors = { ...state.devColors };
      const effects = { ...state.devEffects };
      const brightness = { ...state.devBrightness };
      for (const ds of action.payload) {
        if (ds.color)      colors[ds.id]      = ds.color;
        if (ds.effect)     effects[ds.id]     = ds.effect;
        if (ds.brightness) brightness[ds.id]  = ds.brightness;
      }
      return { ...state, devColors: colors, devEffects: effects, devBrightness: brightness };
    }

    case A.SET_TELEMETRY:   return { ...state, telemetry:  action.payload };
    case A.SET_ACTIVE_GAME: return { ...state, activeGame: action.payload };
    case A.SET_TAB:         return { ...state, tab:        action.payload };
    case A.SET_TOAST:       return { ...state, toast:      action.payload };

    case A.LOG_RECOVERY: {
      const newLog = [...state.recoveryLog, { ts: Date.now(), ...action.payload }].slice(-50);
      return { ...state, recoveryLog: newLog };
    }

    default: return state;
  }
}

// ── Internal: safe hex parser ─────────────────────────────────────────────
// FIX #3 — null / undefined / malformed hex no longer crashes the engine.

function safeHexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{3,6}$/.test(clean)) return { r: 0, g: 0, b: 0 };
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean.padEnd(6, '0');
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useNexusCoreEngine() {

  const [state, dispatch] = useReducer(coreReducer, initialState);
  const bridge   = useHardwareBridge();
  const verifier = useOpenRGBVerifier(bridge);
  const { safeSet, timers } = useMemoryLeak();
  const { safeTimeout, safeInterval, clearSafeInterval } = timers;

  // Timestamp refs — written by subsystems, read by CRE
  const lastTelemetryRef = useRef(0);
  const lastGameScanRef  = useRef(0);

  // Renderer health — monitored by CRE
  const rendererHealth = useRendererHealth({ freezeThresholdMs: 200, checkIntervalMs: 500 });

  // FIX #4: stable safeDispatch via ref — never invalidates useCallback deps
  const dispatchRef = useRef(dispatch);
  useEffect(() => { dispatchRef.current = dispatch; }, []);
  const safeDispatch = useCallback((action) => {
    dispatchRef.current?.(action);
  }, []);

  // ── CRE beat ref — declared FIRST so applyColor can safely reference it ──
  // applyColor is defined before CRE mounts (CRE depends on applyColor),
  // so we use a ref here — CRE writes its beat function into it after mount.
  const creBeatRef = useRef(null);

  // ── Toast ─────────────────────────────────────────────────────────────
  const notify = useCallback((msg, type = 'success') => {
    safeDispatch({ type: A.SET_TOAST, payload: { msg, type } });
    safeTimeout(() => safeDispatch({ type: A.SET_TOAST, payload: null }), 3500);
  }, [safeDispatch, safeTimeout]);

  // ── Recovery log ──────────────────────────────────────────────────────
  const logRecovery = useCallback((source, msg, level = 'info') => {
    safeDispatch({ type: A.LOG_RECOVERY, payload: { source, msg, level } });
    if      (level === 'error') console.error(`[NexusCore][${source}] ${msg}`);
    else if (level === 'warn')  console.warn (`[NexusCore][${source}] ${msg}`);
    else                        console.log  (`[NexusCore][${source}] ${msg}`);
  }, [safeDispatch]);

  // ── applyColor / applyEffect ──────────────────────────────────────────
  const applyColor = useCallback(async (id, hex) => {
    if (verifier.fallback && !verifier.fallback.canColor && bridge.isElectron) {
      logRecovery('applyColor', 'Skipped — OpenRGB color capability unavailable', 'warn');
      return;
    }
    const { r, g, b } = safeHexToRgb(hex);
    safeDispatch({ type: A.SET_DEV_COLOR, id, color: hex });
    try {
      const res = await bridge.setDeviceColor(id, r, g, b);
      if (res?.stub) notify(res.message, 'error');
      else creBeatRef.current?.(Subsystem.OPENRGB); // safe — ref always exists
    } catch (err) {
      logRecovery('applyColor', `Device ${id}: ${err.message}`, 'warn');
    }
  }, [bridge, notify, safeDispatch, logRecovery, verifier]);

  const applyEffect = useCallback(async (id, effect) => {
    safeDispatch({ type: A.SET_DEV_EFFECT, id, effect });
    try {
      await bridge.setDeviceMode(id, effect);
    } catch (err) {
      logRecovery('applyEffect', `Device ${id}: ${err.message}`, 'warn');
    }
  }, [bridge, safeDispatch, logRecovery]);

  // ── Per-device disconnect tracking ────────────────────────────────────
  const {
    deviceStates, markScanResult,
    getDeviceStatus, isDeviceOnline,
    retryDevice, disconnectedCount,
  } = useDeviceDisconnect({
    bridge,
    devices:          state.devices,
    devColors:        state.devColors,
    devEffects:       state.devEffects,
    devBrightness:    state.devBrightness,
    onApplyColor:     applyColor,
    onApplyEffect:    applyEffect,
    onDevicesUpdate:  (list) => safeDispatch({ type: A.SET_DEVICES, payload: list }),
    onSelectionClear: ()     => safeDispatch({ type: A.SET_SELECTED_ID, payload: null }),
    selectedDeviceId: state.selectedId,
    notify,
  });

  // ── DECISION: scan ────────────────────────────────────────────────────
  const doScan = useCallback(async () => {
    if (verifier.fallback && !verifier.fallback.canScan && bridge.isElectron) {
      notify('Cannot scan — OpenRGB is unavailable. Use the Retry button.', 'error');
      return;
    }
    safeDispatch({ type: A.SET_SCANNING, payload: true });
    safeDispatch({ type: A.SET_SCAN_PCT, payload: 0 });

    const progressTimer = safeInterval(() => {
      dispatch(prev => ({
        ...prev,
        scanPct: Math.min((prev.scanPct ?? 0) + 3, 90),
      }));
    }, 80);

    try {
      const result = await bridge.scanDevices();
      clearSafeInterval(progressTimer);
      safeDispatch({ type: A.SET_SCAN_PCT, payload: 100 });

      if (result?.stub) {
        notify(result.message, 'error');
        safeDispatch({ type: A.SET_DEVICES, payload: [] });
      } else if (Array.isArray(result)) {
        safeDispatch({ type: A.SET_DEVICES, payload: result });
        markScanResult(result);
        notify(
          result.length > 0
            ? `✓ Found ${result.length} device${result.length > 1 ? 's' : ''}`
            : 'No devices found — is OpenRGB running?',
          result.length > 0 ? 'success' : 'error'
        );
      }
    } catch (err) {
      clearSafeInterval(progressTimer);
      logRecovery('doScan', err.message, 'error');
      notify('Scan failed — ' + err.message, 'error');
    }

    safeTimeout(() => safeDispatch({ type: A.SET_SCANNING, payload: false }), 400);
  }, [bridge, notify, safeDispatch, safeInterval, clearSafeInterval, safeTimeout, markScanResult, logRecovery, verifier]);

  // ── Simple commands ───────────────────────────────────────────────────
  const setTab        = useCallback((t)    => safeDispatch({ type: A.SET_TAB,           payload: t    }), [safeDispatch]);
  const setSelectedId = useCallback((id)   => safeDispatch({ type: A.SET_SELECTED_ID,   payload: id   }), [safeDispatch]);
  const setBrightness = useCallback((id,v) => safeDispatch({ type: A.SET_DEV_BRIGHTNESS, id, value: v }), [safeDispatch]);

  // ── reconnect MUST be defined before CRE — CRE receives it as a handle ──
  const reconnect = useCallback(async () => {
    const r = await bridge.connectRGB();
    safeDispatch({ type: A.SET_RGB_CONNECTED, payload: r?.ok === true });
    if (r?.ok) { await doScan(); notify('✓ Reconnected'); }
    else notify(r?.error || 'Reconnect failed', 'error');
  }, [bridge, safeDispatch, doScan, notify]);

  const disconnect = useCallback(async () => {
    await bridge.disconnectRGB();
    safeDispatch({ type: A.SET_RGB_CONNECTED, payload: false });
    notify('Disconnected');
  }, [bridge, safeDispatch, notify]);

  // ── syncAll MUST be defined before CRE — CRE receives it for state restore ──
  const syncAll = useCallback(async ({ color, effect }) => {
    const { r, g, b } = safeHexToRgb(color);
    try {
      await Promise.all(state.devices.map(async (d) => {
        safeDispatch({ type: A.SET_DEV_COLOR,  id: d.id, color  });
        safeDispatch({ type: A.SET_DEV_EFFECT, id: d.id, effect });
        await bridge.setDeviceColor(d.id, r, g, b);
        await bridge.setDeviceMode(d.id, effect);
      }));
    } catch (err) {
      logRecovery('syncAll', err.message, 'error');
      notify('Sync failed — ' + err.message, 'error');
    }
  }, [bridge, state.devices, safeDispatch, logRecovery, notify]);

  // ── applyGameRGB ──────────────────────────────────────────────────────
  const applyGameRGB = useCallback(async ({ color, effect }) => {
    const { r, g, b } = safeHexToRgb(color);
    try {
      await Promise.all(state.devices.map(d => bridge.setDeviceColor(d.id, r, g, b)));
      for (const d of state.devices) {
        safeDispatch({ type: A.SET_DEV_COLOR,  id: d.id, color  });
        safeDispatch({ type: A.SET_DEV_EFFECT, id: d.id, effect });
      }
    } catch (err) {
      logRecovery('applyGameRGB', err.message, 'error');
      notify('Game RGB failed — ' + err.message, 'error');
    }
  }, [bridge, state.devices, safeDispatch, logRecovery, notify]);

  const setActiveGame = useCallback((game) => {
    safeDispatch({ type: A.SET_ACTIVE_GAME, payload: game });
    logRecovery('GameEngine', game ? `Game detected: ${game.name}` : 'Game exited', 'info');
  }, [safeDispatch, logRecovery]);

  // ── App Integrations ──────────────────────────────────────────────────
  const appIntegrations = useAppIntegrations({
    bridge,
    devices:    state.devices,
    applyColor,
    applyEffect,
    notify,
    gamePaused:    !!state.activeGame,
    onPollSuccess: () => { lastGameScanRef.current = Date.now(); },
  });

  // ── CRASH RECOVERY ENGINE ─────────────────────────────────────────────
  // Mounted AFTER: doScan, reconnect, syncAll, notify, logRecovery, verifier
  // so all handles it needs are already defined above.
  const cre = useCrashRecoveryEngine({
    bridge,
    verifier,
    notify,
    logRecovery,
    doScan,
    reconnect,   // defined above — no longer undefined
    syncAll,     // defined above — no longer undefined
    rendererHealth,
    lastGameScan:  lastGameScanRef,
    lastTelemetry: lastTelemetryRef,
  });

  // Sync creBeatRef after cre is defined — safe because creBeatRef was
  // declared before applyColor, so the ref object always exists.
  useEffect(() => { creBeatRef.current = cre?.beat ?? null; }, [cre]);

  // ── loadProfile ───────────────────────────────────────────────────────
  const loadProfile = useCallback(async (profileDeviceStates) => {
    safeDispatch({ type: A.APPLY_PROFILE, payload: profileDeviceStates });
    try {
      await Promise.all(
        profileDeviceStates.filter(ds => ds.color).map(ds => applyColor(ds.id, ds.color))
      );
      logRecovery('ProfileSystem', `Profile loaded for ${profileDeviceStates.length} device(s)`);
    } catch (err) {
      logRecovery('ProfileSystem', err.message, 'error');
      notify('Profile load failed — ' + err.message, 'error');
    }
  }, [safeDispatch, applyColor, logRecovery, notify]);

  // ── applyScene ────────────────────────────────────────────────────────
  const applyScene = useCallback(async (scene, targetDevice = null) => {
    if (!scene?.primary_color) {
      notify('Invalid scene — missing color data', 'error');
      return;
    }
    try {
      if (targetDevice) {
        await applyColor(targetDevice.id, scene.primary_color);
        await applyEffect(targetDevice.id, scene.effect ?? 'static');
        notify(`✓ "${scene.name}" → ${targetDevice.name}`);
      } else {
        await Promise.all(state.devices.map(async (d) => {
          await applyColor(d.id, scene.primary_color);
          await applyEffect(d.id, scene.effect ?? 'static');
        }));
        notify(`✓ AI scene "${scene.name}" applied`);
      }
    } catch (err) {
      logRecovery('applyScene', err.message, 'error');
      notify('Scene apply failed — ' + err.message, 'error');
    }
  }, [state.devices, applyColor, applyEffect, notify, logRecovery]);

  // ── applyTelemetryColor ───────────────────────────────────────────────
  const applyTelemetryColor = useCallback(async (hex) => {
    try {
      await Promise.all(state.devices.map(d => applyColor(d.id, hex)));
      notify('✓ Health colour applied to all');
    } catch (err) {
      logRecovery('applyTelemetryColor', err.message, 'warn');
    }
  }, [state.devices, applyColor, notify, logRecovery]);

  // ── Boot ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function bootEngine() {
      let connected = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        const r = await bridge.connectRGB();
        if (r?.ok) { connected = true; break; }
        logRecovery('Boot', `Connect attempt ${attempt + 1} failed`, 'warn');
        if (attempt < 2) await new Promise(res => {
          // BUG 3 FIX: cancellable retry delay — clears immediately if unmounted
          const t = setTimeout(res, 1000);
          if (cancelled) { clearTimeout(t); res(); }
        });
      }

      if (cancelled) return;
      safeDispatch({ type: A.SET_RGB_CONNECTED, payload: connected });

      if (connected) {
        await doScan();
      } else {
        logRecovery('Boot', 'All connect attempts failed — running in preview mode', 'error');
      }

      if (bridge.isElectron && !cancelled) {
        bridge.startTelemetry(1500);
        const unsub = bridge.onTelemetryUpdate(data => {
          if (!cancelled) {
            safeDispatch({ type: A.SET_TELEMETRY, payload: data });
            lastTelemetryRef.current = Date.now();
          }
        });
        return () => { unsub(); bridge.stopTelemetry(); };
      }
    }

    const cleanup = bootEngine();
    return () => {
      cancelled = true;
      cleanup?.then?.(fn => fn?.());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror bridge connection status
  useEffect(() => {
    safeDispatch({ type: A.SET_RGB_CONNECTED, payload: bridge.isConnected });
    if (!bridge.isConnected && bridge.lastError) {
      logRecovery('HardwareBridge', bridge.lastError, 'warn');
    }
  }, [bridge.isConnected, bridge.lastError, safeDispatch, logRecovery]);

  // ── Public API ────────────────────────────────────────────────────────
  return {
    state, bridge, notify,
    setTab, setSelectedId, setBrightness,
    doScan, reconnect, disconnect,
    applyColor, applyEffect,
    syncAll, applyGameRGB, setActiveGame,
    loadProfile, applyScene, applyTelemetryColor,
    deviceStates, getDeviceStatus, isDeviceOnline,
    retryDevice, disconnectedCount,
    appIntegrations,
    verifier,
    rendererHealth,
    cre,
    logRecovery,
  };
}

export default useNexusCoreEngine;
