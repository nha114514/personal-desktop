import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PersonalWorkbenchIcon } from './PersonalWorkbenchIcon.tsx'
import { PersonalWorkbenchPage } from './PersonalWorkbenchPage.tsx'
import { en, zh, type PersonalWorkbenchKey } from './locales.ts'

export const PANEL_ID = 'personal-workbench'
const NS = 'personalWorkbench'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    personalWorkbench: PersonalWorkbenchKey
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'personal-workbench: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
  }, PersonalWorkbenchPage))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 12,
    locale: NS,
    label: () => t('panel'),
  }, PersonalWorkbenchIcon))
}
