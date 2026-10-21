// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonalWorkbenchPage } from '../src/client/PersonalWorkbenchPage.tsx'
import { en } from '../src/client/locales.ts'

const snapshot = (paused: boolean, epoch: number) => ({
  connected: false, paused, epoch, busy: false, locked: false, tools: [], toolCount: 0,
})
type Snapshot = ReturnType<typeof snapshot>

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(paused: boolean) {
  let publish: (value: Snapshot) => void = () => {}
  const resume = vi.fn(async () => snapshot(false, 2))
  vi.stubGlobal('dshDesktop', { personalDesktopControl: {
    status: async () => snapshot(paused, 1),
    subscribe: (listener: (value: Snapshot) => void) => {
      publish = listener
      return () => {}
    },
    resume,
  } })
  return { resume, publish: (value: Snapshot) => { act(() => { publish(value) }) } }
}

it('offers an accessible resume action while disconnected and paused, and calls IPC once', async () => {
  const { resume } = setup(true)
  render(<PersonalWorkbenchPage />)
  fireEvent.click(await screen.findByRole('button', { name: /恢复自动操作/ }))
  await waitFor(() => { expect(resume).toHaveBeenCalledTimes(1) })
  await waitFor(() => { expect(screen.queryByRole('button', { name: /恢复自动操作/ })).toBeNull() })
})

it('uses the English locale for the accessible resume name', async () => {
  setup(true)
  render(<PersonalWorkbenchPage t={key => en[key]} />)
  expect(await screen.findByRole('button', { name: 'Resume Automation' })).toBeTruthy()
})

it('does not offer resume when automation is not paused', async () => {
  const { publish } = setup(false)
  render(<PersonalWorkbenchPage />)
  await act(async () => {})
  expect(screen.queryByRole('button', { name: /恢复自动操作/ })).toBeNull()
  publish(snapshot(true, 2))
  expect(screen.getByRole('button', { name: /恢复自动操作/ })).toBeTruthy()
})

it('rejects a stale resume result after a newer stop snapshot', async () => {
  const { resume, publish } = setup(true)
  let finish: (value: Snapshot) => void = () => {}
  resume.mockImplementation(() => new Promise<Snapshot>(resolve => { finish = resolve }))
  render(<PersonalWorkbenchPage />)
  fireEvent.click(await screen.findByRole('button', { name: /恢复自动操作/ }))
  publish(snapshot(true, 3))
  await act(async () => { finish(snapshot(false, 2)) })
  expect(screen.getByRole('button', { name: /恢复自动操作/ })).toBeTruthy()
  expect(resume).toHaveBeenCalledTimes(1)
})

it('rejects stale subscription snapshots and follows the current generation', async () => {
  const { publish } = setup(true)
  render(<PersonalWorkbenchPage />)
  await screen.findByRole('button', { name: /恢复自动操作/ })
  publish(snapshot(true, 3))
  publish(snapshot(false, 2))
  expect(screen.getByRole('button', { name: /恢复自动操作/ })).toBeTruthy()
  publish(snapshot(false, 3))
  expect(screen.queryByRole('button', { name: /恢复自动操作/ })).toBeNull()
})
