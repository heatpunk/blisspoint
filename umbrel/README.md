# Umbrel packaging

This directory contains the Umbrel app definition for Blisspoint.

## Test it on an Umbrel device (community app store)

The quickest way to run Blisspoint on Umbrel today is via a community app store
containing the `blisspoint/` directory from here. On your Umbrel:
**App Store → ⋯ → Community App Stores → add the store URL → install Blisspoint.**

## Submit to the official Umbrel App Store

1. Fork [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps).
2. Copy `umbrel/blisspoint/` into the fork's root as `blisspoint/`.
3. Pin the image by digest in `docker-compose.yml` (required by Umbrel):
   ```bash
   docker buildx imagetools inspect ghcr.io/heatpunk/blisspoint:0.5.3
   # then: image: ghcr.io/heatpunk/blisspoint:0.5.3@sha256:<digest>
   ```
4. Add 3–5 gallery screenshots (1600×1000 PNG) and list them in `umbrel-app.yml`.
5. Open a PR against `getumbrel/umbrel-apps` following their template.

## Notes

- The container needs to reach miners on the LAN. Umbrel's default bridge
  networking allows outbound LAN connections, so no `network_mode: host` is
  required.
- `port: 3847` is the host port Umbrel exposes the UI on; the container
  serves on 80 behind Umbrel's `app_proxy`.
- When bumping the app: update `version` and `releaseNotes` in
  `umbrel-app.yml` and the image tag/digest in `docker-compose.yml`.
