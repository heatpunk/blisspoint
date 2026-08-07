import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '0.5.8:0',
  releaseNotes: {
    en_US: 'Fix LAN scanning in StartOS/Umbrel Docker containers by filtering bridge subnets and scanning 192.168.1/192.168.0/10.0.0 ranges.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
