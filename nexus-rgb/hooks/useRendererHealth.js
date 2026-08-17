import { useEffect, useRef, useCallback, useState } from 'react';
import { useMemoryLeak } from './useMemoryLeak';

// ═══════════════════════════════════════════════════════════════════════════
// RENDERER HEALTH MONITOR — Detects UI Freezes
// ═══════════════════════════════════════════════════════════════════════════
//
// FIXES IN THIS VERSION:
//
//  FIX-1  PERF: frameHistory was an array using shift() — O(n) every frame.
//         Replaced with a fixed-size circular buffer — O(1) always.
//
//  FIX-2  PERF: Math.max(...frameHistory) spread on 60 elements every frame
//         could stack-overflow on large histories. Now tracked incrementally.
//
//  FIX-3  BUG: isFrozen threshold was 2000ms avg frame time — that's 0.5fps.
//         A frozen UI is anything above 200ms (5fps). Fixed.
//
//  FIX-4  LEAK: useCrashRecovery used raw setTimeout/clearTimeout instead of
//         useMemoryLeak tracked timers. Timer leaked on fast unmount. Fixed.
//
//  FIX-5  BUG: useEffect had onFrozen/onRecovered callbacks in dep array.
//         If callers passed inline functions, effect re-ran every render.
//         Fixed with stable useRef pattern.
// ═══════════════════════════════════════════════════════════════════════════

// ── FIX-1 + FIX-2: Circular buffer — O(1) push, O(1) max tracking ────────

class CircularFrameBuffer {
  constructor(size = 60) {
    this._buf    = new Float64Array(size); // pre-allocated, no GC pressure
    this._size   = size;
    this._head   = 0;
    this._count  = 0;
    this._sum    = 0;
    this._max    = 0;      // FIX-2: tracked incrementally, no spread needed
  }

  push(value) {
    // Remove oldest value from sum
    const oldest = this._buf[this._head];
    this._sum -= oldest;

    // Write new value
    this._buf[this._head] = value;
    this._sum += value;
    this._head = (this._head + 1) % this._size;
    if (this._count < this._size) this._count++;

    // FIX-2: recompute max only when needed (when old max was evicted)
    // For most frames this is just a comparison — O(1)
    if (value >= this._max) {
      this._max = value;
    } else if (oldest === this._max) {
      // Old max was just evicted — need a full scan (rare)
      this._max = 0;
      for (let i = 0; i < this._count; i++) {
        const v = this._buf[(this._head - 1 - i + this._size) % this._size];
        if (v > this._max) this._max = v;
      }
    }
  }

  get avg()   { return this._count === 0 ? 0 : this._sum / this._count; }
  get max()   { return this._max; }
  get count() { return this._count; }
  reset()     { this._buf.fill(0); this._head = 0; this._count = 0; this._sum = 0; this._max = 0; }
}

// ── Performance monitor ───────────────────────────────────────────────────

class PerformanceMonitor {
  constructor() {
    this._buf          = new CircularFrameBuffer(60);
    this._lastTime     = performance.now();
    this._totalFrames  = 0;
  }

  recordFrame() {
    const now       = performance.now();
    const frameTime = now - this._lastTime;
    this._lastTime  = now;
    this._totalFrames++;
    this._buf.push(frameTime);
    return { frameTime, avg: this._buf.avg, max: this._buf.max };
  }

  // FIX-3: 200ms = ~5fps. Anything below that is a real freeze.
  isFrozen(thresholdMs = 200) {
    return this._buf.count >= 5 && this._buf.avg > thresholdMs;
  }

  // Health: 100 = 60fps (16.67ms), 0 = frozen
  getHealth() {
    const TARGET = 16.67;
    return Math.max(0, Math.min(100, Math.round(100 - (this._buf.avg / TARGET - 1) * 20)));
  }

  get stats() {
    return {
      avgFrameTime:  this._buf.avg.toFixed(2),
      maxFrameTime:  this._buf.max.toFixed(2),
      totalFrames:   this._totalFrames,
    };
  }

  reset() { this._buf.reset(); }
}

// ── useRendererHealth ─────────────────────────────────────────────────────

export function useRendererHealth({
  onFrozen          = null,
  onRecovered       = null,
  freezeThresholdMs = 200,   // FIX-3
  checkIntervalMs   = 500,
} = {}) {
  const { timers }    = useMemoryLeak();
  const monitorRef    = useRef(new PerformanceMonitor());
  const [health,     setHealth]   = useState(100);
  const [isFrozen,   setIsFrozen] = useState(false);
  const wasFrozenRef = useRef(false);

  // FIX-5: stable refs for callbacks — never in dep array
  const onFrozenRef    = useRef(onFrozen);
  const onRecoveredRef = useRef(onRecovered);
  useEffect(() => { onFrozenRef.current    = onFrozen;    }, [onFrozen]);
  useEffect(() => { onRecoveredRef.current = onRecovered; }, [onRecovered]);

  const recordFrame = useCallback(() => {
    monitorRef.current.recordFrame();
  }, []);

  useEffect(() => {
    // RAF loop — uses safeRaf so it auto-cancels on unmount
    const stopRaf = timers.safeRaf(recordFrame);

    // Health check timer
    const id = timers.safeInterval(() => {
      const monitor     = monitorRef.current;
      const frozen      = monitor.isFrozen(freezeThresholdMs);
      const healthScore = monitor.getHealth();

      setHealth(healthScore);
      setIsFrozen(frozen);

      if (frozen && !wasFrozenRef.current) {
        console.warn(`[RendererHealth] FROZEN — avg ${monitor.stats.avgFrameTime}ms`);
        onFrozenRef.current?.();
        wasFrozenRef.current = true;
      } else if (!frozen && wasFrozenRef.current) {
        console.log(`[RendererHealth] RECOVERED — avg ${monitor.stats.avgFrameTime}ms`);
        onRecoveredRef.current?.();
        wasFrozenRef.current = false;
      }
    }, checkIntervalMs);

    return () => {
      stopRaf();
      timers.clearSafeInterval(id);
    };
  // FIX-5: freezeThresholdMs/checkIntervalMs are primitives — safe in deps
  }, [recordFrame, freezeThresholdMs, checkIntervalMs, timers]);

  return {
    health,
    isFrozen,
    stats: monitorRef.current.stats,
  };
}

// ── useCrashRecovery ──────────────────────────────────────────────────────
// FIX-4: uses useMemoryLeak tracked timers — no leak on fast unmount

export function useCrashRecovery({
  maxAttempts    = 3,
  resetTimeoutMs = 5000,
  onCrash        = null,
  onRecovered    = null,
} = {}) {
  const { timers }        = useMemoryLeak();
  const [crashed,   setCrashed]  = useState(false);
  const [attempts,  setAttempts] = useState(0);
  const attemptsRef = useRef(0);

  const markCrashed = useCallback(() => {
    attemptsRef.current += 1;
    setCrashed(true);
    setAttempts(attemptsRef.current);
    onCrash?.();
    console.warn(`[CrashRecovery] Crash #${attemptsRef.current}/${maxAttempts}`);

    if (attemptsRef.current < maxAttempts) {
      timers.safeTimeout(() => {
        setCrashed(false);
        onRecovered?.();
        console.log('[CrashRecovery] Auto-recovered');
      }, resetTimeoutMs);
    } else {
      console.error('[CrashRecovery] Max attempts reached');
    }
  }, [maxAttempts, onCrash, onRecovered, resetTimeoutMs, timers]);

  const reset = useCallback(() => {
    setCrashed(false);
    setAttempts(0);
    attemptsRef.current = 0;
  }, []);

  return {
    crashed,
    attempts,
    maxAttempts,
    canRecover: attemptsRef.current < maxAttempts,
    markCrashed,
    reset,
  };
}
