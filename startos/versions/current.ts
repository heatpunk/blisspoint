import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.5.7:0',
  releaseNotes: {
    en_US: 'Auto-detect local network subnet, encrypt state passwords with AES-256-GCM, and update StartOS package metadata.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
