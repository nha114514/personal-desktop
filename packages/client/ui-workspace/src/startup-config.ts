/** Public page-bootstrap options shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** Initial conversation selection when the client starts. */
export interface Config {
  /** Restore the saved conversation; false creates a fresh chat in its Workspace. */
  restoreLastSession: boolean
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  restoreLastSession: z.boolean().default(true),
})

/** Page-global key carrying only the public startup options. */
export const STARTUP_CONFIG_GLOBAL = '__DSH_WORKSPACE_STARTUP__'
