/** Native account settings contribution for the explicitly selected personal profile. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PersonalAccountsApi, PersonalAccountsSnapshot } from '../types.ts'
import { AccountsSection, type AccountsSectionInjected } from './AccountsSection.tsx'
import { en, zh, type PersonalAccountsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personal subscription account login and safe status copy. */
    personalAccounts: PersonalAccountsKey
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  const api = (globalThis as typeof globalThis & { dshDesktop?: { personalAccounts?: PersonalAccountsApi } }).dshDesktop?.personalAccounts
  if (api === undefined) return
  const accounts = createSnapshotStore<{ value: PersonalAccountsSnapshot | undefined; failed: boolean }>({
    value: undefined, failed: false,
  })
  let disposed = false
  let revision = 0
  const publish = (value: PersonalAccountsSnapshot): void => {
    revision++
    if (!disposed) accounts.set({ value, failed: false })
  }
  ctx.effect(() => ctx.locale.register('personalAccounts', { zh, en }), 'personal-accounts: dictionaries')
  const t = ctx.locale.bind('personalAccounts')
  ctx.effect(() => {
    const off = api.subscribe(publish)
    const startRevision = revision
    void api.status().then((value) => {
      if (!disposed && revision === startRevision) accounts.set({ value: value ?? undefined, failed: value === null })
    }).catch(() => { if (!disposed && revision === startRevision) accounts.set({ value: undefined, failed: true }) })
    return () => { disposed = true; off() }
  }, 'personal-accounts: native status')
  const request = async (action: 'login' | 'cancel', account: Parameters<PersonalAccountsApi['login']>[0]): Promise<void> => {
    try { await api[action](account) }
    catch { if (!disposed) accounts.set({ ...accounts.getSnapshot(), failed: true }) }
  }
  const submitCode: AccountsSectionInjected['submitCode'] = async (account, code) => {
    try { await api.submitCode(account, code) }
    catch { if (!disposed) accounts.set({ ...accounts.getSnapshot(), failed: true }) }
  }
  const reopenAuthorization: AccountsSectionInjected['reopenAuthorization'] = async (account) => {
    try { await api.reopenAuthorization?.(account) }
    catch { if (!disposed) accounts.set({ ...accounts.getSnapshot(), failed: true }) }
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'personal-accounts', order: 15,
    label: () => t('nav'), locale: 'personalAccounts',
    inject: (): AccountsSectionInjected => ({
      hooks: { accounts }, login: account => request('login', account), cancel: account => request('cancel', account), submitCode, reopenAuthorization,
    }),
  }, AccountsSection))
}
