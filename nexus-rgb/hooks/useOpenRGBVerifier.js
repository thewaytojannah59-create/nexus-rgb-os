// ═══════════════════════════════════════════════════════════════════════════
// OpenRGB Dependency Verifier — Nexus RGB OS
// ═══════════════════════════════════════════════════════════════════════════
//
// Treats OpenRGB as critical infrastructure:
//
//   1. VERSION LOCK     — refuses to connect if OpenRGB version is below
//                         OPENRGB_MIN_VERSION or above OPENRGB_MAX_VERSION
//   2. CAPABILITY CHECK — verifies SDK API methods exist before use
//   3. HEALTH PROBE     — lightweight scan with timeout, not a full reconnect
//   4. FALLBACK STATE   — structured object describing what the app can/cannot
//                         do when OpenRGB is absent, so UI shows the truth
//   5. RECOVERY HINTS   — actionable error messages per failure mode
//
// Usage:
//   const verifier = useOpenRGBVerifier(bridge);
//   verifier.status   // 'unknown' | 'ok' | 'version_mismatch' | 'unavailable' | 'degraded'
//   verifier.verify() // run on demand (boot, reconnect button)
//   verifier.fallback // { canControl, canScan, canProfile, reason }
//
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMemoryLeak } from './useMemoryLeak';

// ── Version policy ────────────────────────────────────────────────────────

export const OPENRGB_MIN_VERSION = { major: 0, minor: 9, patch: 0 };  // 0.9.0
export const OPENRGB_MAX_VERSION = { major: 1, minor: 99, patch: 99 }; // any 1.x

// How we communicate this to users
const VERSION_MESSAGES = {
  too_old: (v, min) =>
    `OpenRGB ${v} is below the minimum required version ${formatVer(min)}. ` +
    `Download the latest release from openrgb.org.`,
  too_new: (v, max) =>
    `OpenRGB ${v} is above the tested maximum (${formatVer(max)}). ` +
    `Nexus will attempt to connect but some features may behave unexpectedly.`,
  ok: (v) =>
    `OpenRGB ${v} — compatible`,
};

// ── Required SDK capabilities ─────────────────────────────────────────────
// If any of these are missing, the bridge is "degraded" — we can still run
// but with reduced functionality.

const REQUIRED_CAPABILITIES  = ['connect', 'disconnect', 'scan'];
const OPTIONAL_CAPABILITIES  = ['setColor', 'setMode', 'setAllColor'];

// ── Status shape ──────────────────────────────────────────────────────────
//
// status:
//   'unknown'          — not yet verified
//   'verifying'        — check in progress
//   'ok'               — connected, version compatible, all capabilities present
//   'degraded'         — connected, but some optional capabilities missing
//   'version_mismatch' — connected but version not in supported range
//   'unavailable'      — cannot reach OpenRGB at all
//   'no_electron'      — running in browser preview mode

// ── Fallback descriptor ───────────────────────────────────────────────────
//
// Tells the engine and UI exactly what is and isn't safe to attempt.
// Never hardcode capability assumptions — always read from here.

function buildFallback(status, capabilities = [], version = null, reason = '') {
  const hasRequired = REQUIRED_CAPABILITIES.every(c => capabilities.includes(c));
  const hasColor    = capabilities.includes('setColor');
  const hasMode     = capabilities.includes('setMode');

  return {
    canControl: status === 'ok' || status === 'degraded',
    canScan:    hasRequired,
    canColor:   hasColor,
    canMode:    hasMode,
    canProfile: hasColor,
    isPreview:  status === 'no_electron',
    status,
    version,
    reason,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useOpenRGBVerifier(bridge) {
  const { safeSet } = useMemoryLeak();

  const [status,       _setStatus]       = useState('unknown');
  const [capabilities, _setCapabilities] = useState([]);
  const [version,      _setVersion]      = useState(null);
  const [reason,       _setReason]       = useState('');
  const [fallback,     _setFallback]     = useState(() =>
    buildFallback('unknown', [], null, 'Not yet verified')
  );

  const setStatus       = safeSet(_setStatus);
  const setCapabilities = safeSet(_setCapabilities);
  const setVersion      = safeSet(_setVersion);
  const setReason       = safeSet(_setReason);
  const setFallback     = safeSet(_setFallback);

  const verifyingRef = useRef(false);

  // ── Core verification ──────────────────────────────────────────────────

  const verify = useCallback(async () => {
    if (verifyingRef.current) return; // No concurrent verifications
    verifyingRef.current = true;
    setStatus('verifying');

    // Not in Electron — preview mode, no hardware access
    if (!bridge?.isElectron) {
      const fb = buildFallback('no_electron', [], null, 'Running in browser preview mode');
      setStatus('no_electron');
      setFallback(fb);
      setReason(fb.reason);
      verifyingRef.current = false;
      return;
    }

    const rgb = window.NexusOS?.rgb;
    if (!rgb) {
      const fb = buildFallback('unavailable', [], null, 'window.NexusOS.rgb not found');
      setStatus('unavailable');
      setFallback(fb);
      setReason(fb.reason);
      verifyingRef.current = false;
      return;
    }

    // ── 1. Capability check ──────────────────────────────────────────────

    const allCapabilities = [...REQUIRED_CAPABILITIES, ...OPTIONAL_CAPABILITIES];
    const present = allCapabilities.filter(c => typeof rgb[c] === 'function');
    const missing = REQUIRED_CAPABILITIES.filter(c => !present.includes(c));

    setCapabilities(present);

    if (missing.length > 0) {
      const msg = `OpenRGB SDK missing required methods: ${missing.join(', ')}`;
      const fb  = buildFallback('unavailable', present, null, msg);
      setStatus('unavailable');
      setFallback(fb);
      setReason(msg);
      verifyingRef.current = false;
      return;
    }

    // ── 2. Version check (optional — SDK may not expose version) ─────────

    let detectedVersion = null;
    let versionStatus   = 'ok';
    let versionReason   = '';

    try {
      if (typeof rgb.getVersion === 'function') {
        const vRes = await Promise.race([
          rgb.getVersion(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
        ]);
        if (vRes?.version) {
          detectedVersion = vRes.version;
          const parsed = parseVersion(vRes.version);
          if (parsed) {
            if (compareVersion(parsed, OPENRGB_MIN_VERSION) < 0) {
              versionStatus = 'version_mismatch';
              versionReason = VERSION_MESSAGES.too_old(vRes.version, OPENRGB_MIN_VERSION);
            } else if (compareVersion(parsed, OPENRGB_MAX_VERSION) > 0) {
              versionStatus = 'version_mismatch';
              versionReason = VERSION_MESSAGES.too_new(vRes.version, OPENRGB_MAX_VERSION);
            } else {
              versionReason = VERSION_MESSAGES.ok(vRes.version);
            }
          }
        }
      }
    } catch {
      // Version check is best-effort — don't block on it
    }

    setVersion(detectedVersion);

    if (versionStatus === 'version_mismatch') {
      const fb = buildFallback('version_mismatch', present, detectedVersion, versionReason);
      setStatus('version_mismatch');
      setFallback(fb);
      setReason(versionReason);
      verifyingRef.current = false;
      return;
    }

    // ── 3. Live probe — can we actually talk to OpenRGB? ─────────────────

    try {
      const probeResult = await Promise.race([
        rgb.scan(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout (3s)')), 3000)),
      ]);

      if (probeResult && !probeResult.error) {
        const hasDegradedCaps = OPTIONAL_CAPABILITIES.some(c => !present.includes(c));
        const finalStatus     = hasDegradedCaps ? 'degraded' : 'ok';
        const msg             = hasDegradedCaps
          ? `Connected. Some optional features unavailable: ${OPTIONAL_CAPABILITIES.filter(c => !present.includes(c)).join(', ')}`
          : versionReason || `OpenRGB ${detectedVersion ?? 'unknown version'} — fully operational`;

        const fb = buildFallback(finalStatus, present, detectedVersion, msg);
        setStatus(finalStatus);
        setFallback(fb);
        setReason(msg);
      } else {
        throw new Error(probeResult?.error || 'Probe returned empty result');
      }
    } catch (err) {
      const msg = `OpenRGB probe failed: ${err.message}`;
      const fb  = buildFallback('unavailable', present, detectedVersion, msg);
      setStatus('unavailable');
      setFallback(fb);
      setReason(msg);
    }

    verifyingRef.current = false;
  }, [bridge, setStatus, setCapabilities, setVersion, setReason, setFallback]);

  // ── Auto-verify on mount and when connection status changes ───────────

  useEffect(() => {
    verify();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge?.isConnected]);

  return {
    status,
    capabilities,
    version,
    reason,
    fallback,
    verify,
    isOk:         status === 'ok',
    isDegraded:   status === 'degraded',
    isUnavailable: status === 'unavailable' || status === 'no_electron',
    isVerifying:  status === 'verifying',
  };
}

// ── Version utilities ─────────────────────────────────────────────────────

function parseVersion(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.replace(/^v/, '').split('.').map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
}

function compareVersion(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return (a.patch ?? 0) - (b.patch ?? 0);
}

function formatVer({ major, minor, patch }) {
  return `${major}.${minor}.${patch ?? 0}`;
}

export default useOpenRGBVerifier;
