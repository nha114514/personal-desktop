// @vitest-environment jsdom
/** Model rows retain input and capacity editing without declaring reasoning levels. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelRow } from '../src/client/ModelRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('omits the manual reasoning controls and preserves model metadata when inputs change', () => {
  const model = {
    id: 'custom-model', contextWindow: 1048576, maxTokens: 65536,
    reasoningEfforts: { off: null, low: 'low', max: 'max' },
  }
  const onChange = vi.fn()
  render(<ModelRow
    model={model} position={1} inputField="input" expanded disabled={false}
    t={key => en[key]} contextWindow={{ value: '1M', placeholder: '', onChange: vi.fn() }}
    maxTokens={{ value: '64K', placeholder: '', onChange: vi.fn() }}
    onFieldChange={vi.fn()} onChange={onChange} onToggle={vi.fn()} onRemove={vi.fn()}
  />)
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Max' })).toBeNull()
  expect(screen.getByLabelText(`${en.contextWindow} 1`)).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: en.modelInputImage }))
  expect(onChange).toHaveBeenCalledWith({ ...model, input: ['text', 'image'] })
})
