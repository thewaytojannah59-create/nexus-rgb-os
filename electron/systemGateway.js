// ============================================================
// Nexus RGB OS — System Gateway
// ============================================================
// The single controlled entry point for ALL hardware and
// system operations. Nothing touches OpenRGB or the file
// system directly from IPC handlers — everything goes
// through here first.
//
// WHAT THIS ADDS:
//
//  GATE-1  CIRCUIT BREAKER — after 3 consecutive failures on
//          any channel, that channel trips open and rejects
//          calls for a cooldown period. Auto-resets after 15s.
//          Prevents hammering a broken dependency.
//
//  GATE-2  OPERATION QUEUE — each hardware channel has a
//          serial queue. Concurrent calls wait their turn
//          instead of racing. Prevents corrupt state from
//          simultaneous LED updates.
//
//  GATE-3  DEDUPLICATION — identical in-flight operations
//          return the same promise. Calling scan() 5 times
//          simultaneously runs it once and resolves all 5.
//
//  GATE-4  HEALTH WATCHDOG — background timer checks that
//          OpenRGB is still alive every 8 seconds. If it
//          drops, the circuit trips and the UI is notified.
//
//  GATE-5  OPERATION TIMEOUT — every hardware call has a
//          hard 10s timeout. A hung OpenRGB can't freeze
//          the whole app.
//
//  GATE-6  SINGLE SYSTEM STATE — one authoritative object
//          tracks connection status, circuit state, failure
//          counts, and last error. The UI reads from here,
//          never guesses.
// ============================================================

const net = require('net');

// ── Circuit breaker states ────────────────────────────────────────────────

const CB = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

const CIRCUIT_FAILURE_THRESHOLD = 3;    // trips after this many consecutive fails
const CIRCUIT_COOLDOWN_MS       = 15_000; // stays open for this long
const OPERATION_TIMEOUT_MS      = 10_000; // hard timeout per hardware call

// ── System state — single source of truth ────────────────────────────────

const systemState = {
  rgbConnected:    false,
  openrgbAlive:    false,
  circuit:         CB.CLOSED,
  failCount:       0,
  lastError:       null,
  lastSuccessAt:   null,
  circuitOpenAt:   null,
  watchdogActive:  false,
  operationsTotal: 0,
  operationsFailed:0,
};

let _stateChangeCallback = null;

function notifyStateChange() {
  _stateChangeCallback?.(getSystemState());
}

function getSystemState() {
  return {
    ...systemState,
    uptimeMs: systemState.lastSuccessAt
      ? Date.now() - systemState.lastSuccessAt
      : null,
  };
}

// ── Circuit breaker ───────────────────────────────────────────────────────

function recordSuccess() {
  systemState.failCount        = 0;
  systemState.lastError        = null;
  systemState.lastSuccessAt    = Date.now();
  systemState.operationsTotal++;

  if (systemState.circuit !== CB.CLOSED) {
    systemState.circuit = CB.CLOSED;
    console.log('[Gateway] Circuit closed — operations resumed');
    notifyStateChange();
  }
}

function recordFailure(err) {
  systemState.failCount++;
  systemState.lastError     = err?.message ?? String(err);
  systemState.operationsFailed++;
  systemState.operationsTotal++;

  if (systemState.failCount >= CIRCUIT_FAILURE_THRESHOLD
      && systemState.circuit === CB.CLOSED) {
    systemState.circuit       = CB.OPEN;
    systemState.circuitOpenAt = Date.now();
    console.warn(`[Gateway] Circuit TRIPPED — cooling down ${CIRCUIT_COOLDOWN_MS / 1000}s`);
    notifyStateChange();

    // B2 FIX: clear previous cooldown timer before setting a new one
    // Prevents timer accumulation if recordFailure fires repeatedly while OPEN
    if (systemState._resetTimer) clearTimeout(systemState._resetTimer);
    systemState._resetTimer = setTimeout(() => {
      systemState._resetTimer = null;
      if (systemState.circuit === CB.OPEN) {
        systemState.circuit = CB.HALF_OPEN;
        console.log('[Gateway] Circuit HALF_OPEN — next call is a probe');
        notifyStateChange();
      }
    }, CIRCUIT_COOLDOWN_MS);
  }
}

function isCircuitOpen() {
  return systemState.circuit === CB.OPEN;
}

// ── B3 FIX: Operation queue — Map instead of plain object ─────────────────
// Plain object keys are prototype-pollutable (V2).
// Map has no prototype chain on its keys, so any channel string is safe.
// Map also doesn't retain resolved promises indefinitely — we prune the tail
// after each operation completes to prevent unbounded memory growth.

const queues   = new Map(); // V2+B3: Map prevents prototype pollution + bounded
const inflight = new Map(); // V2+B3: same

function getQueue(channel) {
  // V2 FIX: Map.get/set has no prototype chain — channel string can't shadow
  //         Object.prototype methods like 'toString', 'constructor', etc.
  if (!queues.has(channel)) queues.set(channel, Promise.resolve());
  return queues.get(channel);
}

// ── GATE-3: Deduplication ─────────────────────────────────────────────────

function withDedup(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ── GATE-5: Timeout wrapper ───────────────────────────────────────────────

function withTimeout(promise, ms = OPERATION_TIMEOUT_MS, label = 'operation') {
  // BUG 1 FIX: timerId always cleared — no leaked timer on early resolve
  return new Promise((resolve, reject) => {
    const timerId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)), ms
    );
    promise.then(
      (v) => { clearTimeout(timerId); resolve(v); },
      (e) => { clearTimeout(timerId); reject(e); }
    );
  });
}

// ── Core: execute through the gateway ────────────────────────────────────
//
// Usage:
//   const result = await gateway.execute('rgb', 'setColor', () => client.updateLeds(...));
//
// channel  — logical grouping for the queue ('rgb', 'system', 'store')
// label    — human name for logs + dedup key
// fn       — async function that does the actual work

function execute(channel, label, fn) {
  // GATE-1: Circuit breaker check
  if (isCircuitOpen()) {
    const waited = Date.now() - (systemState.circuitOpenAt ?? 0);
    return Promise.resolve({
      ok:    false,
      error: `RGB system is cooling down after repeated failures (${Math.ceil((CIRCUIT_COOLDOWN_MS - waited) / 1000)}s remaining)`,
      circuitOpen: true,
    });
  }

  // GATE-3: Dedup for identical concurrent calls
  const dedupKey = `${channel}:${label}`;

  // GATE-2: Queue — chain onto this channel's promise tail
  const queued = getQueue(channel).then(() =>
    withDedup(dedupKey, () =>
      withTimeout(
        Promise.resolve().then(fn),
        OPERATION_TIMEOUT_MS,
        label
      )
      .then(result => {
        recordSuccess();
        return result;
      })
      .catch(err => {
        recordFailure(err);
        return { ok: false, error: err.message };
      })
    )
  );

  // Update queue tail (errors don't break the chain)
  // B3+V2 FIX: use Map.set — prevents prototype pollution and bounds growth
  queues.set(channel, queued.catch(() => {}));
  return queued;
}

// ── GATE-4: Health watchdog ───────────────────────────────────────────────

let watchdogTimer = null;

function startWatchdog(host, port, onDead, onRevived) {
  if (watchdogTimer) return;
  systemState.watchdogActive = true;

  watchdogTimer = setInterval(async () => {
    const alive = await isPortOpen(host, port);

    if (!alive && systemState.openrgbAlive) {
      // Just died
      systemState.openrgbAlive = false;
      systemState.rgbConnected = false;
      recordFailure(new Error('OpenRGB watchdog: server went offline'));
      console.warn('[Gateway] Watchdog: OpenRGB went offline');
      onDead?.();
      notifyStateChange();
    } else if (alive && !systemState.openrgbAlive) {
      // Just came back
      systemState.openrgbAlive = true;
      recordSuccess();
      console.log('[Gateway] Watchdog: OpenRGB came back online');
      onRevived?.();
      notifyStateChange();
    }
  }, 8_000);

  console.log('[Gateway] Watchdog started — checking every 8s');
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  systemState.watchdogActive = false;
}

// ── Port check helper ─────────────────────────────────────────────────────

function isPortOpen(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => { sock.destroy(); resolve(true);  });
    sock.once('error',   () => { sock.destroy(); resolve(false); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

// ── Mark connected/disconnected ───────────────────────────────────────────

function markConnected() {
  systemState.rgbConnected  = true;
  systemState.openrgbAlive  = true;
  recordSuccess();
  notifyStateChange();
}

function markDisconnected() {
  systemState.rgbConnected  = false;
  notifyStateChange();
}

// ── Reset circuit manually (for retry button) ─────────────────────────────

function resetCircuit() {
  systemState.circuit       = CB.CLOSED;
  systemState.failCount     = 0;
  systemState.circuitOpenAt = null;
  systemState.lastError     = null;
  notifyStateChange();
  console.log('[Gateway] Circuit manually reset');
}

// ── Public API ────────────────────────────────────────────────────────────

module.exports = {
  execute,
  startWatchdog,
  stopWatchdog,
  markConnected,
  markDisconnected,
  resetCircuit,
  getSystemState,
  isCircuitOpen,
  onStateChange: (cb) => { _stateChangeCallback = cb; },
  CB,
};
