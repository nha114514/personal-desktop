import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { turnFailureDiagnostic } from '../src/turn-failure.ts'

/** One `turn/end` closer carrying the given reason on turn `turn`. */
function turnEnd(reason: TurnEndReason, turn = 1): SessionEvent<'turn/end'> {
  return { type: 'turn/end', seq: SessionSeq(2), time: 3, data: { turn, reason } }
}

const encoder = new TextEncoder()

describe('turnFailureDiagnostic', () => {
  it('renders the recorded error category, status, message, and turn', () => {
    expect(turnFailureDiagnostic(turnEnd({
      kind: 'error',
      error: { message: 'overloaded server', code: 'OVERLOADED', status: 529 },
    }, 3))).toBe('Subagent failure (stage: turn 3; category: OVERLOADED; status: 529; message: overloaded server)')
  })

  it('omits the status when the failure carries none', () => {
    expect(turnFailureDiagnostic(turnEnd({
      kind: 'error',
      error: { message: 'scheduler prepare failed', code: 'UNKNOWN' },
    }))).toBe('Subagent failure (stage: turn 1; category: UNKNOWN; message: scheduler prepare failed)')
  })

  it('contributes nothing for non-error turn endings and for a missing end', () => {
    const nonErrors: (TurnEndReason | undefined)[] = [
      undefined,
      { kind: 'completed' },
      { kind: 'aborted', reason: { kind: 'parent' } },
      { kind: 'blocked' },
      { kind: 'max-tokens' },
      { kind: 'interrupted' },
      { kind: 'forked' },
    ]
    for (const reason of nonErrors) {
      expect(turnFailureDiagnostic(reason === undefined ? undefined : turnEnd(reason))).toBeUndefined()
    }
  })

  it('flattens newlines so the diagnostic stays one line', () => {
    expect(turnFailureDiagnostic(turnEnd({
      kind: 'error',
      error: { message: 'line one\nline two\r\nline three', code: 'UNKNOWN' },
    }))).toBe('Subagent failure (stage: turn 1; category: UNKNOWN; message: line one line two line three)')
  })

  it('bounds the complete diagnostic at 4096 UTF-8 bytes and keeps the header', () => {
    const long = 'あ'.repeat(5000)
    const diagnostic = turnFailureDiagnostic(turnEnd({
      kind: 'error',
      error: { message: long, code: 'OVERLOADED', status: 529 },
    }))
    expect(diagnostic).toBeDefined()
    expect(encoder.encode(diagnostic!).length).toBeLessThanOrEqual(4096)
    expect(encoder.encode(diagnostic!).length).toBeGreaterThan(4000)
    expect(diagnostic!.startsWith('Subagent failure (stage: turn 1; category: OVERLOADED; status: 529; message: あ')).toBe(true)
    expect(diagnostic!.endsWith('…)')).toBe(true)
  })

  it('leaves an in-limit message untouched', () => {
    const exact = 'あ'.repeat(1300)
    const diagnostic = turnFailureDiagnostic(turnEnd({
      kind: 'error',
      error: { message: exact, code: 'OVERLOADED' },
    }))
    expect(diagnostic!.endsWith(`${exact})`)).toBe(true)
  })
})
