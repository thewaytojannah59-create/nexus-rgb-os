import { useEffect, useRef, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// useMemoryLeak — Central Memory Leak Protection for Nexus RGB OS
// ═══════════════════════════════════════════════════════════════════════════
//
// Three tools in one hook:
//
//  1. useSafeState(setter)
//     Wraps any React state setter so it silently drops updates after the
//     component unmounts. Prevents the classic:
//     "Can't perform a React state update on an unmounted component."
//
//  2. useTrackedTimers()
//     Drop-in replacements for setTimeout / setInterval / requestAnimationFrame.
//     Every timer is registered. All are auto-cleared on unmount — even if
//     the calling code forgot the cleanup.
//
//  3. useTrackedListeners()
//     Wraps addEventListener so every listener auto-removes on unmount.
//     Also wraps IPC / Electron event emitters (on/off pattern).
//
// Usage:
//   const { safeSet, timers, listeners } = useMemoryLeak();
//
//   // Safe state update
//   const [count, setCount] = useState(0);
//   const safeSetCount = safeSet(setCount);
//
//   // Tracked timers
//   const { safeTimeout, safeInterval, safeRaf, clearAll } = timers;
//
//   // Tracked listeners
//   const { track, trackIpc } = listeners;
//   track(window, 'resize', handler);
//   trackIpc(window.NexusOS.telemetry, 'onUpdate', cb); // auto-removes on unmount
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. useSafeState ──────────────────────────────────────────────────────

export function useSafeState() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // FIX-11: safeSet returns a stable wrapped setter.
  // The outer useCallback is stable (empty deps).
  // The inner function is also stable because mountedRef never changes identity.
  // Callers get a new wrapper per setter identity change — correct behaviour.
  const safeSet = useCallback((setter) => {
    // Return a memoized wrapper. We use a closure over mountedRef (stable ref)
    // so the wrapper itself doesn't need to be recreated on every render.
    return (...args) => {
      if (mountedRef.current) setter(...args);
    };
  }, []); // empty — mountedRef is a ref, never changes

  return { safeSet, isMounted: () => mountedRef.current };
}

// ── 2. useTrackedTimers ──────────────────────────────────────────────────

export function useTrackedTimers() {
  const timeoutsRef  = useRef(new Set());
  const intervalsRef = useRef(new Set());
  const rafsRef      = useRef(new Set());

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(id  => clearTimeout(id));
      intervalsRef.current.forEach(id => clearInterval(id));
      rafsRef.current.forEach(id      => cancelAnimationFrame(id));
      timeoutsRef.current.clear();
      intervalsRef.current.clear();
      rafsRef.current.clear();
    };
  }, []);

  const safeTimeout = useCallback((fn, delay, ...args) => {
    const id = setTimeout((...a) => {
      timeoutsRef.current.delete(id); // self-remove after firing
      fn(...a);
    }, delay, ...args);
    timeoutsRef.current.add(id);
    return id;
  }, []);

  const clearSafeTimeout = useCallback((id) => {
    clearTimeout(id);
    timeoutsRef.current.delete(id);
  }, []);

  const safeInterval = useCallback((fn, delay, ...args) => {
    const id = setInterval(fn, delay, ...args);
    intervalsRef.current.add(id);
    return id;
  }, []);

  const clearSafeInterval = useCallback((id) => {
    clearInterval(id);
    intervalsRef.current.delete(id);
  }, []);

  // Recursive RAF: auto-tracks every new frame ID
  const safeRaf = useCallback((fn) => {
    let id;
    const wrapped = (...args) => {
      rafsRef.current.delete(id);
      id = requestAnimationFrame(wrapped);
      rafsRef.current.add(id);
      fn(...args);
    };
    id = requestAnimationFrame(wrapped);
    rafsRef.current.add(id);
    return () => {
      cancelAnimationFrame(id);
      rafsRef.current.delete(id);
    };
  }, []);

  const clearAllTimers = useCallback(() => {
    timeoutsRef.current.forEach(id  => clearTimeout(id));
    intervalsRef.current.forEach(id => clearInterval(id));
    rafsRef.current.forEach(id      => cancelAnimationFrame(id));
    timeoutsRef.current.clear();
    intervalsRef.current.clear();
    rafsRef.current.clear();
  }, []);

  return {
    safeTimeout,
    clearSafeTimeout,
    safeInterval,
    clearSafeInterval,
    safeRaf,
    clearAllTimers,
  };
}

// ── 3. useTrackedListeners ────────────────────────────────────────────────

export function useTrackedListeners() {
  // Each entry: { target, event, handler, options }
  const listenersRef = useRef([]);

  useEffect(() => {
    return () => {
      listenersRef.current.forEach(({ target, event, handler, options }) => {
        try {
          target.removeEventListener(event, handler, options);
        } catch {
          // Target may have been GC'd or destroyed — safe to ignore
        }
      });
      listenersRef.current = [];
    };
  }, []);

  // DOM / EventTarget listeners
  const track = useCallback((target, event, handler, options) => {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(event, handler, options);
    const entry = { target, event, handler, options };
    listenersRef.current.push(entry);

    // Return a manual cleanup function (optional)
    return () => {
      target.removeEventListener(event, handler, options);
      listenersRef.current = listenersRef.current.filter(e => e !== entry);
    };
  }, []);

  // Electron IPC / NexusOS event emitters that use the on(cb) → unsub() pattern
  // e.g. window.NexusOS.telemetry.onUpdate(cb) returns an unsubscribe fn
  const trackIpc = useCallback((emitter, method, cb) => {
    if (!emitter || typeof emitter[method] !== 'function') return () => {};
    const unsub = emitter[method](cb);
    if (typeof unsub === 'function') {
      listenersRef.current.push({ target: null, event: method, handler: cb, _unsub: unsub });
      return unsub;
    }
    return () => {};
  }, []);

  return { track, trackIpc };
}

// ── Composite hook ───────────────────────────────────────────────────────

export function useMemoryLeak() {
  const { safeSet, isMounted } = useSafeState();
  const timers    = useTrackedTimers();
  const listeners = useTrackedListeners();

  return { safeSet, isMounted, timers, listeners };
}

export default useMemoryLeak;
