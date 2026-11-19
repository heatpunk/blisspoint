import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.6.4:0',
  releaseNotes: {
    en_US: 'Power targets now show exact watts on small machines like Bitaxe (under 500 W); big ASICs keep the familiar 50 W steps.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
