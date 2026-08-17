$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$main = Join-Path $root 'electron\main.js'
$gd = Join-Path $root 'electron\gameDetector.js'
$pre = Join-Path $root 'electron\preload.js'
foreach($f in @($main,$gd,$pre)){ if(!(Test-Path $f)){ throw "Missing $f. Run this from nexus621 root." } }

Copy-Item $main "$main.bak-before-hackathon-fix" -Force
Copy-Item $gd "$gd.bak-before-hackathon-fix" -Force
Copy-Item $pre "$pre.bak-before-hackathon-fix" -Force

# 1) Telemetry: never overlap expensive systeminformation calls; adapt interval under CPU load.
$s = Get-Content $main -Raw
$old = @'
function startTelemetry(win, intervalMs = 1500) {
  stopTelemetry();

  const interval = Math.max(
    1000,
    Math.min(10000, Number(intervalMs) || 1500)
  );

  // Immediate first reading.
  readTelemetry(win);

  telemetryInterval = setInterval(() => {
    readTelemetry(win);
  }, interval);
}

function stopTelemetry() {
  if (telemetryInterval) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }
}
'@
$new = @'
function startTelemetry(win, intervalMs = 1500) {
  stopTelemetry();

  const baseMs = Math.max(
    1000,
    Math.min(10000, Number(intervalMs) || 1500)
  );

  let running = true;
  let polling = false;

  _stopTelemetry = () => {
    running = false;
  };

  const poll = async () => {
    if (!running || polling) return;
    polling = true;
    try {
      await readTelemetry(win);
    } finally {
      polling = false;
    }

    if (running) {
      const nextMs = getAdaptiveInterval(baseMs);
      telemetryInterval = setTimeout(poll, nextMs);
    }
  };

  poll();
}

function stopTelemetry() {
  if (_stopTelemetry) {
    _stopTelemetry();
    _stopTelemetry = null;
  }

  if (telemetryInterval) {
    clearTimeout(telemetryInterval);
    telemetryInterval = null;
  }

  lastCpuLoad = 0;
}
'@
if($s.Contains($old)){ $s=$s.Replace($old,$new) } else { throw 'Telemetry block not found; refusing unsafe edit.' }

# 2) DevTools only when explicitly requested. Prevent detached DevTools from shipping/running by accident.
$s = $s.Replace("    win.webContents.openDevTools({ mode: 'detach' });", "    if (process.env.NEXUS_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });")
Set-Content $main $s -Encoding UTF8

# 3) Game detector: prevent overlapping scans and reduce polling pressure.
$s = Get-Content $gd -Raw
$s = $s.Replace('const POLL_INTERVAL_MS = 3000;', 'const POLL_INTERVAL_MS = 8000;')
$s = $s.Replace("    this.onStopped = null;\n  }", "    this.onStopped = null;\n    this.scanning = false;\n  }")
$s = $s.Replace("  async scan() {\n    let names;", "  async scan() {\n    if (this.scanning) return { ok: true, skipped: true };\n    this.scanning = true;\n    let names;")
$s = $s.Replace("    } catch (err) {\n      return { ok: false, error: `Process scan failed: ${String(err?.message || err).slice(0, 160)}` };\n    }\n\n    const active", "    } catch (err) {\n      this.scanning = false;\n      return { ok: false, error: `Process scan failed: ${String(err?.message || err).slice(0, 160)}` };\n    }\n\n    const active")
$s = $s.Replace("    this.onUpdate?.(active);\n    return { ok: true, games: active };", "    this.onUpdate?.(active);\n    this.scanning = false;\n    return { ok: true, games: active };")
Set-Content $gd $s -Encoding UTF8

# 4) Expose the IPC route that already exists in IPCGateway.
$s = Get-Content $pre -Raw
$s = $s.Replace("    setColor:   (id, r, g, b)  => ipcRenderer.invoke('rgb:setColor', id, r, g, b),", "    setColor:   (id, r, g, b)  => ipcRenderer.invoke('rgb:setColor', id, r, g, b),\n    setAllColor: (r, g, b)       => ipcRenderer.invoke('rgb:setAllColor', r, g, b),")
Set-Content $pre $s -Encoding UTF8

Write-Host ''
Write-Host 'NEXUS HACKATHON STABILITY PATCH APPLIED.' -ForegroundColor Green
Write-Host 'Backups created: *.bak-before-hackathon-fix'
Write-Host 'Telemetry: adaptive + non-overlapping'
Write-Host 'Game detection: 8s polling + overlap guard'
Write-Host 'DevTools: disabled unless NEXUS_DEVTOOLS=1'
Write-Host 'IPC: rgb.setAllColor exposed'
Write-Host ''
Write-Host 'NEXT: npm run build' -ForegroundColor Cyan
