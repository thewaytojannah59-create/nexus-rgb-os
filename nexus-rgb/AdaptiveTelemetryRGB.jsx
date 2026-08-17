// ============================================================
// Nexus RGB OS  Adaptive Telemetry RGB Engine
//
// Watches real CPU temp, GPU temp, CPU load, GPU load, RAM usage
// every second and automatically pushes colours to all devices
// via OpenRGB. No fake data  if Electron + OpenRGB aren't
// running, it tells you clearly.
//
// Rules are fully editable below in RULES array.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { hexWithAlpha, tempToColor, usageToColor } from './color';
import { useMemoryLeak } from './hooks/useMemoryLeak';
import { Gateway } from './hooks/IPCGateway';
const isElectron = typeof window !== 'undefined' && window.NexusOS?.isElectron;

//  Rule engine 
// Each rule has: a condition fn, a resulting color, an effect,
// a label shown in the UI, and a priority (higher = wins).
// You can add / edit rules freely here.
const DEFAULT_RULES = [
  //  CPU temperature 
  {
    id: 'cpu_critical',
    group: 'CPU Temperature',
    label: 'CPU Critical  > 90C',
    condition: t => t.cpu.temp > 90,
    color: '#ff0000',
    effect: 'heartbeat',
    priority: 100,
    icon: '',
    description: 'Rapid red heartbeat  thermal emergency',
  },
  {
    id: 'cpu_hot',
    group: 'CPU Temperature',
    label: 'CPU Hot  > 80C',
    condition: t => t.cpu.temp > 80,
    color: '#ff4400',
    effect: 'pulse',
    priority: 90,
    icon: '',
    description: 'Orange pulse  CPU running hot',
  },
  {
    id: 'cpu_warm',
    group: 'CPU Temperature',
    label: 'CPU Warm  > 70C',
    condition: t => t.cpu.temp > 70,
    color: '#f59e0b',
    effect: 'breathing',
    priority: 80,
    icon: '',
    description: 'Amber breathing  CPU elevated',
  },
  //  GPU temperature 
  {
    id: 'gpu_critical',
    group: 'GPU Temperature',
    label: 'GPU Critical  > 90C',
    condition: t => t.gpu.temp > 90,
    color: '#ff0000',
    effect: 'heartbeat',
    priority: 100,
    icon: '',
    description: 'Rapid red heartbeat  GPU thermal emergency',
  },
  {
    id: 'gpu_hot',
    group: 'GPU Temperature',
    label: 'GPU Hot  > 85C',
    condition: t => t.gpu.temp > 85,
    color: '#ef4444',
    effect: 'pulse',
    priority: 95,
    icon: '',
    description: 'Red pulse  GPU running hot',
  },
  {
    id: 'gpu_warm',
    group: 'GPU Temperature',
    label: 'GPU Warm  > 75C',
    condition: t => t.gpu.temp > 75,
    color: '#ff6600',
    effect: 'breathing',
    priority: 85,
    icon: '',
    description: 'Orange breathing  GPU elevated',
  },
  //  CPU load 
  {
    id: 'cpu_load_high',
    group: 'CPU Load',
    label: 'CPU Load  > 90%',
    condition: t => t.cpu.usage > 90,
    color: '#ff2200',
    effect: 'color_cycle',
    priority: 70,
    icon: '',
    description: 'Red cycle  CPU maxed out',
  },
  {
    id: 'cpu_load_med',
    group: 'CPU Load',
    label: 'CPU Load  > 70%',
    condition: t => t.cpu.usage > 70,
    color: '#f59e0b',
    effect: 'static',
    priority: 60,
    icon: '',
    description: 'Amber static  CPU under load',
  },
  //  GPU load 
  {
    id: 'gpu_load_high',
    group: 'GPU Load',
    label: 'GPU Load  > 95%',
    condition: t => t.gpu.usage > 95,
    color: '#ff3300',
    effect: 'pulse',
    priority: 75,
    icon: '',
    description: 'Red pulse  GPU fully saturated',
  },
  {
    id: 'gpu_load_med',
    group: 'GPU Load',
    label: 'GPU Load  > 75%',
    condition: t => t.gpu.usage > 75,
    color: '#ff8800',
    effect: 'static',
    priority: 65,
    icon: '',
    description: 'Orange static  GPU working hard',
  },
  //  RAM usage 
  {
    id: 'ram_critical',
    group: 'RAM Usage',
    label: 'RAM Critical  > 95%',
    condition: t => t.ram.pct > 95,
    color: '#ff0066',
    effect: 'heartbeat',
    priority: 88,
    icon: '',
    description: 'Pink heartbeat  almost out of RAM',
  },
  {
    id: 'ram_high',
    group: 'RAM Usage',
    label: 'RAM High  > 85%',
    condition: t => t.ram.pct > 85,
    color: '#f59e0b',
    effect: 'breathing',
    priority: 72,
    icon: '',
    description: 'Amber breathing  RAM pressure high',
  },
  {
    id: 'ram_med',
    group: 'RAM Usage',
    label: 'RAM Med  > 70%',
    condition: t => t.ram.pct > 70,
    color: '#ffd700',
    effect: 'static',
    priority: 55,
    icon: '',
    description: 'Gold static  RAM filling up',
  },
  //  All good 
  {
    id: 'all_good',
    group: 'System Health',
    label: 'System Healthy',
    condition: () => true,   // always matches as fallback
    color: '#22c55e',
    effect: 'breathing',
    priority: 0,
    icon: '',
    description: 'Calm green breathing  everything normal',
  },
];

//  Sparkline 
function Sparkline({ data = [], color = '#00e5ff', h = 36, max = 100 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || data.length < 2) return;
    const ctx = c.getContext('2d'); const W = c.width; const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - (Math.min(v, max) / max) * (H - 2) - 1;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '33'); grad.addColorStop(1, 'transparent');
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
  }, [data, color, max]);
  return <canvas ref={ref} width={180} height={h} style={{ width: '100%', height: h, display: 'block', borderRadius: 3 }} />;
}

//  Metric card 
function MetricCard({ label, value, unit, max = 100, color, history = [] }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${hexWithAlpha(color, 0.25)}`, borderRadius: 12, padding: 14, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg,${hexWithAlpha(color, 0.06)},transparent)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: '#555', letterSpacing: 2, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif" }}>{label}</span>
        <span style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'Orbitron',sans-serif" }}>{value}<span style={{ fontSize: 10, fontWeight: 400, marginLeft: 2 }}>{unit}</span></span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, boxShadow: `0 0 8px ${color}`, transition: 'width 0.6s ease, background 0.6s ease' }} />
      </div>
      {history.length > 1 && <Sparkline data={history} color={color} max={max} h={32} />}
    </div>
  );
}

//  Rule row 
function RuleRow({ rule, isActive, enabled, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 9, background: isActive ? hexWithAlpha(rule.color, 0.1) : 'rgba(255,255,255,0.025)', border: `1px solid ${isActive ? hexWithAlpha(rule.color, 0.4) : 'rgba(255,255,255,0.06)'}`, transition: 'all 0.3s', marginBottom: 6 }}>
      <span style={{ fontSize: 16 }}>{rule.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? rule.color : '#888' }}>{rule.label}</div>
        <div style={{ fontSize: 10, color: '#555' }}>{rule.description}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {isActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 12, background: hexWithAlpha(rule.color, 0.15), border: `1px solid ${hexWithAlpha(rule.color, 0.3)}` }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: rule.color, boxShadow: `0 0 6px ${rule.color}`, animation: 'glow 1s infinite' }} />
            <span style={{ fontSize: 9, color: rule.color, fontWeight: 700, letterSpacing: 1 }}>ACTIVE</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 14, height: 14, borderRadius: 4, background: rule.color, boxShadow: `0 0 8px ${rule.color}88` }} />
          <span style={{ fontSize: 9, color: '#555', fontFamily: "'Share Tech Mono',monospace" }}>{rule.color}</span>
        </div>
        {/* Toggle */}
        <div onClick={() => onToggle(rule.id)} style={{ width: 36, height: 20, borderRadius: 10, background: enabled ? hexWithAlpha(rule.color, 0.3) : 'rgba(255,255,255,0.06)', border: `1px solid ${enabled ? rule.color : 'rgba(255,255,255,0.1)'}`, position: 'relative', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 2, left: enabled ? 17 : 2, width: 14, height: 14, borderRadius: '50%', background: enabled ? rule.color : '#444', transition: 'all 0.2s', boxShadow: enabled ? `0 0 6px ${rule.color}` : 'none' }} />
        </div>
      </div>
    </div>
  );
}

//  Main Component 
export default function AdaptiveTelemetryRGB({ devices = [], onApplyColor, onApplyEffect, notify, bridge = null }) {
  const { safeSet, timers } = useMemoryLeak();
  const { safeInterval, clearSafeInterval } = timers;

  const [enabled,       setEnabled]       = useState(false);
  const [telemetry,     setTelemetry]     = useState(null);
  const [activeRule,    setActiveRule]    = useState(null);
  const [rules,         setRules]         = useState(DEFAULT_RULES);
  const [disabledRules, setDisabledRules] = useState(new Set());
  const [history,       setHistory]       = useState({ cpuTemp: [], gpuTemp: [], cpuLoad: [], gpuLoad: [], ram: [] });
  const [applyCount,    setApplyCount]    = useState(0);
  const [lastApplied,   setLastApplied]   = useState(null);
  const intervalRef = useRef(null);
  const lastRuleId  = useRef(null);

  const safeSetTelemetry  = safeSet(setTelemetry);
  const safeSetHistory    = safeSet(setHistory);
  const safeSetActiveRule = safeSet(setActiveRule);
  const safeSetApplyCount = safeSet(setApplyCount);
  const safeSetLastApplied= safeSet(setLastApplied);
  const safeSetEnabled    = safeSet(setEnabled);

  //  Evaluate rules against current telemetry 
  const evaluate = useCallback((tel) => {
    const enabled_rules = rules.filter(r => !disabledRules.has(r.id));
    const matched = enabled_rules
      .filter(r => { try { return r.condition(tel); } catch { return false; } })
      .sort((a, b) => b.priority - a.priority);
    return matched[0] || null;
  }, [rules, disabledRules]);

  //  Push colour to all connected devices 
  const pushToDevices = useCallback(async (rule) => {
    if (!onApplyColor || devices.length === 0) return;
    for (const device of devices) {
      await onApplyColor(device.id, rule.color);
      if (onApplyEffect) await onApplyEffect(device.id, rule.effect);
    }
    safeSetApplyCount(n => n + 1);
    safeSetLastApplied({ rule, ts: Date.now() });
  }, [devices, onApplyColor, onApplyEffect, safeSetApplyCount, safeSetLastApplied]);

  //  Poll telemetry + evaluate rules 
  useEffect(() => {
    if (!enabled) {
      safeSetTelemetry(null);
      return;
    }

    if (!isElectron || !bridge?.onTelemetryUpdate) {
      notify?.('Adaptive RGB needs Electron + live telemetry. Run: npm start', 'error');
      safeSetEnabled(false);
      return;
    }

    const handleTelemetry = async (tel) => {
      if (!tel) return;

      try {
        safeSetTelemetry(tel);
        safeSetHistory(h => ({
          cpuTemp: [...h.cpuTemp.slice(-59), tel.cpu.temp],
          gpuTemp: [...h.gpuTemp.slice(-59), tel.gpu.temp],
          cpuLoad: [...h.cpuLoad.slice(-59), tel.cpu.usage],
          gpuLoad: [...h.gpuLoad.slice(-59), tel.gpu.usage],
          ram:     [...h.ram.slice(-59), tel.ram.pct],
        }));

        const rule = evaluate(tel);
        safeSetActiveRule(rule);

        if (rule && rule.id !== lastRuleId.current) {
          lastRuleId.current = rule.id;
          await pushToDevices(rule);
          notify?.(` Adaptive RGB: ${rule.label}  ${rule.color}`);
        }
      } catch (e) {
        console.error('[AdaptiveRGB] telemetry error:', e.message);
      }
    };

    const unsubscribe = bridge.onTelemetryUpdate(handleTelemetry);

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [enabled, bridge, evaluate, pushToDevices, notify,
      safeSetTelemetry, safeSetHistory, safeSetActiveRule, safeSetEnabled]);
  const toggleRule = useCallback(id => {
    setDisabledRules(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  //  Group rules by category 
  const groups = rules.reduce((acc, r) => {
    if (!acc[r.group]) acc[r.group] = [];
    acc[r.group].push(r);
    return acc;
  }, {});

  const card = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18, marginBottom: 16 };
  const LBL  = ({ c }) => <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif", marginBottom: 10 }}>{c}</div>;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 800 }}>

        {/* Header + master toggle */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}> Adaptive Telemetry RGB</div>
            <div style={{ fontSize: 13, color: '#666', lineHeight: 1.7, maxWidth: 500 }}>
              Automatically drives all your RGB devices based on real CPU/GPU temperatures and system load. When your GPU hits 85C, your lights turn red. When everything's healthy, calm green. Live. Automatic. Real hardware only.
            </div>
          </div>
          {/* Master on/off */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 24 }}>
            <div onClick={() => setEnabled(e => !e)}
              style={{ width: 56, height: 28, borderRadius: 14, background: enabled ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.06)', border: `1px solid ${enabled ? '#22c55e' : 'rgba(255,255,255,0.1)'}`, position: 'relative', cursor: 'pointer', transition: 'all 0.3s', boxShadow: enabled ? '0 0 16px rgba(34,197,94,0.3)' : 'none' }}>
              <div style={{ position: 'absolute', top: 3, left: enabled ? 29 : 3, width: 20, height: 20, borderRadius: '50%', background: enabled ? '#22c55e' : '#444', transition: 'all 0.3s', boxShadow: enabled ? '0 0 10px #22c55e' : 'none' }} />
            </div>
            <span style={{ fontSize: 10, color: enabled ? '#22c55e' : '#555', fontWeight: 700, fontFamily: "'Orbitron',sans-serif", letterSpacing: 1 }}>{enabled ? 'ON' : 'OFF'}</span>
          </div>
        </div>

        {/* Status bar */}
        {enabled && (
          <div style={{ ...card, background: activeRule ? hexWithAlpha(activeRule.color, 0.07) : 'rgba(34,197,94,0.05)', border: `1px solid ${activeRule ? hexWithAlpha(activeRule.color, 0.35) : 'rgba(34,197,94,0.25)'}`, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: activeRule?.color || '#22c55e', boxShadow: `0 0 12px ${activeRule?.color || '#22c55e'}`, animation: 'glow 1.5s infinite', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: activeRule?.color || '#22c55e' }}>{activeRule?.label || 'Monitoring'}</div>
              {activeRule && <div style={{ fontSize: 11, color: '#666' }}>{activeRule.description}  pushed to {devices.length} device{devices.length !== 1 ? 's' : ''}</div>}
            </div>
            <div style={{ fontSize: 10, color: '#444', textAlign: 'right' }}>
              <div>{applyCount} colour changes</div>
              {lastApplied && <div>{Math.round((Date.now() - lastApplied.ts) / 1000)}s ago</div>}
            </div>
          </div>
        )}

        {!isElectron && (
          <div style={{ ...card, border: '1px solid rgba(239,180,68,0.25)', background: 'rgba(239,180,68,0.05)', marginBottom: 20 }}>
            <span style={{ fontSize: 12, color: '#f59e0b' }}> Adaptive RGB requires real hardware. Run <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 6px', borderRadius: 4 }}>npm start</code> to launch as a desktop app with OpenRGB connected.</span>
          </div>
        )}

        {/* Live metrics */}
        {telemetry && (
          <div style={{ marginBottom: 20 }}>
            <LBL c="Live System Metrics" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
              <MetricCard label="CPU Temp"  value={telemetry.cpu.temp}  unit="C" max={100} color={tempToColor(telemetry.cpu.temp)}  history={history.cpuTemp} />
              <MetricCard label="GPU Temp"  value={telemetry.gpu.temp}  unit="C" max={100} color={tempToColor(telemetry.gpu.temp)}  history={history.gpuTemp} />
              <MetricCard label="CPU Load"  value={telemetry.cpu.usage} unit="%"  max={100} color={usageToColor(telemetry.cpu.usage)} history={history.cpuLoad} />
              <MetricCard label="GPU Load"  value={telemetry.gpu.usage} unit="%"  max={100} color={usageToColor(telemetry.gpu.usage)} history={history.gpuLoad} />
              <MetricCard label="RAM"       value={telemetry.ram.pct}   unit="%"  max={100} color={usageToColor(telemetry.ram.pct)}   history={history.ram} />
            </div>
          </div>
        )}

        {!telemetry && enabled && isElectron && (
          <div style={{ ...card, textAlign: 'center', padding: 32, marginBottom: 20 }}>
            <div style={{ fontSize: 24, animation: 'spin 1s linear infinite', display: 'inline-block', marginBottom: 8 }}></div>
            <div style={{ fontSize: 13, color: '#555' }}>Reading hardware sensors</div>
          </div>
        )}

        {/* Rules by group */}
        <LBL c="Trigger Rules  toggle individual rules on/off" />
        {Object.entries(groups).map(([group, groupRules]) => (
          <div key={group} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, color: '#444', letterSpacing: 1.5, marginBottom: 8, paddingLeft: 4 }}>{group}</div>
            {groupRules.map(rule => (
              <RuleRow
                key={rule.id}
                rule={rule}
                isActive={activeRule?.id === rule.id}
                enabled={!disabledRules.has(rule.id)}
                onToggle={toggleRule}
              />
            ))}
          </div>
        ))}

        {/* Custom threshold editor */}
        <div style={card}>
          <LBL c="Custom Thresholds" />
          <div style={{ fontSize: 13, color: '#666', marginBottom: 14, lineHeight: 1.7 }}>
            Edit thresholds directly in <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4, color: '#a855f7' }}>src/components/AdaptiveTelemetryRGB.jsx</code> in the <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4, color: '#a855f7' }}>DEFAULT_RULES</code> array. Each rule has a <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>condition</code> function, <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>color</code>, <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>effect</code>, and <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>priority</code>.
          </div>
          <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 8, padding: 14, fontFamily: "'Share Tech Mono',monospace", fontSize: 12, color: '#a855f7', lineHeight: 1.8 }}>
            {'{'}<br />
            &nbsp;&nbsp;id: 'gpu_hot',<br />
            &nbsp;&nbsp;label: 'GPU Hot &gt; 85C',<br />
            &nbsp;&nbsp;<span style={{ color: '#00e5ff' }}>condition: t =&gt; t.gpu.temp &gt; 85,</span><br />
            &nbsp;&nbsp;color: '#ef4444',<br />
            &nbsp;&nbsp;effect: 'pulse',<br />
            &nbsp;&nbsp;priority: 95,<br />
            {'}'}
          </div>
        </div>

        <style>{`
          @keyframes glow { 0%,100%{opacity:1} 50%{opacity:.3} }
          @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        `}</style>
      </div>
    </div>
  );
}




