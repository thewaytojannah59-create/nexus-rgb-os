import { useCallback, useEffect, useRef, useState } from 'react';
import { useMemoryLeak } from './useMemoryLeak';

// ═══════════════════════════════════════════════════════════════════════════
// useDeviceDisconnect — Per-Device Disconnect Handling for Nexus RGB OS
// ═══════════════════════════════════════════════════════════════════════════
//
// The existing useHardwareBridge handles OpenRGB *connection* drops (the
// whole server going down). This hook handles a different problem:
// individual devices disappearing mid-session — USB power cycles, driver
// resets, hot-unplugging a keyboard or mouse — while OpenRGB itself stays
// alive.
//
// What it does:
//
//  1. DEVICE STATE TRACKING
//     Maintains a per-device status map: 'connected' | 'disconnected' |
//     'reconnecting' | 'error'. Survives re-renders. New devices discovered
//     during a Re-scan are merged without clobbering existing state.
//
//  2. DISCONNECT DETECTION
//     After every scan result, compares the live list against last known
//     devices. Any device that vanishes is immediately marked disconnected
//     and its settings (color, effect, brightness) are frozen in a snapshot
//     so they can be restored when the device comes back.
//
//  3. PER-DEVICE AUTO-RECOVERY
//     Each disconnected device gets its own exponential-backoff retry loop
//     (independent of other devices). Recovery means: run a scan, check if
//     the device reappears, push its saved settings back if it does.
//     Max 8 retries, 1s → 60s window. After that, device is marked 'error'
//     and the user sees a manual re-scan button.
//
//  4. SETTINGS PRESERVATION
//     When a device reconnects, its last known color, effect, and brightness
//     are automatically reapplied — no manual reconfiguration needed.
//
//  5. SELECTED DEVICE GUARD
//     If the currently selected device disconnects, the selection is cleared
//     so the editor panel doesn't show stale data.
//
// Usage:
//   const {
//     deviceStates,       // Map<deviceId, DeviceStatus>
//     markScanResult,     // Call after every bridge.scanDevices()
//     getDeviceStatus,    // (id) => DeviceStatus
//     isDeviceOnline,     // (id) => boolean
//     retryDevice,        // (id) => void — manual retry
//     disconnectedCount,  // number — how many are currently down
//   } = useDeviceDisconnect({ bridge, devices, devColors, devEffects, devBrightness,
//                              onApplyColor, onApplyEffect, onDevicesUpdate,
//                              onSelectionClear, notify });
// ═══════════════════════════════════════════════════════════════════════════

// ── Per-device status shape ───────────────────────────────────────────────

// DeviceStatus = {
//   id:           string,
//   name:         string,
//   status:       'connected' | 'disconnected' | 'reconnecting' | 'error',
//   disconnectedAt: number | null,   // timestamp
//   reconnectedAt:  number | null,
//   retryAttempt:   number,
//   lastError:      string | null,
//   snapshot: {                      // frozen settings at time of disconnect
//     color:      string,
//     effect:     string,
//     brightness: number,
//   } | null,
// }

const DEVICE_RECONNECT_CONFIG = {
  maxRetries:          8,
  initialDelayMs:      1000,
  maxDelayMs:          60_000,
  backoffMultiplier:   2.0,
  jitterFactor:        0.15,   // ±15%
  scanTimeoutMs:       4000,
};

function calcDelay(attempt) {
  const base  = Math.min(
    DEVICE_RECONNECT_CONFIG.initialDelayMs *
      Math.pow(DEVICE_RECONNECT_CONFIG.backoffMultiplier, attempt),
    DEVICE_RECONNECT_CONFIG.maxDelayMs
  );
  const jitter = (Math.random() * 2 - 1) * DEVICE_RECONNECT_CONFIG.jitterFactor * base;
  return Math.round(base + jitter);
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useDeviceDisconnect({
  bridge,
  devices,
  devColors      = {},
  devEffects     = {},
  devBrightness  = {},
  onApplyColor   = null,
  onApplyEffect  = null,
  onDevicesUpdate= null,   // (newDeviceList) => void — called when we get a fresh scan
  onSelectionClear = null, // () => void — called when selected device disconnects
  selectedDeviceId = null,
  notify         = null,
}) {

  // Map<deviceId, DeviceStatus>
  const { safeSet } = useMemoryLeak();
  const [deviceStates, _setDeviceStates] = useState(() => new Map());
  const setDeviceStates = safeSet(_setDeviceStates); // FIX #8 — safe after unmount

  // Tracks which devices currently have an active retry loop running
  // (stored in a ref so the loop can check without stale closure)
  const activeRetryLoopsRef = useRef(new Set());

  // Timers keyed by deviceId so we can cancel them
  const retryTimersRef = useRef(new Map());

  // ── Helpers ────────────────────────────────────────────────────────────

  const updateDeviceState = useCallback((id, patch) => {
    setDeviceStates(prev => {
      const next = new Map(prev);
      const existing = next.get(id) || { id, retryAttempt: 0, lastError: null, snapshot: null, disconnectedAt: null, reconnectedAt: null };
      next.set(id, { ...existing, ...patch });
      return next;
    });
  }, []);

  const snapshotDevice = useCallback((id, name) => ({
    color:      devColors[id]      || '#ff6b35',
    effect:     devEffects[id]     || 'static',
    brightness: devBrightness[id]  || 80,
    name,
  }), [devColors, devEffects, devBrightness]);

  // Cancel a pending retry timer for a device
  const cancelRetryTimer = useCallback((id) => {
    const timer = retryTimersRef.current.get(id);
    if (timer != null) {
      clearTimeout(timer);
      retryTimersRef.current.delete(id);
    }
  }, []);

  // ── Recovery logic ─────────────────────────────────────────────────────

  const restoreDeviceSettings = useCallback(async (device, snapshot) => {
    if (!snapshot || !onApplyColor) return;
    try {
      await onApplyColor(device.id, snapshot.color);
      if (onApplyEffect) await onApplyEffect(device.id, snapshot.effect);
      console.log(`[DeviceDisconnect] Settings restored for "${device.name}": ${snapshot.color} / ${snapshot.effect}`);
    } catch (err) {
      console.warn(`[DeviceDisconnect] Failed to restore settings for "${device.name}":`, err.message);
    }
  }, [onApplyColor, onApplyEffect]);

  // Runs a single scan and checks if the target device is back
  const probeForDevice = useCallback(async (targetId) => {
    try {
      const result = await bridge.scanDevices();
      if (Array.isArray(result)) {
        return result.find(d => d.id === targetId) || null;
      }
    } catch (err) {
      console.warn(`[DeviceDisconnect] Probe scan failed:`, err.message);
    }
    return null;
  }, [bridge]);

  // Per-device retry loop — runs independently for each disconnected device
  const startRetryLoop = useCallback(async (deviceId, deviceName, attempt = 0) => {
    // Prevent duplicate loops
    if (activeRetryLoopsRef.current.has(deviceId)) return;
    activeRetryLoopsRef.current.add(deviceId);

    console.log(`[DeviceDisconnect] Starting retry loop for "${deviceName}" (attempt ${attempt + 1}/${DEVICE_RECONNECT_CONFIG.maxRetries})`);

    const run = async (currentAttempt) => {
      if (!activeRetryLoopsRef.current.has(deviceId)) return; // Cancelled

      if (currentAttempt >= DEVICE_RECONNECT_CONFIG.maxRetries) {
        // Give up
        activeRetryLoopsRef.current.delete(deviceId);
        updateDeviceState(deviceId, {
          status: 'error',
          lastError: `Device not found after ${DEVICE_RECONNECT_CONFIG.maxRetries} retries`,
        });
        notify?.(`⚠ "${deviceName}" not reconnecting — try Re-scan or check USB cable`, 'error');
        console.error(`[DeviceDisconnect] Giving up on "${deviceName}" after ${DEVICE_RECONNECT_CONFIG.maxRetries} retries`);
        return;
      }

      updateDeviceState(deviceId, {
        status: 'reconnecting',
        retryAttempt: currentAttempt,
      });

      const found = await probeForDevice(deviceId);

      if (found) {
        // Device is back!
        activeRetryLoopsRef.current.delete(deviceId);
        retryTimersRef.current.delete(deviceId);

        const snapshot = deviceStates.get(deviceId)?.snapshot;

        updateDeviceState(deviceId, {
          status: 'connected',
          reconnectedAt: Date.now(),
          retryAttempt: 0,
          lastError: null,
        });

        // Update the device list in App
        if (onDevicesUpdate) {
          const result = await bridge.scanDevices();
          if (Array.isArray(result)) onDevicesUpdate(result);
        }

        // Restore saved settings
        await restoreDeviceSettings(found, snapshot);

        notify?.(`✓ "${deviceName}" reconnected — settings restored`);
        console.log(`[DeviceDisconnect] "${deviceName}" back online after ${currentAttempt + 1} attempt(s)`);
        return;
      }

      // Not found — schedule next retry
      if (!activeRetryLoopsRef.current.has(deviceId)) return;

      const delay = calcDelay(currentAttempt);
      console.log(`[DeviceDisconnect] "${deviceName}" still missing. Retry ${currentAttempt + 2}/${DEVICE_RECONNECT_CONFIG.maxRetries} in ${Math.round(delay / 1000)}s`);

      const timer = setTimeout(() => {
        retryTimersRef.current.delete(deviceId);
        run(currentAttempt + 1);
      }, delay);

      retryTimersRef.current.set(deviceId, timer);
    };

    await run(attempt);
  }, [probeForDevice, updateDeviceState, restoreDeviceSettings, deviceStates, bridge, onDevicesUpdate, notify]);

  // ── Public: process a scan result ──────────────────────────────────────

  // Call this every time bridge.scanDevices() returns a result.
  // It diffs the new list against last known devices and fires disconnect
  // / reconnect logic as needed.
  const markScanResult = useCallback((newDeviceList) => {
    if (!Array.isArray(newDeviceList)) return;

    const newIds = new Set(newDeviceList.map(d => d.id));

    setDeviceStates(prev => {
      const next = new Map(prev);

      // --- Mark newly connected devices ---
      newDeviceList.forEach(device => {
        const existing = next.get(device.id);
        if (!existing || existing.status === 'disconnected' || existing.status === 'reconnecting' || existing.status === 'error') {
          // Device appeared (or reappeared)
          if (existing?.status === 'disconnected' || existing?.status === 'reconnecting' || existing?.status === 'error') {
            // Was disconnected — now back (scan-driven recovery, not retry loop)
            console.log(`[DeviceDisconnect] "${device.name}" reappeared via scan`);
            activeRetryLoopsRef.current.delete(device.id);
            cancelRetryTimer(device.id);

            const snapshot = existing?.snapshot;
            // Restore asynchronously (can't await inside setState)
            if (snapshot && onApplyColor) {
              Promise.resolve()
                .then(() => onApplyColor(device.id, snapshot.color))
                .then(() => onApplyEffect?.(device.id, snapshot.effect))
                .catch(() => {});
            }
          }
          next.set(device.id, {
            ...(existing || {}),
            id: device.id,
            name: device.name,
            status: 'connected',
            reconnectedAt: existing?.status === 'disconnected' ? Date.now() : existing?.reconnectedAt ?? null,
            disconnectedAt: existing?.disconnectedAt ?? null,
            retryAttempt: 0,
            lastError: null,
            snapshot: existing?.snapshot ?? null,
          });
        } else {
          // Already connected — just refresh name in case it changed
          next.set(device.id, { ...existing, name: device.name, status: 'connected' });
        }
      });

      // --- Mark devices that vanished ---
      prev.forEach((state, id) => {
        if (!newIds.has(id) && state.status === 'connected') {
          console.warn(`[DeviceDisconnect] "${state.name}" disappeared`);

          // Build snapshot from current settings (captured in render closure — best effort)
          const snapshot = {
            color:      devColors[id]     || state.snapshot?.color      || '#ff6b35',
            effect:     devEffects[id]    || state.snapshot?.effect     || 'static',
            brightness: devBrightness[id] || state.snapshot?.brightness || 80,
            name: state.name,
          };

          next.set(id, {
            ...state,
            status: 'disconnected',
            disconnectedAt: Date.now(),
            retryAttempt: 0,
            lastError: null,
            snapshot,
          });
        }
      });

      return next;
    });
  }, [cancelRetryTimer, devColors, devEffects, devBrightness, onApplyColor, onApplyEffect]);

  // ── React to state changes: fire retry loops for newly disconnected ─────

  useEffect(() => {
    deviceStates.forEach((state, id) => {
      if (state.status === 'disconnected' && !activeRetryLoopsRef.current.has(id)) {
        notify?.(`⚠ "${state.name}" disconnected — attempting auto-recovery`);
        startRetryLoop(id, state.name, 0);
      }

      // Clear selection if the selected device just disconnected
      if (id === selectedDeviceId && (state.status === 'disconnected' || state.status === 'error')) {
        onSelectionClear?.();
      }
    });
  }, [deviceStates, selectedDeviceId, onSelectionClear, notify, startRetryLoop]);

  // ── Initialize state for freshly scanned devices ───────────────────────

  useEffect(() => {
    if (!devices.length) return;
    setDeviceStates(prev => {
      const next = new Map(prev);
      devices.forEach(device => {
        if (!next.has(device.id)) {
          next.set(device.id, {
            id: device.id,
            name: device.name,
            status: 'connected',
            disconnectedAt: null,
            reconnectedAt: null,
            retryAttempt: 0,
            lastError: null,
            snapshot: null,
          });
        }
      });
      return next;
    });
  }, [devices]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      activeRetryLoopsRef.current.clear();
      retryTimersRef.current.forEach(clearTimeout);
      retryTimersRef.current.clear();
    };
  }, []);

  // ── Public API ─────────────────────────────────────────────────────────

  const getDeviceStatus = useCallback((id) => {
    return deviceStates.get(id) ?? null;
  }, [deviceStates]);

  const isDeviceOnline = useCallback((id) => {
    const state = deviceStates.get(id);
    return !state || state.status === 'connected';
  }, [deviceStates]);

  // Manual retry — resets the retry counter and fires a new loop
  const retryDevice = useCallback((id) => {
    const state = deviceStates.get(id);
    if (!state) return;

    // Cancel any existing loop/timer for this device
    activeRetryLoopsRef.current.delete(id);
    cancelRetryTimer(id);

    // Reset state to 'disconnected' so the useEffect above fires the loop
    updateDeviceState(id, {
      status: 'disconnected',
      retryAttempt: 0,
      lastError: null,
    });

    notify?.(`↺ Manually retrying "${state.name}"...`);
  }, [deviceStates, cancelRetryTimer, updateDeviceState, notify]);

  const disconnectedCount = Array.from(deviceStates.values())
    .filter(s => s.status === 'disconnected' || s.status === 'reconnecting' || s.status === 'error')
    .length;

  return {
    deviceStates,
    markScanResult,
    getDeviceStatus,
    isDeviceOnline,
    retryDevice,
    disconnectedCount,
  };
}

export default useDeviceDisconnect;
