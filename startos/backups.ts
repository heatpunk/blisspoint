import { sdk } from './sdk'

export const { createBackup, restoreInit } = sdk.setupBackups(
  async ({ _effects }) => sdk.Backups.ofVolumes('main'),
)
