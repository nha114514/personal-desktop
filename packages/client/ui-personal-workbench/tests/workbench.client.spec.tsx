// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PersonalWorkbenchIcon } from '../src/client/PersonalWorkbenchIcon.tsx'
import { PersonalWorkbenchPage } from '../src/client/PersonalWorkbenchPage.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('renders workbench icon cleanly', () => {
  const unread = () => { throw new Error('unread') }
  const { container } = render(<PersonalWorkbenchIcon size={16} active={false}
    usePanelInfo={unread} useSessions={unread} useSessionStatus={unread} useSessionRetainInfo={unread}
    useWorkspaces={unread} useResource={unread} />)
  const svg = container.querySelector('svg')
  expect(svg).toBeTruthy()
  expect(svg?.getAttribute('width')).toBe('16')
})

it('renders personal workbench page with 5 tabs', () => {
  render(<PersonalWorkbenchPage />)
  expect(screen.getByText(zh.panel)).toBeTruthy()
  expect(screen.getByText(zh.tabTasks)).toBeTruthy()
  expect(screen.getByText(zh.tabDiagnostics)).toBeTruthy()
  expect(screen.getByText(zh.tabDesktopControl)).toBeTruthy()
  expect(screen.getByText(zh.tabMemory)).toBeTruthy()
  expect(screen.getByText(zh.tabTemplates)).toBeTruthy()
})

it('names only theme variables defined in ui-theme and never falls back to a literal color', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../src/client/PersonalWorkbenchPage.module.css'), 'utf8')
  const themeDir = resolve(import.meta.dirname, '../../ui-theme/src/styles')
  const tokens = readdirSync(themeDir)
    .filter(name => name.endsWith('.css'))
    .map(name => readFileSync(resolve(themeDir, name), 'utf8'))
    .join('\n')
  const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
  const undeclared = [...new Set(named)].filter(name =>
    name !== '--dsh-frame-top-clearance' && !tokens.includes(`  ${String(name)}:`))
  expect(undeclared).toEqual([])
  expect(css).not.toMatch(/var\(--(?:dsw|dsh|ds)-[a-z0-9-]+\s*,\s*(?:#|rgb|rgba|hsl|hsla)/)
})

