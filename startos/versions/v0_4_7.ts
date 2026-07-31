import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v0_4_7 = VersionInfo.of({
  version: '0.4.7:0',
  releaseNotes: {
    en_US:
      'Glass redesign: the play/pause and settings buttons are now clear glass that lets the background show through, with the icons frosted into the glass, in both light and dark themes. New subtle themed backgrounds — pearl marble in light mode and near-black leather in dark mode. The settings icon is now a proper filled cog. The power slider’s minimum is the miner’s real minimum power target (read from BraiinsOS+ when exposed, otherwise one third of the maximum) instead of zero. Live readouts at the top now refresh more frequently.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
