/** Account settings receives safe state and callbacks through the slot injection. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PersonalAccountFailure, PersonalAccountId, PersonalAccountsSnapshot } from '../types.ts'
import type { PersonalAccountsKey } from './locales.ts'
import css from './AccountsSection.module.css'

export interface AccountsSectionInjected {
  hooks: { accounts: ObservableSnapshot<{ value: PersonalAccountsSnapshot | undefined; failed: boolean }> }
  login(account: PersonalAccountId): Promise<void>
  cancel(account: PersonalAccountId): Promise<void>
  submitCode(account: PersonalAccountId, code: string): Promise<void>
  reopenAuthorization?(account: PersonalAccountId): Promise<void>
}

type AccountsSectionProps = PropsRuntime<'settings.section'> & InjectFace<AccountsSectionInjected> & PropsLocale<'personalAccounts'>

const failureKeys: Record<PersonalAccountFailure, PersonalAccountsKey> = {
  'unsupported-client': 'unsupportedClient', 'quota-exceeded': 'quotaExceeded',
  'authentication-required': 'authenticationRequired', 'cli-unavailable': 'cliUnavailable',
  'request-failed': 'requestFailed', canceled: 'canceled', timeout: 'timeout',
  'model-not-selected': 'modelNotSelected',
}

export function AccountsSection({ useAccounts, login, cancel, submitCode, reopenAuthorization, t }: AccountsSectionProps) {
  const { value, failed } = useAccounts(snapshot => snapshot)
  const [codes, setCodes] = useState<Record<string, string>>({ '2': '', codex: '' })
  return <div className={css.section}>
    <p className={css.description}>{t('description')}</p>
    {failed && <p role="alert">{t('unavailable')}</p>}
    {value === undefined ? (!failed && <p>{t('loading')}</p>) : value.accounts.map((account) => {
      const accountTitle = account.id === 'codex' ? t('accountCodex') : t('account', { id: account.id })
      const statusText = account.failure !== undefined
        ? t(failureKeys[account.failure])
        : account.phase === 'verifying'
          ? t('verifying')
          : account.phase === 'awaiting-code'
            ? t('awaitingCode')
            : account.phase === 'signing-in'
              ? (account.id === 'codex' ? t('signingInCodex') : t('signingIn'))
              : account.phase === 'verified'
                ? t('verified')
                : account.phase === 'saved'
                  ? (account.id === 'codex' ? t('savedCodex') : t('saved'))
                  : t('idle')
      return (
        <div className={css.card} key={account.id}>
          <div className={css.row}>
            <h3 className={css.name}>{accountTitle}</h3>
            <Button variant="outline" size="sm" aria-label={`${accountTitle} · ${t(account.phase === 'signing-in' || account.phase === 'awaiting-code' || account.phase === 'verifying' ? 'cancel' : account.phase === 'verified' || account.phase === 'saved' ? 'verify' : 'login')}`}
              onClick={() => { setCodes(previous => ({ ...previous, [account.id]: '' })); void (account.phase === 'signing-in' || account.phase === 'awaiting-code' || account.phase === 'verifying' ? cancel(account.id) : login(account.id)) }}>
              {t(account.phase === 'signing-in' || account.phase === 'awaiting-code' || account.phase === 'verifying' ? 'cancel' : account.phase === 'verified' || account.phase === 'saved' ? 'verify' : 'login')}
            </Button>
          </div>
          <p className={css.status} role="status">{statusText}</p>
          {account.phase === 'awaiting-code' && <>
            <form className={css.row} onSubmit={(event) => {
              event.preventDefault()
              const code = (codes[account.id] ?? '').trim()
              setCodes(previous => ({ ...previous, [account.id]: '' }))
              void submitCode(account.id, code)
            }}>
              <input className={css.codeInput} type="password" autoComplete="off" maxLength={4096}
                aria-label={`${accountTitle} · ${t('authorizationCode')}`}
                placeholder={t('authorizationCode')} value={codes[account.id] ?? ''}
                onChange={(event) => { setCodes(previous => ({ ...previous, [account.id]: event.target.value })) }} />
              <Button variant="outline" size="sm" type="submit" disabled={(codes[account.id] ?? '').trim() === ''}>{t('submitCode')}</Button>
            </form>
            {reopenAuthorization !== undefined && <div className={css.row}>
              <Button variant="outline" size="sm" type="button" onClick={() => { void reopenAuthorization(account.id) }}>{t('reopenAuthorization')}</Button>
            </div>}
          </>}
          {account.checkedAt !== undefined && <p className={css.status}>{t('checkedAt', { time: account.checkedAt })}</p>}
          {account.verifiedModel !== undefined && <p className={css.status}>{t('verifiedModel', { model: account.verifiedModel })}</p>}
          {account.failure === 'unsupported-client' && <a href="https://antigravity.google/docs/gcli-migration/" target="_blank" rel="noreferrer">{t('migration')}</a>}
        </div>
      )
    })}
  </div>
}
