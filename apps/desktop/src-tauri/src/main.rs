// Dispatch Seven — Tauri desktop wrapper
// The web app (Vite + React) IS the UI; this binary just hosts the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running Dispatch Seven");
}
