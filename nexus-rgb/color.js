export const hslToHex = (h, s, l) => {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); return Math.round(255 * c).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
};
export const hexToRgb = hex => { const c = hex.replace('#', ''); return { r: parseInt(c.slice(0,2),16), g: parseInt(c.slice(2,4),16), b: parseInt(c.slice(4,6),16) }; };
export const rgbToHex = (r,g,b) => '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
export const lerp = (a,b,t) => a + (b-a)*t;
export const hexWithAlpha = (hex, a) => { try { const {r,g,b} = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; } catch { return `rgba(255,107,53,${a})`; } };
export const tempToColor = t => t < 60 ? '#22c55e' : t < 75 ? '#f59e0b' : t < 85 ? '#ef4444' : '#ff0000';
export const usageToColor = p => p < 50 ? '#22c55e' : p < 80 ? '#f59e0b' : '#ef4444';
export const isValidHex = h => /^#[0-9A-Fa-f]{6}$/.test(h);
