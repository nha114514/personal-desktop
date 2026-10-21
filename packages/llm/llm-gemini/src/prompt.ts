import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'

function formatBlockText(block: any): string {
  if (block.type === 'text') {
    return block.text ?? ''
  }
  if (block.type === 'image') {
    const meta = block.mimeType || block.mediaType || block.attachment?.mimeType || block.image?.mediaType || block.image?.mimeType || 'image/png'
    const name = block.name || block.attachment?.fileName || block.image?.id || block.image?.name || block.id || 'image'
    return `[Image: ${name} (${meta})]`
  }
  return ''
}

export function formatFullPrompt(options: GenerateOptions): string {
  const parts: string[] = []

  // Collect system instructions
  const systemTexts: string[] = []
  if (options.system && options.system.trim().length > 0) {
    systemTexts.push(options.system.trim())
  }

  for (const msg of options.messages) {
    if (msg.role === 'system') {
      const text = (msg.content ?? [])
        .map(formatBlockText)
        .filter(s => s.length > 0)
        .join('')
      if (text.trim().length > 0) {
        systemTexts.push(text.trim())
      }
    }
  }

  if (systemTexts.length > 0) {
    parts.push(`[System Instructions]\n${systemTexts.join('\n\n')}`)
  }

  // Collect conversation turns
  const conversationTurns: string[] = []
  for (const msg of options.messages) {
    if (msg.role === 'system') continue

    if (msg.role === 'user') {
      const texts = (msg.content ?? [])
        .map(formatBlockText)
        .filter(s => s.length > 0)
        .join('\n')
      if (texts.trim().length > 0) {
        conversationTurns.push(`[User]: ${texts.trim()}`)
      }
    } else if (msg.role === 'assistant') {
      const texts = (msg.content ?? [])
        .filter(b => b.type !== 'tool-call')
        .map(formatBlockText)
        .filter(s => s.length > 0)
        .join('\n')
      const toolCalls = (msg.content ?? [])
        .filter(b => b.type === 'tool-call')
        .map(b => {
          const call = b as { type: 'tool-call'; name: string; arguments: string }
          return `[Tool Call ${call.name}]: ${call.arguments}`
        })
        .join('\n')
      const combined = [texts, toolCalls].filter(s => s.trim().length > 0).join('\n')
      if (combined.trim().length > 0) {
        conversationTurns.push(`[Assistant]: ${combined.trim()}`)
      }
    } else if (msg.role === 'tool') {
      const toolMsg = msg as Extract<RequestMessage, { role: 'tool' }>
      const content = toolMsg.content
      const text = typeof content === 'string'
        ? content
        : (content ?? [])
          .map(formatBlockText)
          .filter(s => s.length > 0)
          .join('\n')
      conversationTurns.push(`[Tool Result]: ${text.trim()}`)
    }
  }

  if (conversationTurns.length > 1) {
    parts.push(`[Conversation History]\n${conversationTurns.slice(0, -1).join('\n\n')}`)
    parts.push(`[Current Turn]\n${conversationTurns[conversationTurns.length - 1] ?? ''}`)
  } else if (conversationTurns.length === 1 && conversationTurns[0]) {
    parts.push(conversationTurns[0])
  } else {
    parts.push('Please assist the user.')
  }

  return parts.join('\n\n')
}

export function formatLatestTurn(options: GenerateOptions): string {
  // Find the last non-system message
  for (let i = options.messages.length - 1; i >= 0; i--) {
    const msg = options.messages[i]
    if (!msg || msg.role === 'system') continue

    if (msg.role === 'user') {
      const texts = (msg.content ?? [])
        .map(formatBlockText)
        .filter(s => s.length > 0)
        .join('\n')
      if (texts.trim().length > 0) {
        return texts.trim()
      }
    } else if (msg.role === 'tool') {
      let start = i
      while (start > 0 && options.messages[start - 1]?.role === 'tool') start--
      const results: string[] = []
      for (const result of options.messages.slice(start, i + 1)) {
        if (result.role !== 'tool') continue
        const call = options.messages.slice(0, start).flatMap(previous => previous.role === 'assistant' ? previous.content : [])
          .find(block => block.type === 'tool-call' && block.id === result.toolCallId)
        const name = call?.type === 'tool-call' ? call.name : result.toolCallId
        const content = result.content
        const text = typeof content === 'string'
          ? content
          : (content ?? []).map(formatBlockText).filter(s => s.length > 0).join('\n')
        results.push(`[Tool Result ${name}]: ${text.trim()}`)
      }
      return results.join('\n\n')
    }
  }

  return formatFullPrompt(options)
}
