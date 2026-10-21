import { describe, expect, it } from 'vitest'
import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createSettlementMessage } from '../src/continuation-messages.ts'

const childId = SessionId('settled-child')
const summary = { type: 'text', text: `Background subagent ${childId} finished and will do no further work unless you send it more.` }
const reasoning: ContentBlock = { type: 'reasoning', text: 'private child reasoning' }
const toolCall: ContentBlock = { type: 'tool-call', id: ToolCallId('child-call'), name: 'read', arguments: '{}' }

describe('continuable settlement content', () => {
  it.each([
    ['reasoning before the answer', [reasoning, { type: 'text', text: 'answer' }]],
    ['a tool call after the answer', [{ type: 'text', text: 'answer' }, toolCall]],
  ] satisfies [string, ContentBlock[]][])('reports only the closing text with %s', (_label, output) => {
    const original = structuredClone(output)
    const message = createSettlementMessage(childId, { stopReason: 'completed', output })

    expect(message.role).toBe('user')
    expect(message.content).toEqual([
      summary,
      { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: 'answer' },
    ])
    expect(output).toEqual(original)
  })

  it.each([
    ['absent output', undefined],
    ['empty output', []],
    ['reasoning-only output', [reasoning]],
    ['empty text', [{ type: 'text', text: '' }]],
  ] satisfies [string, ContentBlock[] | undefined][])('reports no closing message for %s', (_label, output) => {
    const message = createSettlementMessage(childId, { stopReason: 'completed', ...output === undefined ? {} : { output } })

    expect(message.content).toEqual([
      summary,
      { type: 'text', text: 'It left no closing message and recorded no failure diagnostic.' },
    ])
  })

  it('reports the recorded failure diagnostic when no closing text exists', () => {
    const message = createSettlementMessage(childId, {
      stopReason: 'error',
      diagnostic: 'Subagent failure (stage: turn 1; category: OVERLOADED; status: 529; message: overloaded server)',
    })

    expect(message.content).toEqual([
      {
        type: 'text',
        text: `Background subagent ${childId} failed before it finished; the recorded failure follows.`,
      },
      {
        type: 'text',
        text: 'Failure diagnostic: Subagent failure (stage: turn 1; category: OVERLOADED; status: 529; message: overloaded server)',
      },
      { type: 'text', text: 'It left no closing message.' },
    ])
  })

  it('keeps a partial closing message and appends the recorded failure diagnostic', () => {
    const message = createSettlementMessage(childId, {
      stopReason: 'error',
      diagnostic: 'Subagent failure (stage: turn 2; category: UNKNOWN; message: transport reset)',
      output: [{ type: 'text', text: 'partial answer' }],
    })

    expect(message.content).toEqual([
      {
        type: 'text',
        text: `Background subagent ${childId} failed before it finished; the recorded failure follows.`,
      },
      { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: 'partial answer' },
      {
        type: 'text',
        text: 'Failure diagnostic: Subagent failure (stage: turn 2; category: UNKNOWN; message: transport reset)',
      },
    ])
  })

  it('preserves text block order and bytes around omitted reasoning and tool calls', () => {
    const first: ContentBlock = { type: 'text', text: '  first\n' }
    const second: ContentBlock = { type: 'text', text: '\n第二段  ' }
    const message = createSettlementMessage(childId, {
      stopReason: 'completed',
      output: [reasoning, first, toolCall, second],
    })

    expect(message.content).toEqual([
      summary,
      { type: 'text', text: 'Its closing message:' },
      first,
      second,
    ])
  })
})
