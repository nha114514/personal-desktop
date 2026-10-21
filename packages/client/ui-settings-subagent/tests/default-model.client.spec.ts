import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  SubagentDefaultModelCardController, type SubagentDefaultModelSettings,
} from '../src/client/subagent-default-model-card-controller.ts'

describe('Subagent default model editor', () => {
  it('stages an arbitrary API route and clears the previous model effort in one write', async () => {
    const host = stubConfigForm<SubagentDefaultModelSettings>()
    host.publish({ status: 'ready', writable: true, revision: 7, user: {}, value: {
      provider: 'gemini', model: 'old-model', reasoningEffort: 'low', autoDelegate: true,
    } })
    const controller = new SubagentDefaultModelCardController(host.scope)
    const face = controller.inject()
    host.mutate.mockImplementation(async (ops) => {
      const value = { ...host.scope.getSnapshot().value! }
      for (const op of ops) if (op.op === 'set') Reflect.set(value, op.path[0]!, op.value)
      host.publish({ value, revision: 8 })
      return true
    })
    face.selectModel('my-api', 'any-new-model-id')
    expect(host.mutate).not.toHaveBeenCalled()
    expect(face.hooks.subagentDefaultModelCard.getSnapshot()).toMatchObject({
      dirty: true, provider: { text: 'my-api' }, model: { text: 'any-new-model-id' }, reasoningEffort: { text: '' },
    })
    face.save()
    await vi.waitFor(() => { expect(face.hooks.subagentDefaultModelCard.getSnapshot().dirty).toBe(false) })
    expect(host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['provider'], value: 'my-api' },
      { op: 'set', path: ['model'], value: 'any-new-model-id' },
      { op: 'set', path: ['reasoningEffort'], value: '' },
    ], 7)
    expect(host.scope.getSnapshot().value?.autoDelegate).toBe(true)
    controller.dispose()
  })

  it('retains a refused draft and cannot edit a read-only default', async () => {
    const host = stubConfigForm<SubagentDefaultModelSettings>()
    host.publish({ status: 'ready', writable: true, value: { provider: 'alpha', model: 'fast' }, user: {} })
    const controller = new SubagentDefaultModelCardController(host.scope)
    const face = controller.inject()
    host.mutate.mockResolvedValue(false)
    face.selectModel('custom', 'reasoning-model')
    face.editEffort('high')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.subagentDefaultModelCard.getSnapshot().failed).toBe(true) })
    face.discard()
    host.publish({ writable: false })
    face.selectModel('custom', 'reasoning-model')
    face.editEffort('high')
    expect(face.hooks.subagentDefaultModelCard.getSnapshot()).toMatchObject({ dirty: false, provider: { text: 'alpha' } })
    controller.dispose()
  })

  it('drops the old draft when another Host connects at the same revision', () => {
    const host = stubConfigForm<SubagentDefaultModelSettings>()
    host.publish({ status: 'ready', writable: true, revision: 0, user: {}, value: { provider: 'old', model: 'fast' } })
    const controller = new SubagentDefaultModelCardController(host.scope)
    const face = controller.inject()
    face.selectModel('old-api', 'old-draft')
    controller.resetConnection()
    host.publish({ value: { provider: 'new', model: 'reasoning', reasoningEffort: 'high' }, revision: 0 })
    expect(face.hooks.subagentDefaultModelCard.getSnapshot()).toMatchObject({
      dirty: false, saving: false, failed: false, provider: { text: 'new' }, model: { text: 'reasoning' },
      reasoningEffort: { text: 'high' },
    })
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
    controller.dispose()
  })

  it.each([true, false])('ignores an old save settlement (%s) after a reconnect', async (accepted) => {
    const host = stubConfigForm<SubagentDefaultModelSettings>()
    host.publish({ status: 'ready', writable: true, revision: 0, user: {}, value: { provider: 'old', model: 'fast' } })
    const controller = new SubagentDefaultModelCardController(host.scope)
    const face = controller.inject()
    let settle!: (accepted: boolean) => void
    host.mutate.mockImplementation(() => new Promise<boolean>((resolve) => { settle = resolve }))
    face.selectModel('old-api', 'old-draft')
    face.save()
    controller.resetConnection()
    host.publish({ value: { provider: 'new', model: 'fast' }, revision: 0 })
    face.selectModel('new-api', 'new-draft')
    settle(accepted)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(face.hooks.subagentDefaultModelCard.getSnapshot()).toMatchObject({
      dirty: true, saving: false, failed: false, provider: { text: 'new-api' }, model: { text: 'new-draft' },
    })
    controller.dispose()
  })
})
