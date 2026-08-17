// ============================================================
// Nexus RGB OS — Game Integrations Panel
// Simulates game state events → drives real RGB via bridge
// Real integration needs game SDK hooks (see SETUP.md)
// Each game section shows exactly what events trigger what
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { hslToHex, hexToRgb } from './color';

// ── Mini animated canvas preview ─────────────────────────────
function Preview({ draw, deps = [], w = 280, h = 60 }) {
  const ref = useRef(null);
  const frame = useRef(0);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    let raf;
    const loop = () => {
      frame.current++;
      draw(ctx, frame.current, w, h);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <canvas ref={ref} width={w} height={h} style={{ width: '100%', height: h, borderRadius: 6, display: 'block', background: '#0a0a12' }} />;
}

// ── F1 Race start lights ──────────────────────────────────────
function F1RaceStart({ onApply }) {
  const [phase, setPhase] = useState('idle'); // idle | lights | go | safety | pit
  const [litCount, setLitCount] = useState(0);
  const timerRef = useRef(null);

  const startSequence = () => {
    setPhase('lights'); setLitCount(0);
    let count = 0;
    const iv = setInterval(() => {
      count++;
      setLitCount(count);
      if (count === 5) {
        clearInterval(iv);
        setTimeout(() => {
          setPhase('go');
          onApply?.('f1_go', '#00ff00');
          setTimeout(() => setPhase('idle'), 3000);
        }, 800 + Math.random() * 600);
      }
    }, 700);
    timerRef.current = iv;
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  const events = [
    { id: 'f1_start',   label: 'Race Start',      color: '#ff0000', icon: '🔴', desc: '5 red lights → launch' },
    { id: 'f1_drs',     label: 'DRS Open',         color: '#00ff88', icon: '💨', desc: 'Green flash on DRS zone' },
    { id: 'f1_pit',     label: 'Pit Stop',          color: '#ffd700', icon: '🔧', desc: 'Yellow flash during stop' },
    { id: 'f1_safety',  label: 'Safety Car',        color: '#ffaa00', icon: '🚨', desc: 'Slow yellow pulse' },
    { id: 'f1_vsc',     label: 'Virtual Safety Car',color: '#ff8800', icon: '⚠️',  desc: 'VSC amber strobe' },
    { id: 'f1_fastest', label: 'Fastest Lap',       color: '#aa00ff', icon: '🟣', desc: 'Purple sweep effect' },
    { id: 'f1_finish',  label: 'Chequered Flag',    color: '#ffffff', icon: '🏁', desc: 'White strobe celebration' },
    { id: 'f1_sector1', label: 'Sector 1 Green',    color: '#00ff00', icon: '🟢', desc: 'Green sector color' },
    { id: 'f1_sector2', label: 'Sector 2 Yellow',   color: '#ffff00', icon: '🟡', desc: 'Yellow sector color' },
    { id: 'f1_sector3', label: 'Sector 3 Purple',   color: '#aa00ff', icon: '🟣', desc: 'Purple sector color' },
  ];

  return (
    <div>
      {/* Race start visual */}
      <div style={{ marginBottom: 14 }}>
        <Preview w={280} h={50} deps={[litCount, phase]} draw={(ctx, f, W, H) => {
          ctx.fillStyle = '#080810'; ctx.fillRect(0, 0, W, H);
          const lights = 5;
          const spacing = W / (lights + 1);
          for (let i = 0; i < lights; i++) {
            const x = spacing * (i + 1);
            const lit = i < litCount;
            const isGo = phase === 'go';
            ctx.beginPath(); ctx.arc(x, H / 2, 16, 0, Math.PI * 2);
            ctx.fillStyle = isGo ? '#000' : lit ? '#ff0000' : '#1a0000';
            ctx.fill();
            if (lit || isGo) {
              ctx.shadowColor = isGo ? '#00ff00' : '#ff0000';
              ctx.shadowBlur = isGo ? 20 : 12;
              ctx.beginPath(); ctx.arc(x, H / 2, 14, 0, Math.PI * 2);
              ctx.fillStyle = isGo ? '#00ff00' : '#ff2200';
              ctx.fill(); ctx.shadowBlur = 0;
            }
          }
        }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={startSequence} disabled={phase !== 'idle'}
            style={btnStyle('#ff0000', phase !== 'idle')}>
            {phase === 'lights' ? `Lights ${litCount}/5…` : phase === 'go' ? '🟢 GO!' : '▶ Run Start Sequence'}
          </button>
          <button onClick={() => { setPhase('safety'); onApply?.('f1_safety', '#ffaa00'); setTimeout(() => setPhase('idle'), 3000); }}
            style={btnStyle('#ffaa00', false)}>Safety Car</button>
        </div>
      </div>

      {/* All events */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {events.map(ev => (
          <button key={ev.id} onClick={() => onApply?.(ev.id, ev.color)}
            style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${ev.color}33`, background: `${ev.color}0d`,
              cursor: 'pointer', textAlign: 'left', color: '#ccc', fontSize: 12 }}>
            <span style={{ marginRight: 6 }}>{ev.icon}</span>
            <span style={{ fontWeight: 600, color: ev.color }}>{ev.label}</span>
            <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{ev.desc}</div>
          </button>
        ))}
      </div>

      {/* RPM bar demo */}
      <div style={{ marginTop: 14, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize: 10, color: '#555', letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif", marginBottom: 8 }}>RPM Indicator (drag to simulate)</div>
        <RPMBar onApply={onApply} />
      </div>
    </div>
  );
}

function RPMBar({ onApply }) {
  const [rpm, setRpm] = useState(6000);
  const max = 12000;
  const pct = rpm / max;
  const color = pct < 0.5 ? '#22c55e' : pct < 0.75 ? '#f59e0b' : pct < 0.9 ? '#ef4444' : '#ff00ff';
  useEffect(() => { onApply?.('rpm', color); }, [color, onApply]);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#888' }}>{rpm.toLocaleString()} RPM</span>
        <span style={{ fontSize: 12, color, fontWeight: 700 }}>{Math.round(pct * 100)}%</span>
      </div>
      <input type="range" min={0} max={max} value={rpm} onChange={e => setRpm(+e.target.value)} style={{ accentColor: color }} />
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', marginTop: 6, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: color, borderRadius: 4, transition: 'width 0.1s, background 0.1s', boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

// ── Valorant ──────────────────────────────────────────────────
function ValorantPanel({ onApply }) {
  const events = [
    { id: 'val_spike_plant',  label: 'Spike Planted',  color: '#ff4400', icon: '💥', desc: 'Red urgent flash → tick pulse' },
    { id: 'val_spike_defuse', label: 'Spike Defused',  color: '#00ff88', icon: '✅', desc: 'Green victory sweep' },
    { id: 'val_ace',          label: 'Ace',             color: '#ffd700', icon: '⭐', desc: 'Gold explosion burst' },
    { id: 'val_clutch',       label: 'Clutch',          color: '#ff00aa', icon: '🔥', desc: 'Pink strobe celebration' },
    { id: 'val_headshot',     label: 'Headshot Kill',   color: '#ff6600', icon: '🎯', desc: 'Orange flash on kill' },
    { id: 'val_round_win',    label: 'Round Win',       color: '#00e5ff', icon: '🏆', desc: 'Cyan wave sweep' },
    { id: 'val_round_loss',   label: 'Round Loss',      color: '#4400aa', icon: '💀', desc: 'Deep purple dim fade' },
    { id: 'val_buy_phase',    label: 'Buy Phase',       color: '#22c55e', icon: '💰', desc: 'Calm green idle' },
    { id: 'val_low_health',   label: 'Low Health',      color: '#ff0000', icon: '❤️', desc: 'Rapid red heartbeat' },
    { id: 'val_ultimate',     label: 'Ultimate Ready',  color: '#aa00ff', icon: '⚡', desc: 'Purple charge pulse' },
  ];
  return <EventGrid events={events} onApply={onApply} accentColor="#ff4455" />;
}

// ── CS2 ───────────────────────────────────────────────────────
function CS2Panel({ onApply }) {
  const [bombTimer, setBombTimer] = useState(null);
  const timerRef = useRef(null);

  const startBombTimer = () => {
    let t = 40;
    setBombTimer(t);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      t--;
      setBombTimer(t);
      // Escalate RGB as bomb timer counts down
      const urgency = 1 - (t / 40);
      const r = Math.round(255 * urgency);
      onApply?.('cs_bomb_tick', `rgb(${r},0,0)`);
      if (t <= 0) { clearInterval(timerRef.current); setBombTimer(null); onApply?.('cs_bomb_explode', '#ff6600'); }
    }, 1000);
  };
  useEffect(() => () => clearInterval(timerRef.current), []);

  const events = [
    { id: 'cs_bomb_plant',    label: 'Bomb Planted',    color: '#ff2200', icon: '💣', desc: 'Red urgent flash' },
    { id: 'cs_bomb_defuse',   label: 'Bomb Defused',    color: '#00ff88', icon: '✂️', desc: 'Green relief sweep' },
    { id: 'cs_bomb_explode',  label: 'Explosion',       color: '#ff6600', icon: '💥', desc: 'Orange burst' },
    { id: 'cs_mvp',           label: 'MVP',             color: '#ffd700', icon: '🥇', desc: 'Gold celebration' },
    { id: 'cs_ct_win',        label: 'CT Win',          color: '#0088ff', icon: '🔵', desc: 'Blue CT sweep' },
    { id: 'cs_t_win',         label: 'T Win',           color: '#ff8800', icon: '🟠', desc: 'Orange T sweep' },
    { id: 'cs_knife',         label: 'Knife Kill',      color: '#aaffaa', icon: '🔪', desc: 'Chaotic strobe' },
    { id: 'cs_ace',           label: 'Ace',             color: '#ff00ff', icon: '⭐', desc: 'Rainbow celebration' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 14, padding: 12, background: 'rgba(255,34,0,0.06)', borderRadius: 8, border: '1px solid rgba(255,34,0,0.2)' }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Bomb Timer Simulation</div>
        {bombTimer !== null ? (
          <div style={{ fontSize: 28, fontWeight: 900, fontFamily: "'Orbitron',sans-serif", color: bombTimer > 15 ? '#ff4400' : '#ff0000', letterSpacing: 2 }}>
            {String(bombTimer).padStart(2, '0')}s
            <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 8 }}>
              <div style={{ height: '100%', width: `${(bombTimer / 40) * 100}%`, background: bombTimer > 15 ? '#ff4400' : '#ff0000', transition: 'width 1s linear', borderRadius: 2 }} />
            </div>
          </div>
        ) : (
          <button onClick={startBombTimer} style={btnStyle('#ff2200', false)}>💣 Plant Bomb (simulate)</button>
        )}
      </div>
      <EventGrid events={events} onApply={onApply} accentColor="#ff4400" />
    </div>
  );
}

// ── Minecraft ─────────────────────────────────────────────────
function MinecraftPanel({ onApply }) {
  const biomes = [
    { id: 'mc_ocean',    label: 'Ocean',        color: '#0044ff', icon: '🌊', desc: 'Deep blue waves' },
    { id: 'mc_nether',   label: 'Nether',       color: '#ff2200', icon: '🔥', desc: 'Fiery red-orange' },
    { id: 'mc_end',      label: 'The End',      color: '#8800ff', icon: '🌌', desc: 'Purple void shimmer' },
    { id: 'mc_jungle',   label: 'Jungle',       color: '#00aa22', icon: '🌿', desc: 'Lush green breathing' },
    { id: 'mc_snow',     label: 'Snow',         color: '#aaddff', icon: '❄️', desc: 'Cool white-blue' },
    { id: 'mc_desert',   label: 'Desert',       color: '#ffa500', icon: '🏜️', desc: 'Warm sandy orange' },
    { id: 'mc_cave',     label: 'Deep Dark',    color: '#001133', icon: '🕯️', desc: 'Near-black dim' },
    { id: 'mc_mushroom', label: 'Mushroom',     color: '#ff66ff', icon: '🍄', desc: 'Whimsical pink-purple' },
    { id: 'mc_day',      label: 'Daytime',      color: '#88ccff', icon: '☀️', desc: 'Bright sky blue' },
    { id: 'mc_night',    label: 'Night',        color: '#001044', icon: '🌙', desc: 'Dark midnight blue' },
    { id: 'mc_thunder',  label: 'Thunderstorm', color: '#334455', icon: '⛈️', desc: 'Dark + lightning flashes' },
    { id: 'mc_health_low',label:'Low Health',   color: '#ff0000', icon: '❤️', desc: 'Red flashing heartbeat' },
  ];
  return <EventGrid events={biomes} onApply={onApply} accentColor="#5a8a3c" />;
}

// ── Forza ─────────────────────────────────────────────────────
function ForzaPanel({ onApply }) {
  const [speed, setSpeed] = useState(100);
  const maxSpeed = 300;

  const events = [
    { id: 'fz_race_start', label: 'Race Start',   color: '#00ff00', icon: '🚦', desc: 'Green light sequence' },
    { id: 'fz_finish',     label: 'Finish',       color: '#ffffff', icon: '🏁', desc: 'White chequered strobe' },
    { id: 'fz_drift',      color: '#ff8800', icon: '💨', label: 'Drift Zone',  desc: 'Orange trail effect' },
    { id: 'fz_nitrous',    color: '#00ffff', icon: '⚡', label: 'Nitrous',     desc: 'Cyan burst wave' },
    { id: 'fz_crash',      color: '#ff0000', icon: '💥', label: 'Collision',   desc: 'Red impact flash' },
    { id: 'fz_checkpoint', color: '#ffd700', icon: '📍', label: 'Checkpoint',  desc: 'Gold ping' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 14, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize: 10, color: '#555', letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif", marginBottom: 8 }}>Speed Visualizer</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Orbitron',sans-serif", color: '#00e5ff' }}>{speed} <span style={{ fontSize: 12 }}>km/h</span></span>
        </div>
        <input type="range" min={0} max={maxSpeed} value={speed} onChange={e => { setSpeed(+e.target.value); onApply?.('fz_speed', speedColor(+e.target.value, maxSpeed)); }} style={{ accentColor: speedColor(speed, maxSpeed) }} />
        <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', marginTop: 8, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(speed / maxSpeed) * 100}%`, background: speedColor(speed, maxSpeed), borderRadius: 3, boxShadow: `0 0 8px ${speedColor(speed, maxSpeed)}` }} />
        </div>
      </div>
      <EventGrid events={events} onApply={onApply} accentColor="#00e5ff" />
    </div>
  );
}

function speedColor(s, max) {
  const p = s / max;
  if (p < 0.33) return '#22c55e';
  if (p < 0.66) return '#f59e0b';
  if (p < 0.85) return '#ef4444';
  return '#ff00ff';
}

// ── Shared event grid ─────────────────────────────────────────
function EventGrid({ events, onApply, accentColor }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {events.map(ev => (
        <button key={ev.id} onClick={() => onApply?.(ev.id, ev.color)}
          style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${ev.color}33`,
            background: `${ev.color}0d`, cursor: 'pointer', textAlign: 'left', color: '#ccc', fontSize: 12,
            transition: 'all 0.15s' }}>
          <span style={{ marginRight: 6 }}>{ev.icon}</span>
          <span style={{ fontWeight: 600, color: ev.color }}>{ev.label}</span>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{ev.desc}</div>
        </button>
      ))}
    </div>
  );
}

function btnStyle(color, disabled) {
  return {
    padding: '8px 16px', borderRadius: 8, border: `1px solid ${color}44`,
    background: disabled ? 'rgba(255,255,255,0.03)' : `${color}18`,
    color: disabled ? '#444' : color, fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'Orbitron',sans-serif", letterSpacing: 1, transition: 'all 0.2s',
  };
}

// ── Label ─────────────────────────────────────────────────────
const Label = ({ children }) => (
  <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif", marginBottom: 10 }}>{children}</div>
);

// ── Main Export ───────────────────────────────────────────────
const GAMES = [
  { id: 'f1',        name: 'F1 2024',          icon: '🏎',  color: '#ff0000', Component: F1RaceStart },
  { id: 'valorant',  name: 'Valorant',          icon: '🎮',  color: '#ff4455', Component: ValorantPanel },
  { id: 'cs2',       name: 'CS2',              icon: '💣',  color: '#ff6600', Component: CS2Panel },
  { id: 'minecraft', name: 'Minecraft',         icon: '⛏️', color: '#5a8a3c', Component: MinecraftPanel },
  { id: 'forza',     name: 'Forza Horizon',     icon: '🚗',  color: '#00e5ff', Component: ForzaPanel },
];

export default function GameIntegrations({ onApplyColor, devices }) {
  const [activeGame, setActiveGame] = useState('f1');
  const [lastEvent, setLastEvent] = useState(null);

  const handleApply = useCallback((eventId, color) => {
    setLastEvent({ eventId, color, ts: Date.now() });
    // Apply to all connected devices
    if (onApplyColor && devices?.length > 0) {
      devices.forEach(d => onApplyColor(d.id, color));
    }
  }, [onApplyColor, devices]);

  const Active = GAMES.find(g => g.id === activeGame)?.Component;

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Game selector sidebar */}
      <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label>Games</Label>
        {GAMES.map(g => (
          <button key={g.id} onClick={() => setActiveGame(g.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9,
              border: activeGame === g.id ? `1px solid ${g.color}55` : '1px solid rgba(255,255,255,0.05)',
              background: activeGame === g.id ? `${g.color}12` : 'rgba(255,255,255,0.02)',
              color: activeGame === g.id ? '#fff' : '#555', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              textAlign: 'left', transition: 'all 0.2s' }}>
            <span style={{ fontSize: 20 }}>{g.icon}</span>
            <div>
              <div style={{ color: activeGame === g.id ? g.color : '#666', fontSize: 10, fontWeight: 700, letterSpacing: 1, fontFamily: "'Orbitron',sans-serif" }}>
                {g.name}
              </div>
            </div>
          </button>
        ))}

        {/* Integration status */}
        <div style={{ marginTop: 'auto', padding: '12px 0' }}>
          <Label>Real Integration</Label>
          <div style={{ fontSize: 10, color: '#444', lineHeight: 1.8 }}>
            For live in-game events, connect via:<br/>
            <span style={{ color: '#666' }}>• GSI (CS2/Valorant)<br/>• F1 UDP telemetry<br/>• Forza Data Out</span><br/>
            <span style={{ color: '#333' }}>See SETUP.md</span>
          </div>
        </div>
      </div>

      {/* Game panel */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {/* Last event indicator */}
        {lastEvent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '9px 14px',
            borderRadius: 8, background: `${lastEvent.color}12`, border: `1px solid ${lastEvent.color}33` }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: lastEvent.color, boxShadow: `0 0 8px ${lastEvent.color}` }} />
            <span style={{ fontSize: 12, color: lastEvent.color, fontWeight: 600 }}>Event: {lastEvent.eventId}</span>
            <span style={{ fontSize: 11, color: '#555', marginLeft: 'auto' }}>
              {devices?.length > 0 ? `→ applied to ${devices.length} device${devices.length > 1 ? 's' : ''}` : '→ no devices connected'}
            </span>
          </div>
        )}
        {Active && <Active onApply={handleApply} />}
      </div>
    </div>
  );
}
