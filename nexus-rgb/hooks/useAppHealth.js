import { useState, useEffect, useCallback, useRef } from 'react';
import { useRendererHealth } from './useRendererHealth';
import { useMemoryLeak } from './useMemoryLeak';

// ═══════════════════════════════════════════════════════════════════════════
// APP HEALTH MANAGER
// ═══════════════════════════════════════════════════════════════════════════
//
// FIXES IN THIS VERSION:
//
//  FIX-9  BUG: useAppHealth was calling useHardwareBridge() internally,
//         creating a SECOND bridge instance separate from the engine's.
//         Two bridges = two connection states, two reconnect loops,
//         doubled IPC traffic. Fixed: bridge is now passed in as a prop.
//
//  FIX-3  LEAK: Three useEffects with no cleanup for setAppHealth calls
//         that fire after unmount. Fixed: all setters wrapped via safeSet.
// ═══════════════════════════════════════════════════════════════════════════

export function useAppHealth(bridge) {
  // FIX-9: bridge passed in — NOT created here. Single instance lives
  // in useNexusCoreEngine and is shared down to everything that needs it.

  if (!bridge) {
    throw new Error('[useAppHealth] bridge is required — pass the engine bridge in');
  }

  const { safeSet, timers }  = useMemoryLeak();

  const [appHealth, _setAppHealth] = useState({
    overall:  'healthy',
    hardware: 'healthy',
    rendering:'healthy',
    errorLog: [],
  });
  const setAppHealth = safeSet(_setAppHealth); // FIX-3

  // Stable callback refs — never cause useEffect re-runs
  const onFrozenRef    = useRef(null);
  const onRecoveredRef = useRef(null);

  onFrozenRef.current = useCallback(() => {
    setAppHealth(prev => ({ ...prev, rendering: 'critical' }));
    logError('RENDERING', 'UI frozen — frame rate collapsed', 'error');
  }, []);

  onRecoveredRef.current = useCallback(() => {
    setAppHealth(prev => ({ ...prev, rendering: 'healthy' }));
  }, []);

  const renderer = useRendererHealth({
    freezeThresholdMs: 200,
    checkIntervalMs:   500,
    onFrozen:    () => onFrozenRef.current?.(),
    onRecovered: () => onRecoveredRef.current?.(),
  });

  const logError = useCallback((type, message, severity = 'warn') => {
    setAppHealth(prev => ({
      ...prev,
      errorLog: [
        ...prev.errorLog,
        { type, message, severity, timestamp: new Date().toISOString() },
      ].slice(-20),
    }));
    console[severity === 'error' ? 'error' : 'warn'](`[AppHealth][${type}] ${message}`);
  }, [setAppHealth]);

  // FIX-3: hardware status — safeSet guards post-unmount updates
  useEffect(() => {
    if (bridge.reconnecting) {
      setAppHealth(prev => ({ ...prev, hardware: 'degraded' }));
    } else if (bridge.isConnected) {
      setAppHealth(prev => ({ ...prev, hardware: 'healthy' }));
    } else {
      setAppHealth(prev => ({ ...prev, hardware: 'critical' }));
      logError('HARDWARE', 'OpenRGB disconnected', 'error');
    }
    if (bridge.lastError) logError('HARDWARE', bridge.lastError, 'warn');
  }, [bridge.isConnected, bridge.reconnecting, bridge.lastError, logError, setAppHealth]);

  // Overall score
  useEffect(() => {
    const hw     = bridge.isConnected ? 1 : bridge.reconnecting ? 0.5 : 0;
    const render = renderer.health / 100;
    const score  = (hw + render) / 2;
    const overall = score < 0.3 ? 'critical' : score < 0.7 ? 'degraded' : 'healthy';
    setAppHealth(prev => ({ ...prev, overall }));
  }, [bridge.isConnected, bridge.reconnecting, renderer.health, setAppHealth]);

  return { health: appHealth, renderer, logError };
}
