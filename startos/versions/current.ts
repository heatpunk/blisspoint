import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.5.9:0',
  releaseNotes: {
    en_US: 'Fix CI linting and TypeScript types for multi-subnet LAN scan.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
