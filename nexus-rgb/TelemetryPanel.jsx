// ============================================================
// Nexus RGB OS — TelemetryPanel
// Real CPU/GPU/RAM/FPS data via systeminformation (Electron).
// RGB Health Mapping: temps auto-drive device colours.
// ============================================================
import { useState, useEffect, useRef } from 'react';
import { tempToColor, usageToColor, hexWithAlpha } from './color';

const isElectron = typeof window !== 'undefined' && window.NexusOS?.isElectron;

// ── Sparkline canvas ─────────────────────────────────────────
function Sparkline({ data = [], color = '#00e5ff', h = 40, max = 100 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || data.length < 2) return;
    const ctx = c.getContext('2d');
    const W = c.width; const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - (Math.min(v, max) / max) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    // Fill under
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = hexWithAlpha(color, 0.08); ctx.fill();
  }, [data, color, max, h]);
  return <canvas ref={ref} width={200} height={h} style={{ width: '100%', height: h, display: 'block', borderRadius: 4 }} />;
}
// ── Arc gauge ────────────────────────────────────────────────
function ArcGauge({ value, max = 100, label, unit = '%', color, size = 110 }) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const pct = Math.max(0, Math.min(1, safeValue / max));
  const c = color || usageToColor(pct * 100);

  const r = size / 2 - 10;
  const circumference = 2 * Math.PI * r;
  const arcLength = circumference * 0.75;
  const dashOffset = arcLength * (1 - pct);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: 'visible' }}
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset="0"
          transform={`rotate(135 ${size / 2} ${size / 2})`}
        />

        {/* Value arc */}
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={c}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(135 ${size / 2} ${size / 2})`}
            style={{
              filter: `drop-shadow(0 0 6px ${c})`,
            }}
          />
        )}

        {/* Centre value */}
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          fill={c}
          fontSize="20"
          fontWeight="700"
          fontFamily="'Orbitron',sans-serif"
        >
          {Math.round(safeValue)}
        </text>

        <text
          x={size / 2}
          y={size / 2 + 14}
          textAnchor="middle"
          fill="#555"
          fontSize="11"
          fontFamily="'Rajdhani',sans-serif"
        >
          {unit}
        </text>
      </svg>

      <div
        style={{
          fontSize: 10,
          color: '#555',
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          fontFamily: "'Orbitron',sans-serif",
        }}
      >
        {label}
      </div>
    </div>
  );
}
// ── Health bar row ────────────────────────────────────────────
function HealthBar({ label, value, max = 100, unit = '%', warn = 70, crit = 85 }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct < warn ? '#22c55e' : pct < crit ? '#f59e0b' : '#ef4444';
  const status = pct < warn ? 'Good' : pct < crit ? 'Warm' : '⚠ High';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 11, color: '#777', minWidth: 100 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease', boxShadow: `0 0 6px ${color}` }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 700, minWidth: 60, textAlign: 'right' }}>{Math.round(value)}{unit}</span>
      <span style={{ fontSize: 10, color: '#444', minWidth: 50 }}>{status}</span>
    </div>
  );
}

// ── RGB advice based on temps ─────────────────────────────────
function RGBHealthAdvisor({ telemetry, onApplyAll }) {
  if (!telemetry) return null;
  const gpuTemp = telemetry.gpu?.temp || 0;
  const cpuTemp = telemetry.cpu?.temp || 0;
  const ramPct  = telemetry.ram?.pct  || 0;
  const maxTemp = Math.max(gpuTemp, cpuTemp);

  const alerts = [];
  if (gpuTemp >= 90) alerts.push({ msg: `GPU critical: ${gpuTemp}°C`, color: '#ff0000', effect: 'pulse',    severity: 'critical' });
  else if (gpuTemp >= 80) alerts.push({ msg: `GPU hot: ${gpuTemp}°C`, color: '#ef4444', effect: 'breathing', severity: 'warning' });
  if (cpuTemp >= 90) alerts.push({ msg: `CPU critical: ${cpuTemp}°C`, color: '#ff0000', effect: 'pulse',    severity: 'critical' });
  else if (cpuTemp >= 80) alerts.push({ msg: `CPU hot: ${cpuTemp}°C`, color: '#f59e0b', effect: 'breathing', severity: 'warning' });
  if (ramPct >= 90) alerts.push({ msg: `RAM nearly full: ${ramPct}%`, color: '#f59e0b', effect: 'breathing', severity: 'warning' });

  // Recommended colour
  const recColor = tempToColor(maxTemp);
  const recLabel = maxTemp < 60 ? '🟢 System cool — green lighting recommended'
    : maxTemp < 75 ? '🟡 Moderate temps — yellow lighting recommended'
    : maxTemp < 85 ? '🔴 Running hot — red lighting recommended'
    : '🚨 Critical temps — flashing red recommended';

  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif", marginBottom: 12 }}>RGB Health Advisor</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: recColor, boxShadow: `0 0 10px ${recColor}`, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: '#ccc' }}>{recLabel}</span>
        <button onClick={() => onApplyAll?.(recColor)} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 7, border: `1px solid ${recColor}44`, background: hexWithAlpha(recColor, 0.12), color: recColor, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: "'Orbitron',sans-serif", whiteSpace: 'nowrap' }}>
          Apply to All
        </button>
      </div>
      {alerts.length === 0 ? (
        <div style={{ fontSize: 12, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>✓</span> All temps within safe range
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, background: hexWithAlpha(a.color, 0.08), border: `1px solid ${hexWithAlpha(a.color, 0.25)}` }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flexShrink: 0, animation: a.severity === 'critical' ? 'glow 0.5s infinite' : 'none' }} />
              <span style={{ fontSize: 12, color: a.color, flex: 1 }}>{a.msg}</span>
            </div>
          ))}
        </div>
      )}
      {/* Temp–colour legend */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {[['< 60°C','#22c55e','Cool'],['60–74°C','#f59e0b','Warm'],['75–84°C','#ef4444','Hot'],['≥ 85°C','#ff0000','Critical']].map(([range, color, label]) => (
          <div key={range} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, background: hexWithAlpha(color, 0.08), border: `1px solid ${hexWithAlpha(color, 0.2)}` }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
            <span style={{ fontSize: 10, color: '#666' }}>{range}</span>
            <span style={{ fontSize: 10, color: color }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function TelemetryPanel({ telemetry, onApplyAll }) {
  const [history, setHistory] = useState({ cpuUsage: [], cpuTemp: [], gpuUsage: [], gpuTemp: [], ram: [] });

  useEffect(() => {
    if (!telemetry) return;
    setHistory(h => ({
      cpuUsage: [...h.cpuUsage.slice(-59), telemetry.cpu?.usage || 0],
      cpuTemp:  [...h.cpuTemp.slice(-59),  telemetry.cpu?.temp  || 0],
      gpuUsage: [...h.gpuUsage.slice(-59), telemetry.gpu?.usage || 0],
      gpuTemp:  [...h.gpuTemp.slice(-59),  telemetry.gpu?.temp  || 0],
      ram:      [...h.ram.slice(-59),       telemetry.ram?.pct   || 0],
    }));
  }, [telemetry]);

  if (!isElectron) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: '#333', padding: 40 }}>
      <div style={{ fontSize: 64 }}>📊</div>
      <div style={{ fontSize: 18, color: '#444' }}>Real Telemetry — Electron Only</div>
      <div style={{ fontSize: 13, color: '#333', textAlign: 'center', maxWidth: 400, lineHeight: 1.8 }}>
        Live CPU, GPU, and RAM data is read via <code>systeminformation</code> in the Node.js process.<br/>
        Run <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4 }}>npm start</code> to launch the Electron desktop app.
      </div>
    </div>
  );

  if (!telemetry) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, animation: 'spin 1s linear infinite', display: 'inline-block', marginBottom: 12 }}>⟳</div>
        <div>Reading hardware sensors…</div>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>System Telemetry</div>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 22 }}>Live hardware data via systeminformation · Updates every 1.5s</div>

      {/* Arc gauges row */}
      <div style={{ display: 'flex', gap: 0, justifyContent: 'space-around', marginBottom: 24, padding: '16px', background: 'rgba(255,255,255,0.025)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
        <ArcGauge label="CPU Load"  value={telemetry.cpu?.usage || 0} unit="%" />
        <ArcGauge label="CPU Temp"  value={telemetry.cpu?.temp  || 0} unit="°C" max={100} color={tempToColor(telemetry.cpu?.temp || 0)} />
        <ArcGauge label="GPU Load"  value={telemetry.gpu?.usage || 0} unit="%" />
        <ArcGauge label="GPU Temp"  value={telemetry.gpu?.temp  || 0} unit="°C" max={100} color={tempToColor(telemetry.gpu?.temp || 0)} />
        <ArcGauge label="RAM"       value={telemetry.ram?.pct   || 0} unit="%" />
      </div>

      {/* Sparkline graphs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'CPU Usage %',  data: history.cpuUsage, color: usageToColor(telemetry.cpu?.usage || 0) },
          { label: 'CPU Temp °C',  data: history.cpuTemp,  color: tempToColor(telemetry.cpu?.temp  || 0), max: 100 },
          { label: 'GPU Usage %',  data: history.gpuUsage, color: usageToColor(telemetry.gpu?.usage || 0) },
          { label: 'GPU Temp °C',  data: history.gpuTemp,  color: tempToColor(telemetry.gpu?.temp  || 0), max: 100 },
        ].map(({ label, data, color, max }) => (
          <div key={label} style={{ background: 'rgba(255,255,255,0.025)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 10, color: '#555', letterSpacing: 1.5, fontFamily: "'Orbitron',sans-serif", marginBottom: 8 }}>{label}</div>
            <Sparkline data={data} color={color} max={max || 100} />
          </div>
        ))}
      </div>

      {/* Health bars */}
      <div style={{ background: 'rgba(255,255,255,0.025)', borderRadius: 12, padding: 16, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 16 }}>
        <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif", marginBottom: 12 }}>
          {telemetry.gpu?.name || 'GPU'} &amp; System
        </div>
        <HealthBar label="CPU Usage"      value={telemetry.cpu?.usage || 0} warn={70} crit={90} />
        <HealthBar label="CPU Temp"       value={telemetry.cpu?.temp  || 0} max={100} unit="°C" warn={70} crit={85} />
        <HealthBar label="GPU Usage"      value={telemetry.gpu?.usage || 0} warn={80} crit={95} />
        <HealthBar label="GPU Temp"       value={telemetry.gpu?.temp  || 0} max={100} unit="°C" warn={75} crit={85} />
        <HealthBar label="RAM"            value={telemetry.ram?.pct   || 0} warn={75} crit={90} />
        {telemetry.ram && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#555' }}>
            <span>RAM Used: {((telemetry.ram.used || 0) / 1024 / 1024 / 1024).toFixed(1)} GB / {((telemetry.ram.total || 0) / 1024 / 1024 / 1024).toFixed(1)} GB</span>
            {telemetry.gpu?.memTotal > 0 && (
              <span>VRAM: {telemetry.gpu.memUsed} MB / {telemetry.gpu.memTotal} MB</span>
            )}
          </div>
        )}
      </div>

      {/* RGB Health Advisor */}
      <RGBHealthAdvisor telemetry={telemetry} onApplyAll={onApplyAll} />
    </div>
  );
}
