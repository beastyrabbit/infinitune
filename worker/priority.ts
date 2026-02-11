/**
 * Priority system: lower number = higher priority.
 *
 * 0       — oneshot songs (user is waiting for one song)
 * 1       — interrupt/quick request songs
 * 100+N   — normal songs by distance from playback position
 * 10000+  — songs from closing/stale playlists
 */

const ONESHOT_PRIORITY = 0
const INTERRUPT_PRIORITY = 1
const NORMAL_BASE = 100
const CLOSING_OFFSET = 10000

export function calculatePriority(options: {
  isOneshot: boolean
  isInterrupt: boolean
  orderIndex: number
  currentOrderIndex: number
  isClosing: boolean
}): number {
  const { isOneshot, isInterrupt, orderIndex, currentOrderIndex, isClosing } = options

  let priority: number

  if (isOneshot) {
    priority = ONESHOT_PRIORITY
  } else if (isInterrupt) {
    priority = INTERRUPT_PRIORITY
  } else {
    priority = NORMAL_BASE + Math.max(0, orderIndex - currentOrderIndex)
  }

  if (isClosing) {
    priority += CLOSING_OFFSET
  }

  return priority
}
