import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v0_5_0 = VersionInfo.of({
  version: '0.5.0:0',
  releaseNotes: {
    en_US:
      'Blisspoint now installs on Umbrel (community app store) and Home Assistant (add-on repository), alongside StartOS. No changes to the app itself.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
