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

/**
 * Extract text and image block representations without changing their order.
 * @param message - the recorded message or one-shot user input.
 * @returns the text sent to Codex.
 */
export function codexMessageText(message: RequestMessage): string {
  return (message.content ?? [])
    .map(formatBlockText)
    .filter(s => s.length > 0)
    .join('\n')
}

/**
 * Format the complete request when creating a new Codex thread.
 * @param options - the assembled Harness request.
 * @returns instructions and recorded conversation text.
 */
export function formatCodexPrompt(options: GenerateOptions): string {
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

  // Collect non-system conversation turns
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
    } else if (msg.role === 'developer') {
      const text = codexMessageText(msg)
      if (text.trim()) conversationTurns.push(`[Developer]: ${text}`)
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

/**
 * Format new inputs for a retained thread or a pending tool response.
 * @param options - only messages not yet delivered to the retained thread.
 * @returns every new user, developer and system message in conversation order.
 */
export function formatCodexTurnPrompt(options: GenerateOptions): string {
  return formatCodexPrompt({
    provider: options.provider,
    model: options.model,
    messages: options.messages.filter(message => message.role !== 'assistant' && message.role !== 'tool'),
  })
}
