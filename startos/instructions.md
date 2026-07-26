# Blisspoint

Run your ASIC miner as a space heater — simple enough for anyone in the house.

## Getting started

1. Open **Blisspoint** from your StartOS services and launch the Web UI (LAN),
   preferably on a phone or tablet on the same network as your miner.
2. Open the miner menu at the bottom and tap **Scan LAN** to find miners
   automatically — or add a miner's IP address manually in Settings.
3. Tap a miner to see live hashrate, power draw, chip temperature and fan speed.

## Controlling the heat

- Drag the **power slider** and release to set the miner's power target — more
  power, more heat.
- The slider's maximum is captured from the miner's own power target the first
  time it connects, and locked: nobody can push the machine harder than it was
  set up for. To change the ceiling, adjust the target in the miner's own
  interface, then remove and re-add the miner here.
- Use **Pause/Resume** to stop and start mining with one tap. Some firmwares
  ask for the miner's password (username `root`) the first time; it is stored
  only in your browser.

## Supported miners

Miner communication is handled by the 256 Foundation's open
[asic-rs](https://github.com/256foundation/asic-rs) library. Monitoring works
across Antminer (stock), Whatsminer, Avalon, BraiinsOS+, LuxOS, Vnish, ePIC,
Marathon, Bitaxe and more, with power control wherever the firmware exposes it.

**Network:** the StartOS node must be on the same LAN as your miners.
