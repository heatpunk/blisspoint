# Blisspoint

A dead-simple UI for running a Bitcoin ASIC miner as a space heater.

## Which Home Assistant installs does this work on?

Add-ons are a feature of **Home Assistant OS** and **Home Assistant
Supervised** only. If your Home Assistant runs as a container — for example
**on StartOS**, on Umbrel, or in plain Docker — there is no add-on store and
this add-on cannot be installed.

**Running Home Assistant on StartOS (or any container-based install)?**
Install the native **Blisspoint app on your StartOS server**, then use the
**HACS integration** (see below) to pull live miner data into Home Assistant
as proper sensors. You get full automations, dashboards, and history — no
add-on needed.

## Installation (Home Assistant OS / Supervised)

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Open the **⋮ menu → Repositories** and add:
   `https://github.com/heatpunk/blisspoint`
3. Install **Blisspoint** from the list and start it.
4. Open the Web UI (port `8099` by default), then tap **Scan LAN** in the
   menu — or add your miner's IP manually in Settings.

## Installation via HACS (StartOS / Docker / any HA install)

HACS lets any Home Assistant install pull live miner data from a running
Blisspoint instance — no add-on store required.

**Prerequisites:** Blisspoint is already running somewhere on your LAN (e.g.,
the native StartOS app, or any Docker host).

1. Install [HACS](https://hacs.xyz) in Home Assistant if you haven't already.
2. In HACS → Integrations, open the **⋮ menu → Custom repositories**, add
   `https://github.com/heatpunk/blisspoint` and choose category
   **Integration**.
3. Search for **Blisspoint** in HACS and install it. Restart Home Assistant.
4. Go to **Settings → Devices & Services → Add Integration**, search for
   **Blisspoint**, and enter:
   - **Blisspoint URL** — the address of your Blisspoint server, e.g.
     `http://192.168.1.100:8099`
   - **Miner IP** — the LAN IP of your ASIC miner
5. Home Assistant now has four sensors per miner: hashrate (TH/s), power (W),
   chip temperature (°C), and fan speed (%).

## How it works

One slider sets the miner's power (and heat). The maximum is captured from
the miner's own power target on first connect and locked — nobody can push
the machine harder than it was set up for. Pause/resume with one tap and
watch live hashrate, wattage, chip temperature and fan speed.

Miner communication is handled by the 256 Foundation's open
[asic-rs](https://github.com/256foundation/asic-rs) library: monitoring works
across Antminer (stock), Whatsminer, Avalon, BraiinsOS+, LuxOS, Vnish, ePIC,
Marathon, Bitaxe and more, with power control wherever the firmware exposes it.

## Requirements

- The add-on must be able to reach your miner on the local network.
- x86-64 (amd64) Home Assistant installations only, for now.

## Support

Issues and questions: https://github.com/heatpunk/blisspoint/issues
