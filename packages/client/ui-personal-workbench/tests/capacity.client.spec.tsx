// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonalWorkbenchPage } from '../src/client/PersonalWorkbenchPage.tsx'
import { en } from '../src/client/locales.ts'
import type { DiagnosticsSnapshot } from '../src/types.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows unknown capacity and compression before diagnostics are available', () => {
  render(<PersonalWorkbenchPage />)
  expect(screen.getByText(/上下文容量未知/)).toBeTruthy()
  expect(screen.queryByText(/1M|85%|20%|自动压缩已启用/)).toBeNull()
})

it.each(['catalog-model', 'unsupported-model'])('does not infer capabilities from the model name %s', async model => {
  const snapshot: DiagnosticsSnapshot = {
    modelRoutes: {
      primaryModel: { provider: 'test', model, reasoningEffort: 'low' },
      subagentModels: [], configuredMatchesActual: null, channelType: 'unknown',
    },
    modelRequests: [], accounts: [], dependencies: [],
    liveStage: { stage: 'idle', stageStartedAt: '', elapsedMs: 0, lastActivityAt: '' },
    staleness: { isStale: false }, timestamp: '',
  }
  vi.stubGlobal('dshDesktop', { personalDiagnostics: {
    status: async () => snapshot, subscribe: () => () => {},
  } })
  render(<PersonalWorkbenchPage />)
  fireEvent.click(screen.getByRole('button', { name: '运行诊断' }))
  expect(await screen.findByText('上下文容量未知 · 自动压缩配置未知')).toBeTruthy()
  expect(screen.queryByText(/1M|85%|20%|自动压缩已启用/)).toBeNull()
})

it('localizes the unknown capability summary in English', () => {
  render(<PersonalWorkbenchPage t={key => en[key]} />)
  expect(screen.getByText(/Context capacity unknown/)).toBeTruthy()
  expect(screen.queryByText(/上下文|自动压缩/)).toBeNull()
})
