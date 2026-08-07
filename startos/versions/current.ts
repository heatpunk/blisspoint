import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.6.0:0',
  releaseNotes: {
    en_US: 'Fix LAN scanning in StartOS/Umbrel Docker containers.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
