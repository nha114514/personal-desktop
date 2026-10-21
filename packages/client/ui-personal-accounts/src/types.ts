/** The only account selectors accepted by the native login operation. */
export type PersonalAccountId = '2' | 'codex'

/** Safe failure categories; raw CLI output never crosses the native bridge. */
export type PersonalAccountFailure =
  | 'unsupported-client' | 'quota-exceeded' | 'authentication-required'
  | 'cli-unavailable' | 'request-failed' | 'canceled' | 'timeout'
  | 'model-not-selected'

/** Saved login is distinct from a successful request in the current native process. */
export interface PersonalAccountState {
  readonly id: PersonalAccountId
  readonly phase: 'idle' | 'saved' | 'signing-in' | 'awaiting-code' | 'verifying' | 'verified' | 'error'
  readonly failure?: PersonalAccountFailure
  readonly checkedAt?: string
  readonly verifiedModel?: string
}

/** Native status for the retained Google account and official Codex account. */
export interface PersonalAccountsSnapshot {
  readonly accounts: readonly PersonalAccountState[]
}

/** Native login capability. It accepts account selectors, never commands or credentials. */
export interface PersonalAccountsApi {
  status(): Promise<PersonalAccountsSnapshot | null>
  login(account: PersonalAccountId): Promise<PersonalAccountsSnapshot>
  cancel(account: PersonalAccountId): Promise<PersonalAccountsSnapshot>
  submitCode(account: PersonalAccountId, code: string): Promise<PersonalAccountsSnapshot>
  reopenAuthorization?(account: PersonalAccountId): Promise<PersonalAccountsSnapshot>
  subscribe(listener: (snapshot: PersonalAccountsSnapshot) => void): () => void
}
