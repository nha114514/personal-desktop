/** Product identity used only by the personal Desktop build. */
export const PERSONAL_DESKTOP_NAME: 'Personal Desktop'

/** Resolve the selected packaging and executable name. */
export function desktopProductName(environment: NodeJS.ProcessEnv): string

/**
 * Resolve the explicit local-fork flag.
 * @param environment Launch or packaging environment.
 * @returns Whether upstream release services are disabled.
 */
export function isPersonalDesktop(environment: NodeJS.ProcessEnv): boolean
