/** Publish non-secret request routes and timings on the existing shell/Host IPC channel. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ModelRequestObservation } from '@deepseek-ai/dsh-client-ui-personal-workbench/types'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'

/**
 * Observe the production stream and tool pipeline without storing text, arguments or errors.
 * @param ctx - Booted Desktop profile context.
 * @param publish - Private parent IPC publisher; failure does not fail a model request.
 * @returns Disposer for both scoped observers.
 */
export function installPersonalObservations(ctx: Context, publish: (event: ModelRequestObservation) => void): () => void {
  const latest = new WeakMap<object, { route: Omit<ModelRequestObservation, 'phase' | 'elapsedMs'>; started: number }>()
  const send = (event: ModelRequestObservation): void => {
    try { publish(event) } catch (_error) { /* Diagnostics must not interrupt request execution. */ }
  }
  const stream = ctx.on('llm/stream', (options: GenerateOptions, next) => {
    const session = options.sessionId === undefined ? undefined : ctx.get('sessions')?.get(options.sessionId)
    const header = session?.header
    const role = options.purpose !== undefined || header === undefined ? 'auxiliary'
      : header.origin === 'subagent' || header.parentSession !== undefined || (header.delegationDepth ?? 0) > 0 ? 'subagent' : 'primary'
    const directory = ctx.get('llm')?.listConfigurableProviders().find(entry => entry.provider === options.provider)
    const channelType = directory?.settingsNs === 'llm-pi-ai' || ['gemini', 'deepseek-account'].includes(options.provider) ? 'api-direct'
      : options.provider === 'codex' || options.provider === 'gemini-2' ? 'membership-cli' : 'unknown'
    const route: Omit<ModelRequestObservation, 'phase' | 'elapsedMs'> = {
      requestId: randomUUID(), role, provider: options.provider, model: options.model,
      channelType,
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
      ...(header?.parentSession === undefined ? {} : { parentSessionId: String(header.parentSession) }),
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: String(options.reasoningEffort) }),
    }
    return (async function* (): AsyncIterable<StreamChunk> {
      const started = performance.now()
      if (session !== undefined) latest.set(session, { route, started })
      const emit = (phase: ModelRequestObservation['phase'], extra: Partial<ModelRequestObservation> = {}): void => {
        send({ ...route, phase, elapsedMs: Math.max(0, performance.now() - started), ...extra })
      }
      emit('started')
      let firstEvent = false
      let firstText = false
      let finished = false
      try {
        for await (const chunk of next()) {
          if (!firstEvent) { firstEvent = true; emit('first-event') }
          if (!firstText && chunk.type === 'text-delta' && chunk.text.length > 0) {
            firstText = true
            emit('first-text')
          }
          if (chunk.type === 'finish') {
            finished = true
            const kind = chunk.reason.kind
            const outcome = kind === 'error' || kind === 'aborted' ? kind : kind === 'tool-calls' ? 'tool-calls' : kind === 'stop' ? 'success' : 'incomplete'
            const failure = kind === 'error' || kind === 'aborted' ? chunk.reason.failure : undefined
            emit('finished', { outcome, ...(failure ? { failureCode: failure.code } : {}) })
          }
          yield chunk
        }
      } catch (error) {
        if (!finished) { finished = true; emit('finished', { outcome: options.signal?.aborted ? 'aborted' : 'error' }) }
        throw error
      } finally {
        if (!finished) emit('finished', { outcome: options.signal?.aborted ? 'aborted' : 'incomplete' })
      }
    })()
  }, { global: true })
  const tools = ctx.on('tools/execute', async (execution, next) => {
    const request = execution.agent === undefined ? undefined : latest.get(execution.agent.session)
    const emit = (phase: 'tools-started' | 'tools-finished'): void => {
      if (request !== undefined) send({ ...request.route, phase, toolName: execution.name,
        elapsedMs: Math.max(0, performance.now() - request.started) })
    }
    emit('tools-started')
    try { return await next() } finally { emit('tools-finished') }
  }, { global: true })
  return () => { stream(); tools() }
}
