/** Explicit local-fork mode; ordinary release configuration remains unchanged. */

/** Product identity used only by the personal Desktop build. */
export const PERSONAL_DESKTOP_NAME = 'Personal Desktop'

/**
 * Resolve the executable and bundle product name for packaging and smoke checks.
 * @param {NodeJS.ProcessEnv} environment Packaging environment.
 * @returns {string} The selected product name.
 */
export function desktopProductName(environment) {
  return isPersonalDesktop(environment) ? PERSONAL_DESKTOP_NAME : 'DeepSeek Harness'
}

/**
 * Resolve the opt-in personal mode without accepting ambiguous environment values.
 * @param {NodeJS.ProcessEnv} environment Launch or packaging environment.
 * @returns {boolean} Whether the personal fork disables upstream release services.
 */
export function isPersonalDesktop(environment) {
  const value = environment.DSH_DESKTOP_PERSONAL
  if (value !== undefined && value !== '0' && value !== '1') {
    throw new Error('desktop personal mode: DSH_DESKTOP_PERSONAL must be 0 or 1')
  }
  return value === '1'
}
