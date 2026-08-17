// ============================================================
// Nexus RGB OS — Digital Twin
// Interactive visual representation of the user's PC.
// Click any component to select & edit it.
// ============================================================
import { useState } from 'react';
import { hexWithAlpha } from './color';

// Each part describes a visual block in the case layout
const PARTS = [
  // id, label, x%, y%, w%, h%, deviceType to match
  { id: 'gpu',      label: 'GPU',          x:10, y:38, w:80, h:14, type:'gpu',      icon:'▣', desc:'Graphics Card' },
  { id: 'ram_l',    label: 'RAM A',        x:62, y:10, w:8,  h:22, type:'ram',      icon:'▤', desc:'DIMM Slot A' },
  { id: 'ram_r',    label: 'RAM B',        x:72, y:10, w:8,  h:22, type:'ram',      icon:'▤', desc:'DIMM Slot B' },
  { id: 'cpu',      label: 'CPU',          x:35, y:10, w:18, h:18, type:'cpu',      icon:'◫', desc:'Processor' },
  { id: 'fan_top1', label: 'Fan Top 1',    x:10, y:4,  w:14, h:14, type:'fan',      icon:'⬡', desc:'120mm top fan' },
  { id: 'fan_top2', label: 'Fan Top 2',    x:26, y:4,  w:14, h:14, type:'fan',      icon:'⬡', desc:'120mm top fan' },
  { id: 'fan_front1',label:'Fan Front 1', x:4,  y:25, w:10, h:20, type:'fan',      icon:'⬡', desc:'140mm front fan' },
  { id: 'fan_front2',label:'Fan Front 2', x:4,  y:48, w:10, h:20, type:'fan',      icon:'⬡', desc:'140mm front fan' },
  { id: 'strip',    label: 'LED Strip',   x:88, y:10, w:4,  h:75, type:'strip',    icon:'▬', desc:'ARGB strip' },
  { id: 'psu',      label: 'PSU',         x:10, y:78, w:80, h:14, type:'psu',      icon:'⚡', desc:'Power Supply' },
  { id: 'mobo',     label: 'Motherboard', x:10, y:10, w:78, h:85, type:'mobo',     icon:'◻', desc:'Motherboard',  isBg: true },
];

const TYPE_COLORS = {
  gpu:   '#ef4444', ram:   '#3b82f6', cpu:   '#f59e0b',
  fan:   '#00e5ff', strip: '#f97316', psu:   '#555555',
  mobo:  '#1a1a2e',
};

// Animated fan blades drawn in SVG
function FanSVG({ color, size = 40, rpm = 1 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="19" fill="#0a0a14" stroke={color} strokeWidth="1.5" opacity="0.5"/>
      {[0,1,2,3,4,5,6].map(i => {
        const a = (i / 7) * 360;
        const rad = (a * Math.PI) / 180;
        const x1 = 20 + Math.cos(rad) * 4;
        const y1 = 20 + Math.sin(rad) * 4;
        const x2 = 20 + Math.cos(rad) * 16;
        const y2 = 20 + Math.sin(rad) * 16;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.8"/>;
      })}
      <circle cx="20" cy="20" r="4" fill="#111" stroke="#333" strokeWidth="1"/>
      <circle cx="20" cy="20" r="2" fill="#444"/>
    </svg>
  );
}

// RAM stick visual
function RAMStick({ color }) {
  const lights = 6;
  return (
    <div style={{ width: '100%', height: '100%', background: '#0d0d1a', borderRadius: 3, border: `1px solid ${color}44`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 2px' }}>
      {Array.from({ length: lights }).map((_, i) => (
        <div key={i} style={{ width: '70%', height: 4, borderRadius: 2, background: color, boxShadow: `0 0 6px ${color}`, opacity: 0.7 + (i % 2) * 0.3 }} />
      ))}
    </div>
  );
}

export default function DigitalTwin({ devices = [], onSelectDevice, selectedDeviceId, devColors = {} }) {
  const [hovered, setHovered] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  // Map devices to part types
  const devicesByType = {};
  devices.forEach(d => {
    const t = d.type;
    if (!devicesByType[t]) devicesByType[t] = [];
    devicesByType[t].push(d);
  });

  const getPartColor = (part) => {
    if (part.isBg) return TYPE_COLORS.mobo;
    const devs = devicesByType[part.type] || [];
    if (devs.length > 0) {
      // Find color from devColors or device default
      const dev = devs[0];
      return devColors[dev.id] || '#ff6b35';
    }
    return TYPE_COLORS[part.type] || '#333';
  };

  const getPartDevice = (part) => {
    const devs = devicesByType[part.type] || [];
    return devs[0] || null;
  };

  const handleClick = (part) => {
    const dev = getPartDevice(part);
    if (dev) onSelectDevice?.(dev.id);
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
      <div style={{ padding: '16px 24px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>Digital Twin</div>
        <div style={{ fontSize: 12, color: '#555' }}>Click any component to configure its RGB lighting</div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', gap: 0 }}>

        {/* PC case visual */}
        <div style={{ flex: 1, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {/* Case outer shell */}
          <div style={{
            position: 'relative',
            width: 340, height: 440,
            background: 'linear-gradient(135deg,#111118,#0a0a12)',
            border: '2px solid #1e1e3a',
            borderRadius: 16,
            boxShadow: '0 0 40px rgba(0,0,0,0.8), inset 0 0 20px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}>
            {/* Glass panel tint */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(255,255,255,0.02),transparent)', pointerEvents: 'none', zIndex: 10 }} />

            {/* Parts */}
            {PARTS.map(part => {
              const color = getPartColor(part);
              const dev = getPartDevice(part);
              const isSelected = dev && selectedDeviceId === dev.id;
              const isHovered = hovered === part.id;
              const hasDev = !!dev;

              if (part.isBg) return (
                <div key={part.id} style={{
                  position: 'absolute',
                  left: `${part.x}%`, top: `${part.y}%`,
                  width: `${part.w}%`, height: `${part.h}%`,
                  background: 'linear-gradient(135deg,#0e0e1c,#0a0a14)',
                  border: '1px solid #1a1a30',
                  borderRadius: 6,
                  zIndex: 0,
                }} />
              );

              return (
                <div
                  key={part.id}
                  onClick={() => handleClick(part)}
                  onMouseEnter={() => { setHovered(part.id); setTooltip(part); }}
                  onMouseLeave={() => { setHovered(null); setTooltip(null); }}
                  style={{
                    position: 'absolute',
                    left: `${part.x}%`, top: `${part.y}%`,
                    width: `${part.w}%`, height: `${part.h}%`,
                    background: isSelected
                      ? hexWithAlpha(color, 0.25)
                      : isHovered && hasDev
                        ? hexWithAlpha(color, 0.15)
                        : hexWithAlpha(color, 0.06),
                    border: isSelected
                      ? `1.5px solid ${color}`
                      : isHovered && hasDev
                        ? `1px solid ${hexWithAlpha(color, 0.6)}`
                        : `1px solid ${hexWithAlpha(color, 0.2)}`,
                    borderRadius: 5,
                    zIndex: isSelected ? 5 : 1,
                    cursor: hasDev ? 'pointer' : 'default',
                    transition: 'all 0.15s',
                    boxShadow: isSelected ? `0 0 16px ${hexWithAlpha(color, 0.4)}` : isHovered && hasDev ? `0 0 8px ${hexWithAlpha(color, 0.25)}` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {/* Part content */}
                  {part.type === 'fan' && hasDev && (
                    <div style={{ opacity: 0.7 }}>
                      <FanSVG color={color} size={Math.min(parseInt(part.w) * 2.5, 36)} />
                    </div>
                  )}
                  {part.type === 'ram' && hasDev && (
                    <RAMStick color={color} />
                  )}
                  {part.type === 'strip' && hasDev && (
                    <div style={{ width: '100%', height: '100%', background: `linear-gradient(180deg,${color},${color}88,${color})`, opacity: 0.6, borderRadius: 2 }} />
                  )}
                  {part.type === 'gpu' && (
                    <div style={{ fontSize: 9, color: hexWithAlpha(color, 0.8), letterSpacing: 1, fontFamily: "'Orbitron',sans-serif", textAlign: 'center' }}>
                      {hasDev ? dev.name.split(' ').slice(0,3).join(' ') : 'GPU'}
                    </div>
                  )}
                  {/* Glow dot for selected */}
                  {isSelected && (
                    <div style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
                  )}
                  {/* Label on hover */}
                  {isHovered && !['fan','ram','strip'].includes(part.type) && (
                    <div style={{ fontSize: 8, color: hexWithAlpha(color, 0.9), fontFamily: "'Orbitron',sans-serif", letterSpacing: 0.5, textAlign: 'center', padding: '0 4px' }}>
                      {part.label}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Ambient glow from active devices */}
            {Object.values(devColors).slice(0, 3).map((color, i) => (
              <div key={i} style={{
                position: 'absolute',
                width: 120, height: 120,
                borderRadius: '50%',
                background: `radial-gradient(circle,${hexWithAlpha(color, 0.12)},transparent)`,
                left: `${15 + i * 25}%`, top: `${20 + i * 15}%`,
                pointerEvents: 'none',
                zIndex: 0,
              }} />
            ))}
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div style={{
              position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
              padding: '8px 16px', borderRadius: 8,
              background: 'rgba(10,10,20,0.95)', border: '1px solid rgba(255,255,255,0.1)',
              fontSize: 12, color: '#ccc', backdropFilter: 'blur(10px)',
              whiteSpace: 'nowrap', zIndex: 20,
            }}>
              <span style={{ fontWeight: 700 }}>{tooltip.label}</span>
              <span style={{ color: '#555', marginLeft: 8 }}>{tooltip.desc}</span>
              {getPartDevice(tooltip)
                ? <span style={{ color: '#00e5ff', marginLeft: 8 }}>● {getPartDevice(tooltip).name}</span>
                : <span style={{ color: '#444', marginLeft: 8 }}>No device mapped</span>}
            </div>
          )}
        </div>

        {/* Right panel — peripherals */}
        <div style={{ width: 220, borderLeft: '1px solid rgba(255,255,255,0.06)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
          <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif", marginBottom: 4 }}>Peripherals</div>
          {['keyboard','mouse','headset','mousepad','monitor','speaker'].map(type => {
            const devs = devicesByType[type] || [];
            return (
              <div key={type}>
                {devs.map(dev => {
                  const color = devColors[dev.id] || '#ff6b35';
                  const isSelected = selectedDeviceId === dev.id;
                  return (
                    <div key={dev.id} onClick={() => onSelectDevice?.(dev.id)}
                      style={{
                        padding: '10px 12px', borderRadius: 9, cursor: 'pointer', marginBottom: 6,
                        background: isSelected ? hexWithAlpha(color, 0.12) : 'rgba(255,255,255,0.025)',
                        border: isSelected ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.06)',
                        transition: 'all 0.15s',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#ccc' }}>{dev.name.split(' ').slice(0,3).join(' ')}</div>
                          <div style={{ fontSize: 9, color: '#555' }}>{dev.vendor || dev.brand}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {devs.length === 0 && (
                  <div style={{ padding: '8px 12px', borderRadius: 8, border: '1px dashed rgba(255,255,255,0.05)', marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#333' }}>{type.charAt(0).toUpperCase() + type.slice(1)}</div>
                    <div style={{ fontSize: 9, color: '#252525' }}>Not detected</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
