# Blisspoint - StartOS package (s9pk)

Scaffold to package Blisspoint for **StartOS 0.4.0.x**.

## Layout
- `../Dockerfile` - build (Vite -> dist) + runtime (proxy :8081 + UI/`/api` :80).
- `../server/serve.cjs` - production server: serves `dist/` and reverse-proxies `/api/*` -> `127.0.0.1:8081`.
- `manifest.yaml` - package manifest **(TEMPLATE - verify against the 0.4.0.x SDK schema)**.
- `icon.png` - app icon.
- `instructions.md` - post-install instructions.

## Build & publish (from repo root)
    start-cli s9pk pack . -o blisspoint.s9pk --icon startos/icon.png
    start-cli s9pk inspect manifest blisspoint.s9pk
    start-cli s9pk publish blisspoint.s9pk

(or `make pack` / `make publish`)

## Verify on your node
1. Confirm the manifest format: `start-cli s9pk pack --help` (0.4.0.x differs from 0.3.x).
2. Build the image; confirm the container can reach miners on the LAN (port 4028) - StartOS network policy may need to allow LAN access.
3. Install the .s9pk and open the Web UI.

Docs: https://docs.start9.com/start-os/0.4.0.x/cli-reference.html
