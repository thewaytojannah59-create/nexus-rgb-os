// ============================================================
// Nexus RGB OS — OpenRGB Fallback Hook
// ============================================================
// Listens for the openrgb:unavailable IPC event and provides
// state + actions for the fallback banner in App.jsx.
//
// ERROR REASONS AND WHAT USER SEES:
//   no_internet   → "No internet connection — can't download driver"
//   server_timeout → "Hardware driver timed out — retry?"
//   permission    → "Permission denied — try running as admin"
//   ssl           → "Network security issue — check your firewall"
//   unknown       → "Something went wrong — retry or skip"
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { useMemoryLeak } from './useMemoryLeak';

const REASON_COPY = {
  no_internet: {
    title:   'No internet connection',
    detail:  'Nexus needs to download its RGB driver on first launch. Connect to the internet and retry.',
    icon:    '📡',
    canRetry: true,
  },
  server_timeout: {
    title:   'RGB driver timed out',
    detail:  'The hardware driver started but didn\'t respond in time. This usually fixes itself on retry.',
    icon:    '⏱',
    canRetry: true,
  },
  permission: {
    title:   'Permission denied',
    detail:  'The RGB driver needs elevated access. Try right-clicking Nexus and selecting "Run as administrator".',
    icon:    '🔒',
    canRetry: false,
  },
  ssl: {
    title:   'Firewall or antivirus blocked the download',
    detail:  'Your security software blocked the RGB driver download. Add Nexus to your antivirus whitelist and retry.',
    icon:    '🛡',
    canRetry: true,
  },
  unknown: {
    title:   'RGB driver unavailable',
    detail:  'Something went wrong starting the RGB driver. You can retry, or use the app without hardware control.',
    icon:    '⚠️',
    canRetry: true,
  },
};

export function useOpenRGBFallback(bridge) {
  const { safeSet, timers } = useMemoryLeak();

  const [unavailable,   _setUnavailable]   = useState(false);
  const [reason,        _setReason]        = useState(null);
  const [errorMsg,      _setErrorMsg]      = useState('');
  const [retrying,      _setRetrying]      = useState(false);
  const [retryStatus,   _setRetryStatus]   = useState('');
  const [dismissed,     _setDismissed]     = useState(false);
  const [recovered,     _setRecovered]     = useState(false);

  const setUnavailable = safeSet(_setUnavailable);
  const setReason      = safeSet(_setReason);
  const setErrorMsg    = safeSet(_setErrorMsg);
  const setRetrying    = safeSet(_setRetrying);
  const setRetryStatus = safeSet(_setRetryStatus);
  const setDismissed   = safeSet(_setDismissed);
  const setRecovered   = safeSet(_setRecovered);

  useEffect(() => {
    if (!bridge?.isElectron) return;

    const unsubUnavailable = bridge.rgb?.onUnavailable?.(({ error, reason }) => {
      setUnavailable(true);
      setReason(reason ?? 'unknown');
      setErrorMsg(error ?? '');
      setDismissed(false);
      setRecovered(false);
    });

    const unsubRecovered = bridge.rgb?.onRecovered?.(() => {
      setUnavailable(false);
      setRetrying(false);
      setRecovered(true);
      // L6 FIX: tracked timer — auto-cancels if component unmounts
      timers.safeTimeout(() => setRecovered(false), 3000);
    });

    const unsubStatus = bridge.rgb?.onBootStatus?.((msg) => {
      setRetryStatus(msg);
    });

    return () => {
      unsubUnavailable?.();
      unsubRecovered?.();
      unsubStatus?.();
    };
  }, [bridge, timers]);

  // ── Retry ────────────────────────────────────────────────────────────
  const retry = useCallback(async () => {
    if (!bridge?.isElectron) return;
    setRetrying(true);
    setRetryStatus('Retrying…');
    try {
      const result = await bridge.rgb?.retry?.();
      if (!result?.ok) {
        setRetryStatus('');
        setRetrying(false);
        setReason(result?.reason ?? 'unknown');
        setErrorMsg(result?.error ?? '');
      }
      // success path handled by onRecovered listener above
    } catch {
      setRetrying(false);
      setRetryStatus('');
    }
  }, [bridge]);

  const dismiss = useCallback(() => setDismissed(true), [setDismissed]);

  const copy = REASON_COPY[reason] ?? REASON_COPY.unknown;

  return {
    // Show the banner?
    show:        unavailable && !dismissed,
    // Show a brief "Connected!" flash?
    recovered,
    // Data
    reason,
    copy,
    errorMsg,
    // Actions
    retrying,
    retryStatus,
    retry,
    dismiss,
    canRetry:    copy.canRetry,
  };
}
