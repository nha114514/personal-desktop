import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export function PersonalWorkbenchIcon({ size = 16 }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="12" height="9" rx="1.5" />
      <path d="M5 14h6" />
      <path d="M8 11v3" />
      <path d="M5 6h2" />
      <path d="M9 6h2" />
    </svg>
  )
}
