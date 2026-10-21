/** Shell copy for the explicitly selected personal fork. */
import type { DesktopLocale, DesktopMessages } from './locale.ts'

/** Product identity used by the personal Desktop shell. */
export const PERSONAL_DESKTOP_NAME = 'Personal Desktop'

/**
 * Resolve personal mode at launch; packaging validates the same explicit flag.
 * @param environment Launch environment.
 * @returns Whether this is the personal fork.
 */
export function isPersonalDesktop(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.DSH_DESKTOP_PERSONAL
  if (value !== undefined && value !== '0' && value !== '1') {
    throw new Error('desktop personal mode: DSH_DESKTOP_PERSONAL must be 0 or 1')
  }
  return value === '1'
}

/**
 * Keep translated shell messages while replacing the upstream product name.
 * @param locale Selected built-in dictionary.
 * @param personal Whether this is the personal fork.
 * @returns A private dictionary for the personal product, or the original locale.
 */
export function personalDesktopLocale(locale: DesktopLocale, personal: boolean): DesktopLocale {
  if (!personal) return locale
  return { ...locale, messages: Object.fromEntries(Object.entries(locale.messages)
    .map(([key, value]) => [key, value.replaceAll('DeepSeek Harness', PERSONAL_DESKTOP_NAME)])) as DesktopMessages }
}
