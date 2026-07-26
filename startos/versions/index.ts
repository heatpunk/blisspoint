import { VersionGraph } from '@start9labs/start-sdk'
import { current } from './current'
import { v0_5_2 } from './v0_5_2'
import { v0_5_0 } from './v0_5_0'
import { v0_4_7 } from './v0_4_7'
import { v0_4_2 } from './v0_4_2'

export const versionGraph = VersionGraph.of({
  current,
  other: [v0_5_2, v0_5_0, v0_4_7, v0_4_2],
})
