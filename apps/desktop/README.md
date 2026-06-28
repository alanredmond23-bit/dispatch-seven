# D7 Desktop (Tauri)

Wraps the D7 React frontend in a native Mac/Windows/Linux window via [Tauri 1.6](https://tauri.app).

The web app is the UI — Tauri only provides the native shell. No Electron, no 150 MB Chromium embed.

## Prerequisites

- **Rust** ≥ 1.70 — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node** ≥ 18
- **macOS**: Xcode Command Line Tools — `xcode-select --install`
- **Linux**: `libwebkit2gtk-4.0-dev build-essential libssl-dev libgtk-3-dev`
- **Windows**: WebView2 (ships with Windows 11; installer at microsoft.com/edge/webview2)

## Dev

```bash
# From repo root — build the frontend first
cd frontend && npm install && npm run build && cd ..

# Then run the desktop wrapper in dev mode (points to Vite dev server)
cd apps/desktop
npm install
npm run dev          # opens a native window at http://localhost:5173
```

## Production Build

```bash
cd apps/desktop
npm run build
# Outputs to apps/desktop/src-tauri/target/release/bundle/
# macOS → .dmg + .app
# Windows → .msi + .exe
# Linux  → .deb + .AppImage
```

## Config

- `src-tauri/tauri.conf.json` — app name, bundle ID, window size, icon paths
- `src-tauri/Cargo.toml` — Rust dependencies
- In dev mode `devPath` → Vite dev server (`http://localhost:5173`)
- In production `distDir` → `../../frontend/dist` (pre-built Vite output)
