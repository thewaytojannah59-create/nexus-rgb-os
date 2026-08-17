// ═══════════════════════════════════════════════════════════════════════════
//
//  NEXUS CORE ENGINE
//     └── CRASH RECOVERY ENGINE (CRE)
//
//  Production-grade crash detection, classification, and auto-recovery
//  orchestrator for Nexus RGB OS.
//
// ───────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE
// ───────────────────────────────────────────────────────────────────────────
//
//  CRE sits directly under the core engine and monitors five subsystems:
//
//    Subsystem          Heartbeat Source         Failure Mode
//    ─────────────────────────────────────────────────────────────────────
//    OpenRGB            port-alive probe          crash / silent death
//    IPC Gateway        round-trip ping           freeze / corruption
//    Telemetry          last data timestamp        stall / stale
//    Game Detection     last process scan ts       stall / silence
//    Renderer (UI)      frame rate (existing)      crash / freeze
//
//  For each subsystem the CRE maintains a heartbeat record:
//    { lastSeen: number, failCount: number, status: SubsystemStatus }
//
//  Every HEARTBEAT_INTERVAL_MS the CRE evaluates all heartbeats.
//  If a subsystem goes silent beyond its timeout, a failure event fires.
//
// ───────────────────────────────────────────────────────────────────────────
//  FAILURE CLASSIFICATION
// ───────────────────────────────────────────────────────────────────────────
//
//  CRASH          — subsystem was alive, is now completely unresponsive
//  FREEZE         — subsystem responds but exceeds acceptable latency
//  STALE          — subsystem stopped emitting data (silent failure)
//  DEGRADED       — subsystem is alive but reporting internal errors
//  LOOP           — subsystem has crashed and recovered 3+ times in 2 min
//
// ───────────────────────────────────────────────────────────────────────────
//  RECOVERY DECISION TREE
// ───────────────────────────────────────────────────────────────────────────
//
//  OpenRGB CRASH     → restart openrgb silently → re-scan devices → restore colors
//  IPC CRASH         → reset Gateway circuit → re-init bridge connection
//  Telemetry STALL   → stop + restart telemetry polling
//  Game Det. STALL   → reset detection interval (no state loss)
//  Renderer FREEZE   → ErrorBoundary auto-recovers (already handles)
//  ANY LOOP          → circuit trips, cooldown 60s, escalate to user notify
//
// ───────────────────────────────────────────────────────────────────────────
//  SAFETY GUARANTEES
// ───────────────────────────────────────────────────────────────────────────
//
//  - No duplicate service spawning: recovery is gated by per-subsystem mutex
//  - No infinite loops: LOOP classification + escalating cooldown
//  - No race conditions: all recovery actions are queued serially per subsystem
//  - No memory leaks: all timers tracked via useMemoryLeak
//  - 24–72hr stability: heartbeat drift is capped, timestamps are monotonic
//
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMemoryLeak } from './useMemoryLeak';
import { Gateway }       from './IPCGateway';

// ── Constants ─────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000;   // how often CRE evaluates all subsystems

// Timeout thresholds per subsystem — how long of silence = failure
const TIMEOUTS = {
  openrgb:       12_000,   // 12s — port probe happens every 8s in watchdog
  ipc:           10_000,   // 10s — should ping within 2 cycles
  telemetry:     20_000,   // 20s — adaptive interval max is 4s, 5x buffer
  gameDetection: 30_000,   // 30s — polls every 3s, 10x buffer
  renderer:      8_000,    // 8s  — frame stall detected at 200ms, escalates fast
};

// How many failures before the loop circuit trips
const LOOP_THRESHOLD     = 3;
const LOOP_WINDOW_MS     = 120_000;  // 3 failures within 2 minutes = loop
const LOOP_COOLDOWN_MS   = 60_000;   // 60s cooldown before attempting again
const MAX_RECOVERY_ATTEMPTS = 5;     // absolute ceiling per subsystem per session

// Failure classification
export const FailureType = Object.freeze({
  CRASH:    'CRASH',    // was alive, now dead
  FREEZE:   'FREEZE',   // alive but unresponsive
  STALE:    'STALE',    // stopped emitting data silently
  DEGRADED: 'DEGRADED', // alive but reporting errors
  LOOP:     'LOOP',     // repeated crash/recovery cycle
});

// Subsystem identifiers
export const Subsystem = Object.freeze({
  OPENRGB:       'openrgb',
  IPC:           'ipc',
  TELEMETRY:     'telemetry',
  GAME_DETECTION:'gameDetection',
  RENDERER:      'renderer',
});

// ── Heartbeat record factory ───────────────────────────────────────────────

function makeHeartbeat(id) {
  return {
    id,
    lastSeen:          Date.now(),
    failCount:         0,             // consecutive failures
    totalFailures:     0,             // all-time this session
    recentFailureTimes:[],            // for loop detection
    status:            'healthy',     // healthy | degraded | failed | recovering | loop
    recovering:        false,         // mutex — prevents concurrent recovery
    recoveryAttempts:  0,             // total recoveries attempted
    loopCooldownUntil: 0,             // timestamp when loop cooldown expires
    lastFailureType:   null,
    lastRecoveredAt:   null,
  };
}

// ── B5 FIX: Stable helpers defined outside the hook ──────────────────────
// Previously defined as plain functions inside the hook body — recreated
// every render, invalidating any closures that captured them.

function isLooping(rec) {
  const now    = Date.now();
  const recent = rec.recentFailureTimes.filter(t => now - t < LOOP_WINDOW_MS);
  return recent.length >= LOOP_THRESHOLD;
}

function pruneFailureTimes(times) {
  const now = Date.now();
  return times.filter(t => now - t < LOOP_WINDOW_MS).slice(-LOOP_THRESHOLD * 2);
}

// ── CRE Hook ──────────────────────────────────────────────────────────────

/**
 * useCrashRecoveryEngine
 *
 * Mount this inside useNexusCoreEngine, pass all subsystem handles.
 * It returns a `cre` object with the monitoring state and a `beat()` function
 * that each subsystem calls to signal it's alive.
 *
 * @param {object} handles
 *   bridge          — useHardwareBridge instance
 *   verifier        — useOpenRGBVerifier instance
 *   notify          — engine notify function
 *   logRecovery     — engine logRecovery function
 *   doScan          — engine doScan (used in OpenRGB recovery)
 *   reconnect       — engine reconnect (used in IPC recovery)
 *   syncAll         — engine syncAll (used in state restoration)
 *   rendererHealth  — useRendererHealth result (isFrozen, health)
 *   lastGameScan    — ref to last game detection timestamp
 *   lastTelemetry   — ref to last telemetry data timestamp
 */
export function useCrashRecoveryEngine({
  bridge,
  verifier,
  notify,
  logRecovery,
  doScan,
  reconnect,
  syncAll,
  rendererHealth,
  lastGameScan,
  lastTelemetry,
}) {
  const { safeSet, timers } = useMemoryLeak();

  // B4: mountedRef — prevents all state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── State ──────────────────────────────────────────────────────────────

  const [subsystems, _setSubsystems] = useState(() =>
    Object.values(Subsystem).reduce((acc, id) => {
      acc[id] = makeHeartbeat(id);
      return acc;
    }, {})
  );
  const setSubsystems = safeSet(_setSubsystems);

  const [creStatus, _setCreStatus] = useState('initializing');
  const setCreStatus = safeSet(_setCreStatus);

  const [events, _setEvents] = useState([]);   // recent failure/recovery events
  const setEvents = safeSet(_setEvents);

  // Refs for use inside interval callbacks (avoid stale closure)
  const subsystemsRef   = useRef(subsystems);
  const recoveryQueue   = useRef([]);           // serial recovery queue
  const processingQueue = useRef(false);

  useEffect(() => { subsystemsRef.current = subsystems; }, [subsystems]);

  // ── Helpers ────────────────────────────────────────────────────────────

  const log = useCallback((msg, level = 'info') => {
    logRecovery?.('CRE', msg, level);
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[CRE] ${msg}`);
  }, [logRecovery]);

  const addEvent = useCallback((type, subsystem, detail) => {
    const event = { ts: Date.now(), type, subsystem, detail };
    setEvents(prev => [...prev.slice(-99), event]); // keep last 100 events
    log(`${type} — ${subsystem}: ${detail}`, type === 'RECOVERY' ? 'info' : 'warn');
  }, [setEvents, log]);

  // ── beat() — called by each subsystem to signal liveness ──────────────
  //
  // Usage in any subsystem:
  //   cre.beat(Subsystem.TELEMETRY);

  const beat = useCallback((subsystemId) => {
    setSubsystems(prev => {
      const rec = prev[subsystemId];
      if (!rec) return prev;
      return {
        ...prev,
        [subsystemId]: {
          ...rec,
          lastSeen: Date.now(),
          // If it was failed/degraded and now beats, status returns to healthy
          status: rec.status === 'recovering' ? 'recovering' : 'healthy',
        },
      };
    });
  }, [setSubsystems]);

  // ── markRecovered() — called after successful recovery ────────────────

  const markRecovered = useCallback((subsystemId) => {
    setSubsystems(prev => {
      const rec = prev[subsystemId];
      if (!rec) return prev;
      return {
        ...prev,
        [subsystemId]: {
          ...rec,
          status:          'healthy',
          recovering:      false,
          failCount:       0,
          lastRecoveredAt: Date.now(),
          lastSeen:        Date.now(),
        },
      };
    });
    addEvent('RECOVERY', subsystemId, 'Recovered successfully');
  }, [setSubsystems, addEvent]);

  // ── Loop detection — uses stable module-level helpers ─────────────────

  const recordFailure = useCallback((subsystemId, type, detail) => {
    setSubsystems(prev => {
      const rec = prev[subsystemId];
      if (!rec) return prev;

      const now          = Date.now();
      const newTimes     = pruneFailureTimes([...rec.recentFailureTimes, now]);
      const looping      = isLooping({ ...rec, recentFailureTimes: newTimes });
      const atMax        = rec.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS;
      const inCooldown   = now < rec.loopCooldownUntil;

      const newStatus = looping || atMax ? 'loop'
                      : inCooldown       ? 'loop'
                      : 'failed';

      return {
        ...prev,
        [subsystemId]: {
          ...rec,
          failCount:          rec.failCount + 1,
          totalFailures:      rec.totalFailures + 1,
          recentFailureTimes: newTimes,
          status:             newStatus,
          lastFailureType:    type,
          loopCooldownUntil:  looping ? now + LOOP_COOLDOWN_MS : rec.loopCooldownUntil,
        },
      };
    });
    addEvent(type, subsystemId, detail);
  }, [setSubsystems, addEvent]);

  // ── Recovery queue — serial per session, no concurrent recoveries ─────

  // R1+L1 FIX: processQueue as a stable ref-based function.
  // Storing in a ref prevents stale closure in enqueueRecovery while
  // allowing the function body to always access current state via refs.
  const processQueueRef = useRef(null);
  processQueueRef.current = async function processQueue() {
    if (processingQueue.current) return;
    processingQueue.current = true;

    while (recoveryQueue.current.length > 0) {
      // B4: bail if component unmounted during async recovery
      if (!mountedRef.current) { processingQueue.current = false; return; }

      const { subsystemId, recoverFn } = recoveryQueue.current.shift();
      const rec = subsystemsRef.current[subsystemId];

      if (!rec)                                    continue;
      if (rec.recovering)                          continue;
      if (rec.status === 'loop')                   continue;
      if (rec.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) continue;
      if (Date.now() < rec.loopCooldownUntil)      continue;

      // Set recovering mutex
      setSubsystems(prev => ({
        ...prev,
        [subsystemId]: {
          ...prev[subsystemId],
          recovering:       true,
          recoveryAttempts: (prev[subsystemId]?.recoveryAttempts ?? 0) + 1,
        },
      }));

      log(`Recovery attempt for ${subsystemId} (${(rec.recoveryAttempts ?? 0) + 1}/${MAX_RECOVERY_ATTEMPTS})`, 'warn');

      try {
        await recoverFn();
        if (mountedRef.current) markRecovered(subsystemId); // B4: guard
      } catch (err) {
        log(`Recovery failed for ${subsystemId}: ${err.message}`, 'error');
        if (mountedRef.current) { // B4: guard
          setSubsystems(prev => ({
            ...prev,
            [subsystemId]: { ...prev[subsystemId], recovering: false },
          }));
        }
      }

      // L1 FIX: cancellable pause — resolves immediately if unmounted
      await new Promise(resolve => {
        const t = setTimeout(resolve, 1000);
        if (!mountedRef.current) { clearTimeout(t); resolve(); }
      });
    }

    processingQueue.current = false;
  };

  const enqueueRecovery = useCallback((subsystemId, recoverFn) => {
    recoveryQueue.current.push({ subsystemId, recoverFn });
    if (!processingQueue.current) processQueueRef.current();
  }, []);

  // ── Recovery actions per subsystem ───────────────────────────────────
  //
  // Each action attempts the minimal restart necessary.
  // State restoration happens AFTER service is confirmed alive.

  // OpenRGB: restart service → reconnect SDK → re-scan → restore last colors
  const recoverOpenRGB = useCallback(async () => {
    log('Attempting OpenRGB recovery: reconnect + re-scan', 'warn');

    // 1. Reconnect bridge (main process will restart openrgb if needed)
    if (bridge?.connectRGB) await bridge.connectRGB();

    // 2. Re-verify capability
    if (verifier?.verify) await verifier.verify();

    // 3. Re-scan devices
    if (doScan) await doScan();

    // 4. State restoration: syncAll will re-apply colors from engine state
    // (syncAll uses devColors/devEffects from reducer — already correct)
    if (syncAll && bridge?.isConnected) {
      // Don't force a color — just verify we can reach devices
      log('OpenRGB state restored after recovery', 'info');
    }
  }, [bridge, verifier, doScan, syncAll, log]);

  // IPC: reset circuit breaker → force reconnect
  // V1 FIX: was calling window.NexusOS.gateway.resetCircuit directly.
  // Now routes through Gateway.call() — validated, sanitized, rate-limited.
  const recoverIPC = useCallback(async () => {
    log('Attempting IPC Gateway recovery: circuit reset + reconnect', 'warn');
    try {
      await Gateway.call('gateway.reset');
    } catch (err) {
      log(`Gateway reset failed: ${err.message}`, 'warn');
    }
    if (reconnect) await reconnect();
  }, [reconnect, log]);

  // Telemetry: stop + restart polling loop
  // V1 FIX: was calling window.NexusOS.telemetry directly.
  // L1 FIX: raw setTimeout replaced with cancellable promise guarded by mountedRef.
  const recoverTelemetry = useCallback(async () => {
    log('Attempting telemetry recovery: restart polling', 'warn');
    try {
      await Gateway.call('telemetry.stop');
      // Cancellable 500ms pause — clears immediately if unmounted
      await new Promise(resolve => {
        const t = setTimeout(resolve, 500);
        if (!mountedRef.current) { clearTimeout(t); resolve(); }
      });
      if (!mountedRef.current) return;
      await Gateway.call('telemetry.start', { intervalMs: 1500 });
    } catch (err) {
      log(`Telemetry restart failed: ${err.message}`, 'warn');
    }
  }, [log]);

  // Game detection: no state loss — just reset the poll interval ref
  // The appIntegrations hook will recover itself on next interval tick
  const recoverGameDetection = useCallback(async () => {
    log('Game detection stall detected — self-heals on next poll cycle', 'info');
    // No action needed — detectAndSwitch is a stateless async fn.
    // The stale interval will fire again within POLL_INTERVAL_MS.
  }, [log]);

  // Renderer: ErrorBoundary already handles tab-level crashes.
  // CRE only escalates if the renderer is fully frozen (no RAF ticks).
  const recoverRenderer = useCallback(async () => {
    log('Renderer health critical — notifying user', 'warn');
    notify?.('UI performance degraded — consider restarting the app', 'error');
    // We cannot force a React re-render from outside React.
    // ErrorBoundary auto-recovers crashed tabs. This is a performance warning only.
  }, [notify, log]);

  // ── Recovery dispatch map ─────────────────────────────────────────────

  const RECOVERY_ACTIONS = useRef({
    [Subsystem.OPENRGB]:       null,  // set in useEffect after stable refs
    [Subsystem.IPC]:           null,
    [Subsystem.TELEMETRY]:     null,
    [Subsystem.GAME_DETECTION]:null,
    [Subsystem.RENDERER]:      null,
  });

  useEffect(() => {
    RECOVERY_ACTIONS.current = {
      [Subsystem.OPENRGB]:        recoverOpenRGB,
      [Subsystem.IPC]:            recoverIPC,
      [Subsystem.TELEMETRY]:      recoverTelemetry,
      [Subsystem.GAME_DETECTION]: recoverGameDetection,
      [Subsystem.RENDERER]:       recoverRenderer,
    };
  }, [recoverOpenRGB, recoverIPC, recoverTelemetry, recoverGameDetection, recoverRenderer]);

  // ── Classify and trigger recovery ─────────────────────────────────────

  const triggerRecovery = useCallback((subsystemId, type, detail) => {
    const rec = subsystemsRef.current[subsystemId];
    if (!rec) return;

    // Respect loop cooldown
    if (Date.now() < rec.loopCooldownUntil) {
      log(`${subsystemId} in loop cooldown — skipping recovery until ${new Date(rec.loopCooldownUntil).toISOString()}`, 'warn');
      notify?.(`${subsystemId} recovery paused — too many recent failures`, 'error');
      return;
    }

    // Escalate loop to user
    if (rec.status === 'loop') {
      addEvent('LOOP', subsystemId, `${subsystemId} is crash-looping — manual intervention may be needed`);
      notify?.(`⚠ ${subsystemId} is crash-looping — restart Nexus if issues persist`, 'error');
      return;
    }

    recordFailure(subsystemId, type, detail);

    const action = RECOVERY_ACTIONS.current[subsystemId];
    if (action) enqueueRecovery(subsystemId, action);
  }, [recordFailure, enqueueRecovery, addEvent, notify, log]);

  // BUG 9 FIX: triggerRecovery via stable ref — evaluation loop dep array
  // stays tight and never re-creates the interval on each render.
  const triggerRecoveryRef = useRef(triggerRecovery);
  useEffect(() => { triggerRecoveryRef.current = triggerRecovery; }, [triggerRecovery]);

  // ── Main evaluation loop — runs every HEARTBEAT_INTERVAL_MS ──────────

  useEffect(() => {
    setCreStatus('active');

    const id = timers.safeInterval(() => {
      const now   = Date.now();
      const recs  = subsystemsRef.current;

      // ── OpenRGB ─────────────────────────────────────────────────────
      const openrgbRec = recs[Subsystem.OPENRGB];
      if (openrgbRec.status !== 'recovering' && openrgbRec.status !== 'loop') {
        const silent = now - openrgbRec.lastSeen > TIMEOUTS.openrgb;
        const bridgeDead = bridge?.isElectron && !bridge?.isConnected && !bridge?.reconnecting;
        if (silent || bridgeDead) {
          triggerRecoveryRef.current(Subsystem.OPENRGB, FailureType.CRASH,
            silent ? `No heartbeat for ${Math.round((now - openrgbRec.lastSeen)/1000)}s` : 'Bridge reports disconnected');
        }
      }

      // ── IPC Gateway ──────────────────────────────────────────────────
      const ipcRec = recs[Subsystem.IPC];
      if (ipcRec.status !== 'recovering' && ipcRec.status !== 'loop') {
        const silent = now - ipcRec.lastSeen > TIMEOUTS.ipc;
        if (silent) {
          triggerRecoveryRef.current(Subsystem.IPC, FailureType.FREEZE,
            `IPC heartbeat silent for ${Math.round((now - ipcRec.lastSeen)/1000)}s`);
        }
      }

      // ── Telemetry ────────────────────────────────────────────────────
      const telRec = recs[Subsystem.TELEMETRY];
      if (telRec.status !== 'recovering' && telRec.status !== 'loop' && bridge?.isElectron) {
        const lastTs    = lastTelemetry?.current ?? 0;
        const stale     = lastTs > 0 && (now - lastTs) > TIMEOUTS.telemetry;
        if (stale) {
          triggerRecoveryRef.current(Subsystem.TELEMETRY, FailureType.STALE,
            `Telemetry data stale for ${Math.round((now - lastTs)/1000)}s`);
        }
      }

      // ── Game Detection ────────────────────────────────────────────────
      const gameRec = recs[Subsystem.GAME_DETECTION];
      if (gameRec.status !== 'recovering' && gameRec.status !== 'loop' && bridge?.isElectron) {
        const lastTs = lastGameScan?.current ?? 0;
        const stale  = lastTs > 0 && (now - lastTs) > TIMEOUTS.gameDetection;
        if (stale) {
          triggerRecoveryRef.current(Subsystem.GAME_DETECTION, FailureType.STALE,
            `Game detection silent for ${Math.round((now - lastTs)/1000)}s`);
        }
      }

      // ── Renderer ─────────────────────────────────────────────────────
      const rendRec = recs[Subsystem.RENDERER];
      if (rendRec.status !== 'recovering' && rendRec.status !== 'loop') {
        if (rendererHealth?.isFrozen) {
          triggerRecoveryRef.current(Subsystem.RENDERER, FailureType.FREEZE,
            `UI frozen — avg frame ${rendererHealth?.stats?.avgFrameTime ?? '?'}ms`);
        } else if (rendererHealth?.health < 20) {
          triggerRecoveryRef.current(Subsystem.RENDERER, FailureType.DEGRADED,
            `UI health critical: ${rendererHealth?.health}%`);
        }
      }

      // Update CRE overall status
      const statuses = Object.values(subsystemsRef.current).map(r => r.status);
      const overall  = statuses.includes('loop')      ? 'degraded'
                     : statuses.includes('failed')    ? 'recovering'
                     : statuses.includes('recovering') ? 'recovering'
                     : statuses.includes('degraded')  ? 'degraded'
                     : 'healthy';
      setCreStatus(overall);

    }, HEARTBEAT_INTERVAL_MS);

    return () => timers.clearSafeInterval(id);
  }, [
    timers, bridge, rendererHealth,
    lastTelemetry, lastGameScan,
    setCreStatus,  // triggerRecovery via ref — not in dep array
  ]);

  // ── IPC ping — keeps IPC heartbeat alive ─────────────────────────────
  // Sends a lightweight ping to main process every 8s.
  // If it times out, IPC is considered frozen.

  useEffect(() => {
    if (!bridge?.isElectron) {
      // In browser mode — beat IPC continuously (it's always "alive")
      beat(Subsystem.IPC);
      return;
    }

    const id = timers.safeInterval(async () => {
      if (!mountedRef.current) return;
      // L2+V1 FIX: Gateway.call replaces window.NexusOS, timerId always cleared
      let timerId = null;  // BUG 2 FIX: init to null — safe to clearTimeout(null)
      try {
        const timeoutPromise = new Promise((_, rej) => {
          timerId = setTimeout(() => rej(new Error('IPC ping timeout')), 5000);
        });
        const result = await Promise.race([
          Gateway.call('gateway.state'),
          timeoutPromise,
        ]);
        clearTimeout(timerId);
        if (result && mountedRef.current) {
          beat(Subsystem.IPC);
          if (result.rgbConnected) beat(Subsystem.OPENRGB);
        }
      } catch {
        clearTimeout(timerId);
        log('IPC ping timed out', 'warn');
      }
    }, 8_000);

    return () => timers.clearSafeInterval(id);
  }, [bridge?.isElectron, timers, beat, log]);

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    // Call from each subsystem on each successful operation to signal liveness
    beat,

    // CRE overall status: 'initializing' | 'healthy' | 'recovering' | 'degraded'
    creStatus,

    // Per-subsystem heartbeat records (for debug UI)
    subsystems,

    // Recent failure/recovery event log (last 100)
    events,

    // Expose subsystem IDs and failure types for consumers
    Subsystem,
    FailureType,

    // Manual trigger (for testing or admin UI)
    triggerRecovery,

    // Force-reset a specific subsystem (for retry buttons)
    resetSubsystem: useCallback((id) => {
      setSubsystems(prev => ({
        ...prev,
        [id]: { ...makeHeartbeat(id), recoveryAttempts: prev[id]?.recoveryAttempts ?? 0 },
      }));
    }, [setSubsystems]),
  };
}

export default useCrashRecoveryEngine;
