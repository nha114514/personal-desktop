/**
 * Workspace picker plugin, node half. Host configuration for the startup
 * conversation selection is validated here and published to product pages
 * before browser plugins activate (load and lifecycle follow the host; the
 * browser half ships via exports["./client"], discovered through the
 * package.json dsh.client declaration).
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { type Config, STARTUP_CONFIG_GLOBAL } from './startup-config.ts'

export { Config } from './startup-config.ts'

/**
 * Publish the startup conversation-selection options before browser plugins
 * activate.
 * @param ctx - Host context collecting the page's initialization data.
 * @param config - plugin options with schema defaults applied by the Loader.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: STARTUP_CONFIG_GLOBAL,
      value: { restoreLastSession: config.restoreLastSession },
    })
  })
}
