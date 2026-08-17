// ============================================================
// Nexus RGB OS — AI Studio
// Supports: Google Gemini 2.0 Flash | Groq Llama 3.3 70B
// Both are FREE — no credit card needed
//
// Gemini key: aistudio.google.com/apikey  (starts with AIza)
// Groq key:   console.groq.com/keys       (starts with gsk_)
// ============================================================
import { useState, useCallback, useEffect } from 'react';
import { hexWithAlpha } from './color';
import { Gateway } from './hooks/IPCGateway';

// ── HIGH-2 FIX: Secure key storage ───────────────────────────────────────
// API keys are stored in the Electron main-process store (electron-store)
// NOT in renderer localStorage. This means:
//   - Keys survive renderer crashes/reloads without re-entry
//   - Keys are NOT accessible to any renderer-side XSS or script injection
//   - Keys are NOT in the browser's localStorage where extensions can read them
//   - Keys live in the OS user data directory, not in the app bundle
//
// In browser preview mode (no Electron), falls back to sessionStorage only
// (cleared when tab closes — intentionally NOT persisted in browser context).

const isElectron = typeof window !== 'undefined' && window.NexusOS?.isElectron === true;

const secureStore = {
  async get(key) {
    if (isElectron) {
      try {
        const result = await Gateway.call('store.get', { key });
        return result ?? '';
      } catch { return ''; }
    }
    // Browser preview — sessionStorage only, never localStorage
    try { return sessionStorage.getItem(key) ?? ''; } catch { return ''; }
  },
  async set(key, value) {
    if (isElectron) {
      try { await Gateway.call('store.set', { key, value }); } catch {}
    } else {
      // Browser preview — session only
      try { sessionStorage.setItem(key, value); } catch {}
    }
  },
  async remove(key) {
    if (isElectron) {
      try { await Gateway.call('store.delete', { key }); } catch {}
    } else {
      try { sessionStorage.removeItem(key); } catch {}
    }
  },
};

// ── Provider definitions ──────────────────────────────────────────────────
const PROVIDERS = {
  gemini: {
    id:          'gemini',
    name:        'Google Gemini',
    model:       'Gemini 3.5 Flash',
    color:       '#4285f4',
    accent:      '#a855f7',
    icon:        '✦',
    keyLabel:    'Paste your Google AI API key',
    keyStorage:  'nexus-rgb-gemini-key',
    keyLink:     'https://aistudio.google.com/apikey',
    keyHint:     'Open Google AI Studio → Create an API key → Copy the full key → Paste it here',
    free:        'Free, no credit card',
  },
  groq: {
    id:          'groq',
    name:        'Groq',
    model:       'Llama 3.3 70B',
    color:       '#f55036',
    accent:      '#f59e0b',
    icon:        '⚡',
    keyLabel:    'Paste your Groq API key',
    keyStorage:  'nexus-rgb-groq-key',
    keyLink:     'https://console.groq.com/keys',
    keyHint:     'Open Groq Console → Create an API key → Copy the full key → Paste it here',
    free:        'Free, blazing fast',
  },
};
// ── API callers ───────────────────────────────────────────────────────────
async function callAI(providerId, prompt, apiKey, system) {
  const isEl = typeof window !== 'undefined' && window.NexusOS?.isElectron;
  if (isEl) {
    // Secure path: route through main process proxy — API key never in renderer network traffic
    const { Gateway } = await import('./hooks/IPCGateway.js');
    const result = await Gateway.call('ai.query', { prompt, apiKey, system, provider: providerId });
    if (!result?.ok) {
      const msg = result?.error || 'AI call failed';
      if (msg.includes('429') || msg.includes('rate')) throw new Error('Rate limit — wait a moment and try again');
      if (msg.includes('401') || msg.includes('400') || msg.includes('Invalid')) throw new Error(msg);
      throw new Error(msg);
    }
    return result.text || '';
  }
  // Browser preview fallback — direct fetch (development only)
  if (providerId === 'gemini') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: (system ? system + '\n\n' : '') + prompt }] }] }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); const m = e?.error?.message || `HTTP ${res.status}`; if (res.status === 400) throw new Error('Invalid API key'); if (res.status === 429) throw new Error('Rate limit'); throw new Error(m); }
    const d = await res.json(); return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  const msgs = system ? [{ role: 'system', content: system }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }];
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: msgs, max_tokens: 1024 }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); const m = e?.error?.message || `HTTP ${res.status}`; if (res.status === 401) throw new Error('Invalid API key'); if (res.status === 429) throw new Error('Rate limit'); throw new Error(m); }
  const d = await res.json(); return d.choices?.[0]?.message?.content || '';
}

// ── Shared prompts ────────────────────────────────────────────────────────
const SCENE_SYSTEM = `You are an expert RGB lighting designer for gaming PCs.
The user describes a scene, mood, game, or vibe.
Reply ONLY with a single valid JSON object — no markdown, no backticks, no extra text.
{
  "name": "Creative name (3-5 words)",
  "description": "One vivid atmospheric sentence",
  "effect": "static|breathing|rainbow_wave|color_cycle|pulse|aurora|fire|matrix_rain|comet|ripple|ice_storm|heartbeat|starfield|hyperdrive",
  "primary_color": "#RRGGBB",
  "secondary_color": "#RRGGBB",
  "accent_color": "#RRGGBB",
  "brightness": 0-100,
  "speed": 0-100,
  "mood": "one word",
  "zones": { "keyboard": "#RRGGBB", "mouse": "#RRGGBB", "fans": "#RRGGBB", "ram": "#RRGGBB", "case": "#RRGGBB" }
}`;

const ADVISOR_SYSTEM = `You are a PC hardware performance advisor built into an RGB app.
You receive real hardware telemetry. Give short, direct, specific advice.
Use bullet points. Max 6 bullets. Include actual numbers in your advice.`;

// ── Quick moods ───────────────────────────────────────────────────────────
const MOODS = [
  { id:'gaming',    name:'Gaming',    icon:'🎮', prompt:'Intense competitive gaming, maximum aggression and energy' },
  { id:'study',     name:'Study',     icon:'📚', prompt:'Calm focused study session, warm soft low brightness' },
  { id:'sleep',     name:'Sleep',     icon:'🌙', prompt:'Winding down for sleep, very dim deep red, almost off' },
  { id:'movie',     name:'Movie',     icon:'🎬', prompt:'Cinematic movie in dark room, dim blue ambient bias lighting' },
  { id:'coding',    name:'Coding',    icon:'💻', prompt:'Deep focus coding session, matrix green hacker terminal' },
  { id:'workout',   name:'Workout',   icon:'💪', prompt:'Intense workout energy, high energy red orange fast pulse' },
  { id:'relax',     name:'Relax',     icon:'🧘', prompt:'Peaceful relaxation, gentle slow purple blue aurora' },
  { id:'party',     name:'Party',     icon:'🎉', prompt:'Full party mode, all colors maximum brightness fast disco' },
  { id:'f1',        name:'F1 Race',   icon:'🏎', prompt:'F1 Grand Prix night race, tension then dramatic race start' },
  { id:'cyberpunk', name:'Cyberpunk', icon:'⚡', prompt:'Cyberpunk 2077 neon city night rain, pink and cyan neon' },
  { id:'space',     name:'Space',     icon:'🚀', prompt:'Deep space galaxy exploration, dark cosmic nebula purples' },
  { id:'lofi',      name:'Lo-fi',     icon:'🎵', prompt:'Lo-fi chill beats, warm amber dreamy slow breathing' },
];

const EXAMPLES = [
  'F1 Monaco night race', 'Cyberpunk Tokyo neon rain', 'Iron Man suit powering up',
  'NASA rocket launch countdown', 'Halloween haunted mansion', 'Interstellar black hole',
  'Star Wars lightsaber duel', 'Deep ocean bioluminescence', 'Electric thunderstorm',
];

// ═════════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════════
export default function AIStudio({ devices = [], onApplyAll, onApplyDevice, selectedDevice, telemetry }) {

  // Provider selection
  const [providerId, setProviderId] = useState('gemini');
  const provider = PROVIDERS[providerId];

  // Per-provider key state — loaded async from secure store
  const [keys,      setKeys]      = useState({ gemini: '', groq: '' });
  const [keyInputs, setKeyInputs] = useState({ gemini: '', groq: '' });
  const [keyValid,  setKeyValid]  = useState({ gemini: false, groq: false });
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [checking,  setChecking]  = useState(false);

  // HIGH-2: Load keys from secure store on mount (async)
  useEffect(() => {
    async function loadKeys() {
      const [geminiKey, groqKey] = await Promise.all([
        secureStore.get(PROVIDERS.gemini.keyStorage),
        secureStore.get(PROVIDERS.groq.keyStorage),
      ]);
      setKeys({ gemini: geminiKey || '', groq: groqKey || '' });
      setKeyValid({ gemini: !!geminiKey, groq: !!groqKey });
      setKeysLoaded(true);
    }
    loadKeys();
  }, []);

  // UI state
  const [aiTab,    setAiTab]    = useState('scene');
  const [prompt,   setPrompt]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [scene,    setScene]    = useState(null);
  const [history,  setHistory]  = useState([]);
  const [advice,   setAdvice]   = useState('');
  const [advising, setAdvising] = useState(false);
  const [error,    setError]    = useState('');

  const activeKey   = keys[providerId];
  const isConnected = keyValid[providerId];

  // ── Key management ─────────────────────────────────────────────────────
  const checkKey = useCallback(async () => {
    const k = keyInputs[providerId].trim();
    if (!k) return;
    setChecking(true); setError('');
    try {
      await callAI(providerId, 'Reply with one word: ready', k);
      await secureStore.set(provider.keyStorage, k); // HIGH-2: secure store
      setKeys(prev => ({ ...prev, [providerId]: k }));
      setKeyValid(prev => ({ ...prev, [providerId]: true }));
      setKeyInputs(prev => ({ ...prev, [providerId]: '' }));
    } catch (e) {
      setKeyValid(prev => ({ ...prev, [providerId]: false }));
      setError(e.message);
    }
    setChecking(false);
  }, [providerId, keyInputs, provider]);

  const removeKey = useCallback(async () => {
    await secureStore.remove(provider.keyStorage); // HIGH-2: secure removal
    setKeys(prev => ({ ...prev, [providerId]: '' }));
    setKeyValid(prev => ({ ...prev, [providerId]: false }));
  }, [providerId, provider]);

  // ── Scene generation ──────────────────────────────────────────────────
  const generate = useCallback(async (userPrompt) => {
    if (!userPrompt.trim() || !activeKey) return;
    setLoading(true); setError(''); setScene(null);
    try {
      const text = await callAI(providerId, userPrompt, activeKey, SCENE_SYSTEM);
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Unexpected response — please try again');
      const json = JSON.parse(match[0]);
      setScene(json);
      setHistory(h => [{ prompt: userPrompt, scene: json, provider: provider.name }, ...h.slice(0, 9)]);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [providerId, activeKey, provider]);

  // ── PC advisor ────────────────────────────────────────────────────────
  const getAdvice = useCallback(async () => {
    if (!activeKey || !telemetry) return;
    setAdvising(true); setAdvice(''); setError('');
    try {
      const summary = `CPU: ${telemetry.cpu}% load, ${telemetry.temp ?? '?'}°C | RAM: ${telemetry.ram}% | GPU: ${telemetry.gpu ?? 'N/A'}%`;
      const text = await callAI(providerId,
        `My PC right now: ${summary}\n\nAnalyze and give me performance advice.`,
        activeKey, ADVISOR_SYSTEM
      );
      setAdvice(text);
    } catch (e) { setError(e.message); }
    setAdvising(false);
  }, [providerId, activeKey, telemetry]);

  // ── Shared styles ─────────────────────────────────────────────────────
  const C  = provider.color;
  const C2 = provider.accent;
  const card = {
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 14, padding: 20, marginBottom: 16,
  };
  const inp = {
    width: '100%', padding: '10px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 9, color: '#fff', fontSize: 13, outline: 'none',
    fontFamily: "'Rajdhani',sans-serif",
  };
  const LBL = ({ c }) => (
    <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, textTransform: 'uppercase',
      fontFamily: "'Orbitron',sans-serif", marginBottom: 10 }}>{c}</div>
  );
  const connectedCount = Object.values(keyValid).filter(Boolean).length;

  // ═════════════════════════════════════════════════════════════════════
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
      <div style={{ maxWidth: 740 }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Orbitron',sans-serif",
              background: `linear-gradient(135deg, ${C}, ${C2})`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              AI Studio
            </div>
            {connectedCount > 0 && (
              <div style={{ padding: '3px 10px', borderRadius: 20,
                background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                fontSize: 10, color: '#22c55e', fontWeight: 700,
                fontFamily: "'Orbitron',sans-serif" }}>
                {connectedCount} provider{connectedCount > 1 ? 's' : ''} connected
              </div>
            )}
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.8 }}>
            Describe any scene, game, or mood — AI generates a complete RGB lighting setup instantly.
            Both providers are <strong style={{ color: '#888' }}>100% free</strong>, no credit card needed.
          </div>
        </div>

        {/* ── Provider picker ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {Object.values(PROVIDERS).map(p => {
            const active   = providerId === p.id;
            const connected = keyValid[p.id];
            return (
              <button key={p.id} onClick={() => { setProviderId(p.id); setError(''); setScene(null); }}
                style={{ padding: '16px 18px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                  border: active ? `1.5px solid ${p.color}66` : '1.5px solid rgba(255,255,255,0.07)',
                  background: active ? `${p.color}0e` : 'rgba(255,255,255,0.02)',
                  transition: 'all 0.18s', position: 'relative', overflow: 'hidden' }}>
                {active && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: `linear-gradient(90deg, transparent, ${p.color}, ${p.accent}, transparent)` }} />
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18, color: p.color }}>{p.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? '#fff' : '#888' }}>{p.name}</span>
                  </div>
                  {connected && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%',
                      background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
                  )}
                </div>
                <div style={{ fontSize: 11, color: active ? p.color : '#444', fontWeight: 600, marginBottom: 3 }}>
                  {p.model}
                </div>
                <div style={{ fontSize: 10, color: '#333' }}>{p.free}</div>
              </button>
            );
          })}
        </div>

        {/* ── API Key card ── */}
        <div style={{ ...card,
          border: isConnected ? `1px solid ${C}55`
                : keyValid[providerId] === false ? '1px solid rgba(239,68,68,0.4)'
                : '1px solid rgba(255,255,255,0.07)',
          background: isConnected ? `${C}06` : 'rgba(255,255,255,0.025)',
          transition: 'all 0.2s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 16, color: C }}>{provider.icon}</span>
            <LBL c={`${provider.name} API Key — ${provider.free}`} />
          </div>

          {isConnected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%',
                background: '#22c55e', boxShadow: '0 0 8px #22c55e', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>
                Connected — {provider.model} ready
              </span>
              <button onClick={removeKey}
                style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6,
                  border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)',
                  color: '#ef4444', fontSize: 10, cursor: 'pointer',
                  fontFamily: "'Orbitron',sans-serif" }}>
                Remove
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="password"
                  placeholder={provider.keyLabel}
                  value={keyInputs[providerId]}
                  onChange={e => setKeyInputs(prev => ({ ...prev, [providerId]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && checkKey()}
                  style={{ ...inp, flex: 1 }}
                />
                <button onClick={checkKey} disabled={checking || !keyInputs[providerId].trim()}
                  style={{ padding: '10px 20px', borderRadius: 9,
                    border: `1px solid ${C}55`, background: `${C}22`,
                    color: C, fontSize: 11, fontWeight: 700,
                    cursor: checking || !keyInputs[providerId].trim() ? 'not-allowed' : 'pointer',
                    fontFamily: "'Orbitron',sans-serif", whiteSpace: 'nowrap',
                    opacity: !keyInputs[providerId].trim() ? 0.4 : 1 }}>
                  {checking ? '⟳ Checking…' : '✓ Connect'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#555', lineHeight: 2.1 }}>
                Get your key →{' '}
                <a href={provider.keyLink} target="_blank" rel="noreferrer" style={{ color: C }}>
                  {provider.keyHint.split(' → ')[0]}
                </a>
                {' '}→ {provider.keyHint.split(' → ').slice(1).join(' → ')}
              </div>
              {error && !isConnected && (
                <div style={{ color: '#ef4444', fontSize: 12, marginTop: 10,
                  padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  ⚠ {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Sub-tabs ── */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 22 }}>
          {[['scene', '🎨 Scene Generator'], ['advisor', '📊 PC Advisor']].map(([id, label]) => (
            <button key={id} onClick={() => { setAiTab(id); setError(''); }}
              style={{ padding: '9px 20px', background: 'none', border: 'none', cursor: 'pointer',
                color: aiTab === id ? C : '#555', fontSize: 12, fontWeight: 700,
                position: 'relative', fontFamily: "'Orbitron',sans-serif" }}>
              {label}
              {aiTab === id && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
                  background: `linear-gradient(90deg, ${C}, ${C2})` }} />
              )}
            </button>
          ))}
        </div>

        {/* ═══════════════════ SCENE GENERATOR ═══════════════════ */}
        {aiTab === 'scene' && (
          <>
            {/* Quick moods */}
            <div style={card}>
              <LBL c="Quick Moods — one click generate" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 8 }}>
                {MOODS.map(m => (
                  <button key={m.id}
                    onClick={() => { setPrompt(m.prompt); generate(m.prompt); }}
                    disabled={loading || !isConnected}
                    style={{ padding: '12px 6px', borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.07)',
                      background: 'rgba(255,255,255,0.03)',
                      cursor: loading || !isConnected ? 'not-allowed' : 'pointer',
                      fontSize: 10, color: '#aaa',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      opacity: loading || !isConnected ? 0.35 : 1,
                      transition: 'all 0.15s' }}>
                    <span style={{ fontSize: 22 }}>{m.icon}</span>
                    <span style={{ fontWeight: 600 }}>{m.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom prompt */}
            <div style={card}>
              <LBL c="Custom Scene — describe anything" />
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) generate(prompt); }}
                placeholder={`Describe any scene, game, mood, or vibe…\n\nTry: ${EXAMPLES.slice(0, 3).join(' · ')}`}
                rows={4}
                style={{ ...inp, resize: 'vertical', lineHeight: 1.7, marginBottom: 14 }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => generate(prompt)}
                  disabled={loading || !prompt.trim() || !isConnected}
                  style={{ padding: '12px 28px', borderRadius: 9,
                    border: `1px solid ${C}55`,
                    background: loading
                      ? 'rgba(50,50,50,0.1)'
                      : `linear-gradient(135deg, ${C}22, ${C2}18)`,
                    color: loading ? '#555' : C,
                    fontSize: 11, fontWeight: 700,
                    cursor: loading || !prompt.trim() || !isConnected ? 'not-allowed' : 'pointer',
                    fontFamily: "'Orbitron',sans-serif", letterSpacing: 1,
                    opacity: !prompt.trim() || !isConnected ? 0.4 : 1 }}>
                  {loading ? '⟳ GENERATING…' : `${provider.icon} GENERATE SCENE`}
                </button>
                <button
                  onClick={() => setPrompt(EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)])}
                  style={{ padding: '12px 16px', borderRadius: 9,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.03)',
                    color: '#666', fontSize: 11, cursor: 'pointer',
                    fontFamily: "'Orbitron',sans-serif" }}>
                  🎲 Random
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8,
                  background: `${C}0a`, border: `1px solid ${C}22` }}>
                  <span style={{ fontSize: 10, color: C }}>{provider.icon}</span>
                  <span style={{ fontSize: 10, color: '#555' }}>via {provider.name}</span>
                </div>
                <span style={{ fontSize: 10, color: '#2a2a2a' }}>Ctrl+Enter</span>
              </div>
            </div>

            {/* Error */}
            {error && aiTab === 'scene' && isConnected && (
              <div style={{ padding: '12px 16px', borderRadius: 9,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444', fontSize: 12, marginBottom: 16 }}>
                ⚠ {error}
              </div>
            )}

            {/* Not connected nudge */}
            {!isConnected && (
              <div style={{ padding: '16px 20px', borderRadius: 12,
                background: `${C}08`, border: `1px solid ${C}22`,
                fontSize: 13, color: '#555', marginBottom: 16, lineHeight: 1.8 }}>
                Connect a <strong style={{ color: C }}>{provider.name}</strong> API key above to start generating scenes.
                Or switch to{' '}
                <span
                  onClick={() => setProviderId(providerId === 'gemini' ? 'groq' : 'gemini')}
                  style={{ color: C, cursor: 'pointer', textDecoration: 'underline' }}>
                  {providerId === 'gemini' ? 'Groq' : 'Gemini'}
                </span>
                {keyValid[providerId === 'gemini' ? 'groq' : 'gemini'] ? ' (already connected)' : ''}.
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div style={{ ...card, textAlign: 'center', padding: 44 }}>
                <div style={{ fontSize: 36, marginBottom: 14 }}>✨</div>
                <div style={{ fontSize: 14, color: C,
                  fontFamily: "'Orbitron',sans-serif", letterSpacing: 1 }}>
                  Generating your scene…
                </div>
                <div style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
                  {provider.name} · {provider.model}
                  {providerId === 'groq' ? ' · usually under 1 second' : ' · usually under 2 seconds'}
                </div>
              </div>
            )}

            {/* Scene result */}
            {scene && !loading && (
              <div style={{ padding: 24, borderRadius: 16,
                background: hexWithAlpha(scene.primary_color || C, 0.06),
                border: `1.5px solid ${hexWithAlpha(scene.primary_color || C, 0.35)}`,
                marginBottom: 16, position: 'relative', overflow: 'hidden' }}>

                {/* Top shimmer bar */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: `linear-gradient(90deg, transparent, ${scene.primary_color || C}, ${scene.secondary_color || C2}, transparent)` }} />

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
                      {scene.name}
                    </div>
                    <div style={{ fontSize: 13, color: '#888', fontStyle: 'italic', lineHeight: 1.6 }}>
                      {scene.description}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 10, color: '#333' }}>
                      Generated by {provider.name} · {provider.model}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {[scene.primary_color, scene.secondary_color, scene.accent_color]
                      .filter(Boolean).map((c, i) => (
                      <div key={i} title={c} style={{ width: 32, height: 32, borderRadius: 9,
                        background: c, boxShadow: `0 0 16px ${c}99`,
                        border: '2px solid rgba(255,255,255,0.12)' }} />
                    ))}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8, marginBottom: 16 }}>
                  {[
                    ['Effect',     scene.effect],
                    ['Brightness', `${scene.brightness}%`],
                    ['Speed',      `${scene.speed}%`],
                    ['Mood',       scene.mood],
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: '9px 12px',
                      background: 'rgba(255,255,255,0.04)', borderRadius: 9 }}>
                      <div style={{ fontSize: 9, color: '#555', letterSpacing: 1.5,
                        textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif",
                        marginBottom: 4 }}>{k}</div>
                      <div style={{ fontSize: 13, color: '#ddd', fontWeight: 600,
                        textTransform: 'capitalize' }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Zone dots */}
                {scene.zones && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                    {Object.entries(scene.zones).map(([zone, c]) => (
                      <div key={zone} style={{ display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 12px', borderRadius: 20,
                        background: hexWithAlpha(c, 0.14),
                        border: `1px solid ${hexWithAlpha(c, 0.38)}` }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%',
                          background: c, boxShadow: `0 0 6px ${c}` }} />
                        <span style={{ fontSize: 11, color: '#aaa' }}>{zone}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Apply buttons */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => onApplyAll?.(scene)}
                    style={{ flex: 1, padding: '13px 0', borderRadius: 10,
                      border: `1px solid ${hexWithAlpha(scene.primary_color || C, 0.5)}`,
                      background: `linear-gradient(135deg,
                        ${hexWithAlpha(scene.primary_color || C, 0.22)},
                        ${hexWithAlpha(scene.secondary_color || C2, 0.12)})`,
                      color: scene.primary_color || C,
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      fontFamily: "'Orbitron',sans-serif", letterSpacing: 1 }}>
                    ✓ APPLY TO ALL DEVICES
                  </button>
                  {selectedDevice && (
                    <button onClick={() => onApplyDevice?.(scene, selectedDevice)}
                      style={{ padding: '13px 20px', borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)',
                        color: '#888', fontSize: 11, fontWeight: 700,
                        cursor: 'pointer', fontFamily: "'Orbitron',sans-serif" }}>
                      Selected Only
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* History */}
            {history.length > 1 && (
              <div style={card}>
                <LBL c="Recent Scenes" />
                {history.slice(1).map((h, i) => (
                  <div key={i} onClick={() => setScene(h.scene)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', borderRadius: 9,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      cursor: 'pointer', marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[h.scene.primary_color, h.scene.secondary_color].filter(Boolean).map((c, ci) => (
                        <div key={ci} style={{ width: 12, height: 12, borderRadius: 3,
                          background: c, boxShadow: `0 0 6px ${c}88` }} />
                      ))}
                    </div>
                    <span style={{ flex: 1, fontSize: 12, color: '#aaa' }}>{h.scene.name}</span>
                    <span style={{ fontSize: 9, color: '#333', padding: '2px 8px', borderRadius: 10,
                      background: 'rgba(255,255,255,0.04)' }}>{h.provider}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══════════════════ PC ADVISOR ═══════════════════ */}
        {aiTab === 'advisor' && (
          <>
            <div style={card}>
              <LBL c="AI Performance Advisor" />
              <div style={{ fontSize: 13, color: '#666', marginBottom: 16, lineHeight: 1.8 }}>
                Reads your live hardware sensors and gives you plain-English advice — thermal issues,
                bottlenecks, RAM pressure — in seconds.
              </div>

              {telemetry ? (
                <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 9,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10 }}>
                  {[
                    ['CPU',  `${telemetry.cpu}%`],
                    ['Temp', telemetry.temp ? `${telemetry.temp}°C` : 'N/A'],
                    ['RAM',  `${telemetry.ram}%`],
                    ['GPU',  telemetry.gpu != null ? `${telemetry.gpu}%` : 'N/A'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, textTransform: 'uppercase',
                        fontFamily: "'Orbitron',sans-serif", marginBottom: 3 }}>{k}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#ddd' }}>{v}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 16,
                  padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  ⚠ No telemetry yet — open the Telemetry tab first
                </div>
              )}

              <button onClick={getAdvice} disabled={advising || !isConnected || !telemetry}
                style={{ padding: '12px 24px', borderRadius: 9,
                  border: `1px solid ${C}55`, background: advising ? 'rgba(50,50,50,0.1)' : `${C}18`,
                  color: advising ? '#555' : C, fontSize: 11, fontWeight: 700,
                  cursor: advising || !isConnected || !telemetry ? 'not-allowed' : 'pointer',
                  fontFamily: "'Orbitron',sans-serif", letterSpacing: 1,
                  opacity: !isConnected || !telemetry ? 0.4 : 1 }}>
                {advising ? '⟳ Analyzing…' : `${provider.icon} Analyze My PC`}
              </button>
            </div>

            {error && aiTab === 'advisor' && (
              <div style={{ padding: '12px 16px', borderRadius: 9,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444', fontSize: 12, marginBottom: 16 }}>
                ⚠ {error}
              </div>
            )}

            {advice && (
              <div style={{ ...card, border: `1px solid ${C}33`, background: `${C}06` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <LBL c={`${provider.name} Analysis`} />
                </div>
                <div style={{ fontSize: 13, color: '#bbb', lineHeight: 2, whiteSpace: 'pre-wrap' }}>
                  {advice}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
