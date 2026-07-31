import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v0_4_2 = VersionInfo.of({
  version: '0.4.2:0',
  releaseNotes: {
    en_US:
      'Visual update: the power slider is reborn as a glass capsule, and the app ships a complete new icon set — home-screen/app icon, browser favicon and a proper app name. Everything from 0.4.1 is unchanged: the slider still sets the miner’s whole-machine power target via the open asic-rs library (Antminer/stock, Whatsminer, Avalon, BraiinsOS, LuxOS, Vnish, ePIC, Marathon, Bitaxe and more), with the first-connect ceiling captured as a locked maximum.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
