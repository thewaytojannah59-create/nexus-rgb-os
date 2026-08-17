# Nexus RGB OS v6.2.1

**Professional RGB lighting control software for Windows, built with Electron + React + Vite and powered by OpenRGB.**

Nexus RGB OS is a desktop application that connects your RGB hardware to a central control system. It can detect games and applications, read system telemetry, switch lighting profiles, control RGB zones, and generate lighting scenes with AI providers.

> **Current version:** `6.2.1`

## What is Nexus RGB OS?

Nexus is an RGB control layer designed to make PC lighting automatic instead of manual.

It combines:

- **OpenRGB** for hardware RGB control
- **Systeminformation** for CPU/GPU/system telemetry
- **Electron** for the Windows desktop application
- **React + Vite** for the UI
- **Electron Store** for persistent settings and profiles
- **AI integrations** for generated RGB scenes
- **Game/app detection** for automatic profile switching

The project also includes reliability and security systems such as IPC validation, rate limiting, hardware command queuing, crash recovery, device-disconnect handling, OpenRGB verification, and renderer health monitoring.

## Main Features

### 🎮 Automatic game profiles
Detect supported games and switch RGB profiles automatically. When the game closes, Nexus can restore the previous lighting state.

### 🖥️ Application-aware lighting
Application detection can assign different lighting profiles to apps such as Discord, Spotify, OBS, and Zoom.

### 🌡️ Adaptive telemetry
RGB can react to live system conditions such as CPU/GPU temperature, allowing lighting to change as system load changes.

### 🤖 AI scene generation
Describe a mood, scene, or lighting style and use the configured AI provider to generate an RGB setup.

### 🧊 Digital Twin
Provides a live 3D representation of the setup and allows zones to be selected directly from the visualization.

### 💾 Profiles
Save and restore complete lighting configurations for supported devices.

### 🛡️ Reliability and recovery
The application includes:

- Crash Recovery Engine
- IPC validation on renderer and main-process sides
- Per-channel hardware command queues
- Circuit-breaker protection
- Rate limiting
- Device disconnect handling
- Renderer freeze/health monitoring
- OpenRGB availability and capability checks
- Automatic cleanup of timers and IPC listeners

### 🔐 Security hardening
The Electron application uses security controls including context isolation, disabled renderer Node integration, sandboxing, restricted persistent-store access, sanitized process information, and controlled hardware commands.

## Requirements

### Development requirements

- Windows 10/11 64-bit is the primary target.
- Node.js and npm installed.
- Internet access is required when dependencies or the managed OpenRGB package need to be downloaded.
- A supported RGB device is required for real hardware control.

### Hardware/software

Nexus communicates with RGB hardware through **OpenRGB** using `openrgb-sdk`.

The v6.2.1 source contains an OpenRGB manager that is designed to manage the OpenRGB process automatically rather than requiring the user to manually launch the server in normal operation.

> **Important:** Browser development mode does not provide real hardware control. Use Electron development mode for the full desktop application.

## Installation

Open a terminal in the project root — the folder containing `package.json` — and run:

```bash
npm install
```

This installs the project dependencies.

## How to Run

### 1. Browser/UI preview

```bash
npm run dev
```

Vite starts the React frontend. This is useful for working on the interface and does **not** represent the complete Electron + hardware runtime.

### 2. Full Electron development mode

```bash
npm run electron:dev
```

This starts Vite and then launches Electron after the Vite server becomes available on port `5173`.

This is the main development command for testing the desktop application.

### 3. Run the built application locally

```bash
npm run electron
```

This first creates a Vite production build and then launches Electron against that build.

### 4. Build Windows installers

```bash
npm run dist
```

The Windows build targets **x64** and produces both an NSIS installer and a portable executable in the `release/` directory.

The portable artifact is named:

```text
NexusRGBOS-v6.2.1-portable.exe
```

## Build Targets

The package configuration also defines:

```bash
npm run dist:mac
npm run dist:linux
```

These create macOS DMG and Linux AppImage builds respectively, although Windows is the primary target configured for this release.

## Project Structure

```text
nexus-rgb-os/
├── electron/
│   ├── main.js                  # Electron main process, IPC, telemetry
│   ├── preload.js               # Secure renderer/main bridge
│   ├── openrgbManager.js        # OpenRGB lifecycle and verification
│   ├── systemGateway.js         # Command queue, circuit breaker, watchdog
│   ├── logger.js                # Persistent application logging
│   ├── autoLaunch.js            # Windows startup integration
│   └── gameDetector.js          # Game/process detection
│
├── nexus-rgb/                   # React + Vite renderer
│   ├── App.jsx                  # Main UI/root component
│   ├── hooks/                   # Core state, hardware and health systems
│   ├── components/              # UI panels and controls
│   └── ...
│
├── assets/                      # Application icons/assets
├── package.json                 # Dependencies, scripts and packaging config
└── README.md                    # Project documentation
```

## Architecture

```text
┌─────────────────────────────────────────┐
│              Nexus RGB UI               │
│             React + Vite                │
└───────────────────┬─────────────────────┘
                    │ IPC
                    ▼
┌─────────────────────────────────────────┐
│            Electron Main Process        │
│  Validation • Rate Limits • Gateway     │
│  Telemetry • Profiles • Game Detection  │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│              OpenRGB Manager             │
│        Start • Verify • Reconnect       │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│              RGB Hardware               │
│      LEDs • Fans • Strips • Devices     │
└─────────────────────────────────────────┘
```

## Technical Specifications

| Component | Version / Technology |
|---|---|
| Application | Nexus RGB OS 6.2.1 |
| Desktop shell | Electron 29.x |
| Frontend | React 18.x |
| Build tool | Vite 5.x |
| RGB interface | `openrgb-sdk` 0.6.x |
| System telemetry | `systeminformation` 5.22.x |
| Persistent storage | `electron-store` 8.1.x |
| Logging | `electron-log` 5.1.x |
| Windows startup | `auto-launch` 5.0.x |
| Packaging | `electron-builder` 24.13.x |
| Dev orchestration | `concurrently` 8.2.x |
| Dev server synchronization | `wait-on` 7.2.x |
| Primary platform | Windows x64 |
| Windows installer | NSIS |
| Windows portable build | Yes |
| macOS build target | DMG |
| Linux build target | AppImage |
| License | MIT |

The versions above are taken from the v6.2.1 `package.json`, not from older Nexus documentation.

## npm Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite frontend only |
| `npm run build` | Create the Vite production build |
| `npm run electron:dev` | Start Vite + Electron for development |
| `npm run electron` | Build the frontend and launch Electron |
| `npm run dist` | Build Windows x64 installer + portable package |
| `npm run dist:mac` | Build macOS DMG |
| `npm run dist:linux` | Build Linux AppImage |

## First-Time Run

```bash
# 1. Open the project directory
cd path\to\nexus-rgb-os

# 2. Install dependencies
npm install

# 3. Start the full desktop application
npm run electron:dev
```

For hardware testing, make sure your RGB devices are connected and recognized by OpenRGB.

## Troubleshooting

### `npm` is not recognized
Install Node.js, restart the terminal, and verify:

```bash
node -v
npm -v
```

### The browser preview works but RGB hardware does not
That is expected. `npm run dev` only starts the Vite renderer. Use:

```bash
npm run electron:dev
```

for the full Electron runtime.

### Electron does not start
Run the build separately first:

```bash
npm run build
```

If that succeeds, try:

```bash
npx electron .
```

### OpenRGB is unavailable
Check that the OpenRGB manager can download/start the expected OpenRGB build and that the RGB device is supported by OpenRGB.

### Build errors after changing dependencies
Delete `node_modules` and `package-lock.json`, then reinstall:

```bash
npm install
```

Do this only when a normal reinstall cannot resolve a dependency problem.

## Security Notes

Nexus v6.2.1 contains security hardening around the Electron IPC boundary and OpenRGB lifecycle. The main process validates IPC input before performing hardware operations, while the renderer uses a controlled gateway rather than exposing unrestricted Node.js access.

The OpenRGB manager also performs integrity and download-safety checks before installing a managed OpenRGB package.

## Development Notes

The project is a desktop application rather than a normal web-only RGB dashboard. The important runtime path is:

**React UI → IPC gateway → Electron main process → OpenRGB manager → RGB hardware**

That distinction matters when testing: a successful Vite build only proves that the frontend compiled; it does not prove that Electron, IPC, OpenRGB, or physical RGB hardware works correctly.

## License

MIT
