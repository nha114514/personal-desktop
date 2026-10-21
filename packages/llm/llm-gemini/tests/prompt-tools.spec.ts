import { expect, it } from 'vitest'
import { createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { formatLatestTurn } from '../src/prompt.ts'
it('continues with every result of a multiple-tool turn, including each tool name', () => {
  const a = ToolCallId('call-a'), b = ToolCallId('call-b')
  const messages = [createAssistantMessage({ source: { provider: 'gemini-1', model: 'gemini-3.8-flash' }, content: [
    { type: 'tool-call', id: a, name: 'web_search', arguments: '{}' }, { type: 'tool-call', id: b, name: 'web_fetch', arguments: '{}' } ] }),
    createToolResultMessage({ callId: a, isError: false, content: [{ type: 'text', text: 'RESULT A' }] }),
    createToolResultMessage({ callId: b, isError: false, content: [{ type: 'text', text: 'RESULT B' }] })]
  const prompt = formatLatestTurn({ provider: 'gemini-1', model: 'gemini-3.8-flash', messages })
  expect(prompt).toContain('[Tool Result web_search]')
  expect(prompt).toContain('RESULT A')
  expect(prompt).toContain('[Tool Result web_fetch]')
  expect(prompt).toContain('RESULT B')
})

it('retains image blocks in prompt formatting (R3)', () => {
  const callId = ToolCallId('call-img')
  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'Look at this picture:' },
        { type: 'image' as const, name: 'desktop.png', mimeType: 'image/png' } as any,
      ],
    },
    createAssistantMessage({ source: { provider: 'gemini-1', model: 'gemini-3.8-flash' }, content: [
      { type: 'tool-call', id: callId, name: 'take_screenshot', arguments: '{}' },
    ] }),
    createToolResultMessage({ callId, isError: false, content: [
      { type: 'image' as const, name: 'screenshot-result.png', mimeType: 'image/png' } as any,
    ] }),
  ]
  const full = formatLatestTurn({ provider: 'gemini-1', model: 'gemini-3.8-flash', messages })
  expect(full).toContain('[Image: screenshot-result.png (image/png)]')
})
