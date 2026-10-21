// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
import type { PersonalAccountsSnapshot } from '../src/types.ts'
import { AccountsSection } from '../src/client/AccountsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function mount(value: PersonalAccountsSnapshot, reopenAuthorization = vi.fn(async () => {})) {
  const login = vi.fn(async () => {})
  const cancel = vi.fn(async () => {})
  const submitCode = vi.fn(async () => {})
  const props = {
    useAccounts: selector => selector({ value, failed: false }), login, cancel, submitCode, reopenAuthorization, t: makeTranslate(zh),
  } as Parameters<typeof AccountsSection>[0]
  const view = render(<AccountsSection {...props} />)
  return { ...view, login, cancel, submitCode, reopenAuthorization }
}

it('routes login and cancellation to the selected account', () => {
  const view = mount({ accounts: [{ id: '2', phase: 'idle' }, { id: 'codex', phase: 'signing-in' }] })
  fireEvent.click(screen.getByRole('button', { name: '账号 2 · 一键登录' }))
  fireEvent.click(screen.getByRole('button', { name: 'GPT 官方账号 · 取消登录' }))
  expect(view.login).toHaveBeenCalledExactlyOnceWith('2')
  expect(view.cancel).toHaveBeenCalledExactlyOnceWith('codex')
})

it('shows a blocked client without claiming that either account is logged in', () => {
  mount({ accounts: [{ id: '2', phase: 'error', failure: 'unsupported-client' }, { id: 'codex', phase: 'idle' }] })
  expect(screen.getByText(zh.unsupportedClient)).toBeTruthy()
  expect(screen.getByRole('link', { name: zh.migration }).getAttribute('href')).toBe('https://antigravity.google/docs/gcli-migration/')
  expect(screen.queryByText(zh.verified)).toBeNull()
  expect(screen.getAllByRole('button')).toHaveLength(2)
})

it('offers verification for a saved login without requiring another browser authorization', () => {
  const view = mount({ accounts: [{ id: '2', phase: 'saved', checkedAt: '2026-10-03T02:00:00.000Z' }, { id: 'codex', phase: 'idle' }] })
  expect(screen.getByText(zh.saved)).toBeTruthy()
  expect(screen.queryByText(zh.verified)).toBeNull()
  expect(screen.queryByPlaceholderText(zh.authorizationCode)).toBeNull()
  expect(screen.getByText('上次验证时间：2026-10-03T02:00:00.000Z')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '账号 2 · 重新验证' }))
  expect(view.login).toHaveBeenCalledExactlyOnceWith('2')
})

it('submits an authorization code only for its own account and clears the field', () => {
  const view = mount({ accounts: [{ id: '2', phase: 'awaiting-code' }, { id: 'codex', phase: 'idle' }] })
  const input = screen.getByLabelText('账号 2 · Google 授权码')
  fireEvent.change(input, { target: { value: 'temporary-code' } })
  fireEvent.click(screen.getByRole('button', { name: '提交授权码' }))
  expect(view.submitCode).toHaveBeenCalledExactlyOnceWith('2', 'temporary-code')
  expect((input as HTMLInputElement).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: '重新打开授权页' }))
  expect(view.reopenAuthorization).toHaveBeenCalledExactlyOnceWith('2')
  fireEvent.click(screen.getByRole('button', { name: '账号 2 · 取消登录' }))
  expect(view.cancel).toHaveBeenCalledExactlyOnceWith('2')
})

it('shows verifying phase and allows canceling during code verification', () => {
  const view = mount({ accounts: [{ id: '2', phase: 'verifying' }, { id: 'codex', phase: 'idle' }] })
  expect(screen.getByText(zh.verifying)).toBeTruthy()
  expect(screen.queryByPlaceholderText('Google 授权码')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '账号 2 · 取消登录' }))
  expect(view.cancel).toHaveBeenCalledExactlyOnceWith('2')
})

it('keeps successful verification and quota failure specific to their own account', () => {
  mount({ accounts: [{ id: '2', phase: 'verified', checkedAt: '2026-10-03T02:00:00Z' }, { id: 'codex', phase: 'error', failure: 'quota-exceeded' }] })
  const first = screen.getByRole('heading', { name: '账号 2' }).parentElement?.parentElement
  const second = screen.getByRole('heading', { name: zh.accountCodex }).parentElement?.parentElement
  expect(within(first!).getByText(zh.verified)).toBeTruthy()
  expect(within(second!).getByText(zh.quotaExceeded)).toBeTruthy()
})

it('renders official GPT account status and routes actions independently', () => {
  const view = mount({ accounts: [
    { id: '2', phase: 'saved' },
    { id: 'codex', phase: 'saved', checkedAt: '2026-10-04T08:00:00.000Z' },
  ] })
  expect(screen.getByRole('heading', { name: zh.accountCodex })).toBeTruthy()
  expect(screen.getAllByRole('heading')).toHaveLength(2)
  expect(screen.queryByRole('heading', { name: '账号 1' })).toBeNull()
  expect(screen.getByText(zh.savedCodex)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: `${zh.accountCodex} · ${zh.verify}` }))
  expect(view.login).toHaveBeenCalledExactlyOnceWith('codex')
})

