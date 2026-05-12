#!/usr/bin/env node
// Wrapper for Tauri's `beforeDevCommand` that lets `pnpm tauri dev` and
// `pnpm tauri android dev` (or any combination of platforms) run
// simultaneously against a single shared Vite dev server on port 1420.
//
// Default behavior: spawn `vite` as a child, inherit its stdio, forward
// signals so Ctrl+C / Tauri-managed shutdown still works. If port 1420
// is already in use (another tauri-dev terminal already started Vite),
// log a one-line note and exit successfully — Tauri only needs the
// devUrl to be reachable, and the existing Vite server is already
// serving it.
//
// Why we need this:
//   `pnpm dev` (= `vite`) hardcodes port 1420 with strictPort:true. A
//   second invocation crashes with EADDRINUSE, which makes Tauri abort.
//   On a single-machine workflow you only need one Vite serving both
//   the desktop window and the Android emulator/device.

import net from "node:net";
import { spawn } from "node:child_process";

const PORT = 1420;

const probe = net.createServer();

probe.once("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.log(
      `[leaflet-dev] Vite already listening on :${PORT} — reusing existing dev server.`,
    );
    // Tauri proceeds as soon as this command exits cleanly; the
    // devUrl is already reachable through the other process.
    process.exit(0);
  }
  console.error("[leaflet-dev] port probe failed:", err);
  process.exit(1);
});

probe.once("listening", () => {
  probe.close(() => {
    // Port is free — hand off to Vite. Spawn rather than exec so we
    // can forward signals; on Windows pnpm is a .cmd shim which
    // needs shell=true to launch.
    const child = spawn("pnpm", ["exec", "vite"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(sig, () => {
        try {
          child.kill(sig);
        } catch {
          // child already exited
        }
      });
    }
  });
});

probe.listen(PORT);
