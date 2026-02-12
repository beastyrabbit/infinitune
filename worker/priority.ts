/**
 * Priority system: lower number = higher priority.
 *
 * 0            — oneshot songs (user is waiting for one song)
 * 1            — interrupt/quick request songs
 * 100+N        — current-epoch normal songs by distance from playback position
 * 5000*age+N   — old-epoch songs (epochAge = currentEpoch - songEpoch)
 * 10000+       — songs from closing/stale playlists
 */

const ONESHOT_PRIORITY = 0
const INTERRUPT_PRIORITY = 1
const NORMAL_BASE = 100
const EPOCH_AGE_OFFSET = 5000
const CLOSING_OFFSET = 10000

export function calculatePriority(options: {
  isOneshot: boolean
  isInterrupt: boolean
  orderIndex: number
  currentOrderIndex: number
  isClosing: boolean
  currentEpoch: number
  songEpoch: number
}): number {
  const { isOneshot, isInterrupt, orderIndex, currentOrderIndex, isClosing, currentEpoch, songEpoch } = options

  let priority: number

  if (isOneshot) {
    priority = ONESHOT_PRIORITY
  } else if (isInterrupt) {
    priority = INTERRUPT_PRIORITY
  } else {
    priority = NORMAL_BASE + Math.max(0, orderIndex - currentOrderIndex)
  }

  const epochAge = Math.max(0, currentEpoch - songEpoch)
  if (epochAge > 0) {
    priority += EPOCH_AGE_OFFSET * epochAge
  }

  if (isClosing) {
    priority += CLOSING_OFFSET
  }

  return priority
}
