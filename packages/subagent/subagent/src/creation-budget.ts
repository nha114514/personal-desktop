/** Restore child creation counts for the latest human request. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

const stateSchema = z.object({
  inheritedEventCount: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
}).strict()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    subagentCreationBudget: z.infer<typeof stateSchema>
  }
}

/** Count published children for the latest human request across a Host restart. */
export const subagentCreationBudgetProjectionDefinition = {
  key: 'subagentCreationBudget',
  stateVersion: 1,
  stateSchema,
  init: (_header, inheritedEventCount) => ({ inheritedEventCount, generation: 0, created: 0 }),
  apply: (state, event) => {
    if (event.seq < state.inheritedEventCount) return state
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      return { ...state, generation: event.seq, created: 0 }
    }
    if (event.type === 'subagent/catalog') return { ...state, created: state.created + 1 }
    return state
  },
} satisfies ProjectionDefinition<'subagentCreationBudget', z.infer<typeof stateSchema>>
