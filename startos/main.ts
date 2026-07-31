import { i18n } from './i18n'
import { sdk } from './sdk'
import { uiPort } from './utils'

export const main = sdk.setupMain(async ({ _effects }) => {
  console.info(i18n('Starting Blisspoint'))

  return sdk.Daemons.of(_effects).addDaemon('primary', {
    subcontainer: await sdk.SubContainer.of(
      _effects,
      { imageId: 'blisspoint' },
      sdk.Mounts.of().mountVolume({
        volumeId: 'main',
        subpath: null,
        mountpoint: '/data',
        readonly: false,
      }),
      'blisspoint-sub',
    ),
    exec: {
      command: ['sh', '-c', 'proxy-rs & node server/serve.cjs'],
    },
    ready: {
      display: i18n('Web Interface'),
      fn: () =>
        sdk.healthCheck.checkPortListening(_effects, uiPort, {
          successMessage: i18n('The web interface is ready'),
          errorMessage: i18n('The web interface is not ready'),
        }),
    },
    requires: [],
  })
})
