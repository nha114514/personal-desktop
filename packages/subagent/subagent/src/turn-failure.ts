/**
 * Rendering of a child turn's recorded structured failure into the
 * provider-authored diagnostic the subagent seam reports.
 *
 * A `turn/end` closer carrying `reason.kind === 'error'` is the only record of
 * why a model or transport call failed; neither a stop reason nor a closing
 * message can reconstruct it. This module turns that record into one bounded
 * line so one-shot results, continuable settlement notices, and the lifecycle
 * terminal edge can all report the same facts.
 *
 * @module @deepseek-ai/dsh-subagent/turn-failure
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Bound shared with {@link SubagentResult.diagnostic}, in UTF-8 bytes. */
const DIAGNOSTIC_MAX_BYTES = 4096

const encoder = new TextEncoder()

/**
 * Render the structured failure recorded by one `turn/end` event.
 *
 * Non-error endings and a missing closer contribute nothing: a clean ending has
 * no failure to describe. The rendered line carries the turn, the provider's
 * machine-routing code, its HTTP status when present, and the flattened
 * message, bounded to {@link DIAGNOSTIC_MAX_BYTES} with the header retained.
 * @param event - the epoch's `turn/end` closer, or `undefined` when the epoch recorded none.
 * @returns one-line failure diagnostic, or `undefined` when the ending recorded no failure.
 */
export function turnFailureDiagnostic(event: SessionEvent<'turn/end'> | undefined): string | undefined {
  if (event === undefined) return undefined
  const { turn, reason } = event.data
  if (reason.kind !== 'error') return undefined
  const { message, code, status } = reason.error
  const header = `Subagent failure (stage: turn ${turn}; category: ${code};`
    + (status === undefined ? '' : ` status: ${status};`)
    + ' message: '
  // A model failure message may embed provider JSON with newlines; the notice
  // and tool result that carry this diagnostic are single-line text.
  const flat = message.replace(/\s+/g, ' ').trim()
  const complete = `${header}${flat})`
  if (encoder.encode(complete).length <= DIAGNOSTIC_MAX_BYTES) return complete
  const available = DIAGNOSTIC_MAX_BYTES - encoder.encode(`${header}…)`).length
  let used = 0
  let truncated = ''
  for (const character of flat) {
    const size = encoder.encode(character).length
    if (used + size > available) break
    used += size
    truncated += character
  }
  return `${header}${truncated}…)`
}
