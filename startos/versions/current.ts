import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.5.4:0',
  releaseNotes: {
    en_US: 'Testing build with Blisspoint rename and CI fixes.',
  },
  migrations: {
    up: async ({ _effects }) => {},
    down: IMPOSSIBLE,
  },
})
