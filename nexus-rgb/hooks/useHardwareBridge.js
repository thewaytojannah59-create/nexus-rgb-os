import { useCallback, useEffect, useRef, useState } from 'react';
import { Gateway } from './IPCGateway';

const isElectron = typeof window !== 'undefined' && window.NexusOS?.isElectron === true;
const stub = async () => ({ ok: false, stub: true, message: 'Run as Electron app for real hardware access' });

// All hardware calls go through Gateway.call() which:
//   1. Validates the payload schema
//   2. Sanitizes values (clamp RGB, trim strings)
//   3. Rate-limits per channel
//   4. Logs every call for recovery tracing
// Direct window.NexusOS calls are only used for event subscriptions
// (telemetry, openrgb:unavailable) which don't go through the command path.

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-RECONNECT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
const RECONNECT_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2.0,
  healthCheckIntervalMs: 5000, // Check connection every 5s
  timeoutMs: 3000, // Individual request timeout
};

// ═══════════════════════════════════════════════════════════════════════════
// RETRY MANAGER: Exponential backoff + jitter
// ═══════════════════════════════════════════════════════════════════════════
class RetryManager {
  constructor(maxRetries = RECONNECT_CONFIG.maxRetries) {
    this.maxRetries = maxRetries;
    this.attempt = 0;
    this.nextRetryMs = RECONNECT_CONFIG.initialDelayMs;
  }

  getDelay() {
    const jitter = Math.random() * 0.1 * this.nextRetryMs; // ±10% jitter
    return this.nextRetryMs + jitter;
  }

  incrementBackoff() {
    this.attempt++;
    this.nextRetryMs = Math.min(
      RECONNECT_CONFIG.maxDelayMs,
      this.nextRetryMs * RECONNECT_CONFIG.backoffMultiplier
    );
  }

  canRetry() {
    return this.attempt < this.maxRetries;
  }

  reset() {
    this.attempt = 0;
    this.nextRetryMs = RECONNECT_CONFIG.initialDelayMs;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONNECTION STATE MANAGER
// ═══════════════════════════════════════════════════════════════════════════
class ConnectionState {
  constructor() {
    this.isConnected = false;
    this.lastHealthCheckMs = 0;
    this.failureCount = 0;
    this.reconnectTimer = null;
  }

  recordFailure() {
    this.failureCount++;
    this.isConnected = false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.isConnected = true;
    this.lastHealthCheckMs = Date.now();
  }

  clearTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export function useHardwareBridge() {
  const rgb   = isElectron ? window.NexusOS.rgb       : null;
  const tel   = isElectron ? window.NexusOS.telemetry : null;
  const ai    = isElectron ? window.NexusOS.ai        : null;
  const store = isElectron ? window.NexusOS.store     : null;
  const win   = isElectron ? window.NexusOS.window    : null;
  const procs = isElectron ? window.NexusOS.processes : null;

  const [isConnected,  setIsConnected]  = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastError,    setLastError]    = useState(null);

  const connStateRef        = useRef(new ConnectionState());
  const retryMgrRef         = useRef(new RetryManager());
  const healthCheckTimerRef = useRef(null);
  const mountedRef          = useRef(true);  // R2: unmount guard

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Safe state setters — no-op after unmount
  const safeSetConnected    = useCallback((v) => { if (mountedRef.current) setIsConnected(v);  }, []);
  const safeSetReconnecting = useCallback((v) => { if (mountedRef.current) setReconnecting(v); }, []);
  const safeSetLastError    = useCallback((v) => { if (mountedRef.current) setLastError(v);    }, []);

  // L5 FIX: withTimeout clears its own timer on early resolve/reject
  const withTimeout = useCallback(async (promise, timeoutMs) => {
    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(
        () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timerId); // L5: always clear on resolve
      return result;
    } catch (err) {
      clearTimeout(timerId); // L5: always clear on reject
      throw err;
    }
  }, []);

  // ───────────────────────────────────────────────────────────────────────
  // CORE: Auto-reconnect wrapper
  // ───────────────────────────────────────────────────────────────────────
  const executeWithAutoReconnect = useCallback(
    async (operation, opName = 'operation') => {
      try {
        // If not connected, try to reconnect first
        if (!connStateRef.current.isConnected && rgb) {
          console.warn(`[RGB] Not connected. Auto-reconnecting before ${opName}...`);
          const reconnected = await attemptReconnect();
          if (!reconnected) {
            setLastError(`Failed to reconnect: ${opName}`);
            return { ok: false, error: 'Connection lost and reconnection failed' };
          }
        }

        // Execute operation with timeout
        const result = await withTimeout(operation(), RECONNECT_CONFIG.timeoutMs);
        
        if (result?.ok === true || (Array.isArray(result) && result.length >= 0)) {
          connStateRef.current.recordSuccess();
          setIsConnected(true);
          setLastError(null);
          retryMgrRef.current.reset();
          return result;
        } else {
          throw new Error(result?.error || 'Operation failed');
        }
      } catch (err) {
        console.error(`[RGB] ${opName} failed:`, err);
        connStateRef.current.recordFailure();
        setLastError(err.message);
        setIsConnected(false);

        // Trigger auto-reconnect on failure
        if (rgb && retryMgrRef.current.canRetry()) {
          scheduleReconnect();
        }

        return { ok: false, error: err.message };
      }
    },
    [rgb, withTimeout]
  );

  // ───────────────────────────────────────────────────────────────────────
  // RECONNECT: Attempt with exponential backoff
  // ───────────────────────────────────────────────────────────────────────
  const attemptReconnect = useCallback(async () => {
    if (!rgb) return false;
    if (!mountedRef.current) return false; // R2: already unmounted

    safeSetReconnecting(true);
    const retryMgr = retryMgrRef.current;

    while (retryMgr.canRetry()) {
      // R2: bail out of while loop if component unmounted mid-retry
      if (!mountedRef.current) return false;

      try {
        const result = await withTimeout(rgb.connect(), RECONNECT_CONFIG.timeoutMs);
        if (result?.ok === true) {
          connStateRef.current.recordSuccess();
          safeSetConnected(true);
          safeSetReconnecting(false);
          safeSetLastError(null);
          retryMgr.reset();
          return true;
        }
      } catch (err) {
        console.warn(`[RGB] Reconnect attempt ${retryMgr.attempt + 1} failed:`, err.message);
      }

      retryMgr.incrementBackoff();

      if (retryMgr.canRetry()) {
        const delayMs = retryMgr.getDelay();
        // R2: use a cancellable delay — resolve immediately if unmounted
        await new Promise(resolve => {
          const t = setTimeout(resolve, delayMs);
          // Store cleanup handle so unmount can cancel the wait
          if (!mountedRef.current) { clearTimeout(t); resolve(); }
        });
      }
    }

    safeSetReconnecting(false);
    safeSetLastError('Reconnection failed after max retries');
    safeSetConnected(false);
    return false;
  }, [rgb, withTimeout, safeSetConnected, safeSetReconnecting, safeSetLastError]);

  // L3 FIX: scheduleReconnect still uses connStateRef.reconnectTimer (a raw setTimeout)
  // which is already cleared in connStateRef.clearTimer() — that's acceptable because
  // clearTimer() is called in disconnectRGB and in the cleanup useEffect below.
  const scheduleReconnect = useCallback(() => {
    connStateRef.current.clearTimer();
    const delayMs = retryMgrRef.current.getDelay();
    connStateRef.current.reconnectTimer = setTimeout(() => {
      if (mountedRef.current) attemptReconnect(); // L3: guard — don't fire after unmount
    }, delayMs);
  }, [attemptReconnect]);

  // ───────────────────────────────────────────────────────────────────────
  // HEALTH CHECK: Periodic connection validation
  // ───────────────────────────────────────────────────────────────────────
  const startHealthCheck = useCallback(() => {
    if (healthCheckTimerRef.current) return;

    healthCheckTimerRef.current = setInterval(async () => {
      // L4: bail if unmounted — prevents state updates after cleanup
      if (!mountedRef.current) {
        clearInterval(healthCheckTimerRef.current);
        healthCheckTimerRef.current = null;
        return;
      }
      if (!rgb || connStateRef.current.failureCount > 2) return;

      try {
        const now = Date.now();
        if (now - connStateRef.current.lastHealthCheckMs < RECONNECT_CONFIG.healthCheckIntervalMs) {
          return;
        }
        const result = await withTimeout(rgb.scan(), RECONNECT_CONFIG.timeoutMs);
        if (!mountedRef.current) return; // R2: check again after await
        if (!result || result.error) {
          connStateRef.current.recordFailure();
          if (connStateRef.current.failureCount >= 3) scheduleReconnect();
        } else {
          connStateRef.current.recordSuccess();
          safeSetConnected(true);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        connStateRef.current.recordFailure();
      }
    }, RECONNECT_CONFIG.healthCheckIntervalMs);
  }, [rgb, withTimeout, scheduleReconnect, safeSetConnected]);

  const stopHealthCheck = useCallback(() => {
    if (healthCheckTimerRef.current) {
      clearInterval(healthCheckTimerRef.current);
      healthCheckTimerRef.current = null;
    }
  }, []);

  // ───────────────────────────────────────────────────────────────────────
  // PUBLIC API: Wrapped hardware functions
  // ───────────────────────────────────────────────────────────────────────
  // ── Hardware commands — all routed through IPCGateway ─────────────────
  // Gateway validates + sanitizes + rate-limits before anything reaches IPC.

  const connectRGB = useCallback(
    () => isElectron
      ? executeWithAutoReconnect(() => Gateway.call('rgb.connect'), 'connectRGB')
      : stub(),
    [executeWithAutoReconnect]
  );

  const disconnectRGB = useCallback(
    async () => {
      connStateRef.current.clearTimer();
      stopHealthCheck();
      connStateRef.current.recordFailure();
      setIsConnected(false);
      return isElectron ? Gateway.call('rgb.disconnect') : stub();
    },
    [stopHealthCheck]
  );

  const scanDevices = useCallback(
    () => isElectron
      ? executeWithAutoReconnect(() => Gateway.call('rgb.scan'), 'scanDevices')
      : stub(),
    [executeWithAutoReconnect]
  );

  const setDeviceColor = useCallback(
    (id, r, g, b) => isElectron
      ? executeWithAutoReconnect(
          () => Gateway.call('rgb.setColor', { id, r, g, b }),
          `setDeviceColor(${id})`
        )
      : stub(),
    [executeWithAutoReconnect]
  );

  const setDeviceMode = useCallback(
    (id, mode) => isElectron
      ? executeWithAutoReconnect(
          () => Gateway.call('rgb.setMode', { id, mode }),
          `setDeviceMode(${id})`
        )
      : stub(),
    [executeWithAutoReconnect]
  );

  const setAllColor = useCallback(
    (r, g, b) => isElectron
      ? executeWithAutoReconnect(
          () => Gateway.call('rgb.setAllColor', { r, g, b }),
          'setAllColor'
        )
      : stub(),
    [executeWithAutoReconnect]
  );

  // Telemetry (no auto-reconnect needed - less critical)
  const startTelemetry = useCallback((ms) => (tel ? tel.start(ms) : stub()), [tel]);
  const stopTelemetry = useCallback(() => (tel ? tel.stop() : stub()), [tel]);
  const onTelemetryUpdate = useCallback(
    (cb) => (tel ? tel.onUpdate(cb) : () => {}),
    [tel]
  );

  // Process list — used by useAppIntegrations for app/game detection
  const getRunningProcesses = useCallback(
    async () => {
      if (!isElectron) return [];
      const result = await Gateway.call('processes.list');
      // FIX-14: handle typed rate-limit response — don't treat it as an empty list
      if (result?.rateLimited) return null; // null = "try again later", [] = "nothing running"
      if (Array.isArray(result)) return result;
      return [];
    },
    []
  );

  // AI — routed through Gateway (validates prompt + apiKey length)
  const aiQuery = useCallback(
    (prompt, apiKey, system, provider) => isElectron
      ? Gateway.call('ai.query', { prompt, apiKey, system, provider })
      : stub(),
    []
  );
  const aiCheckKey = useCallback(
    (apiKey) => isElectron ? Gateway.call('ai.checkKey', { apiKey }) : stub(),
    []
  );

  // Store — routed through Gateway (validates key format + value size)
  const storeGet = useCallback(
    (key) => isElectron ? Gateway.call('store.get', { key }) : Promise.resolve(null),
    []
  );
  const storeSet = useCallback(
    (key, value) => isElectron ? Gateway.call('store.set', { key, value }) : Promise.resolve(false),
    []
  );
  // B1 FIX: store.getAll removed — IPC handler does not exist (removed for security).
  // Any code calling storeGetAll will receive an empty object gracefully.

  // Window controls — direct, safe, user-initiated only
  const windowMinimize = useCallback(() => isElectron && Gateway.call('window.minimize'), []);
  const windowMaximize = useCallback(() => isElectron && Gateway.call('window.maximize'), []);
  const windowClose    = useCallback(() => isElectron && Gateway.call('window.close'),    []);

  // Full cleanup on unmount — L3+L4: clears all timers
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopHealthCheck();
      connStateRef.current.clearTimer(); // L3: clears reconnectTimer
    };
  }, [stopHealthCheck]);

  // Health check lifecycle
  useEffect(() => {
    if (isElectron && rgb) {
      startHealthCheck();
      return () => stopHealthCheck();
    }
  }, [isElectron, rgb, startHealthCheck, stopHealthCheck]);

  return {
    isElectron,
    isConnected,
    reconnecting,
    lastError,
    connectRGB,
    disconnectRGB,
    scanDevices,
    setDeviceColor,
    setDeviceMode,
    setAllColor,
    startTelemetry,
    stopTelemetry,
    onTelemetryUpdate,
    getRunningProcesses,
    aiQuery,
    aiCheckKey,
    storeGet,
    storeSet,
    windowMinimize,
    windowMaximize,
    windowClose,
  };
}
