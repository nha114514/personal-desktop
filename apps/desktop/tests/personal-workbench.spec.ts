import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonalWorkbench, type TaskPhase } from '../src/personal-workbench.ts'

describe('PersonalWorkbench', () => {
  const dirs: string[] = []

  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true })
    }
  })

  it('manages task lifecycle and prevents external reports from auto-accepting tasks', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pw-workbench-'))
    dirs.push(tmp)
    const wb = new PersonalWorkbench({ dataDirectory: tmp })

    // 1. Create Task
    const task = wb.createTask({
      projectId: 'personal-desktop',
      title: '实现真实桌面操控与技能接入',
      target: '全链路打通 Windows-MCP 与技能迁移',
      confirmedRequirements: ['主模型仅决策与设计', '子代理均为叶节点'],
      prohibitedProposals: ['禁止子代理派生子代理'],
    })

    expect(task.id).toBeTruthy()
    expect(task.phase).toBe('pending')
    expect(task.confirmedRequirements).toContain('主模型仅决策与设计')

    // 2. Generate Handoff Prompt
    const prompt = wb.generateHandoffPrompt(task.id)
    expect(prompt).toContain('工作区')
    expect(prompt).toContain('已确认要求')
    expect(prompt).toContain('主模型仅决策与设计')
    expect(prompt).toContain('已禁用方案')
    expect(prompt).toContain('禁止子代理派生子代理')

    // 3. Import External AI Report -> Claims MUST be marked as unverified and phase MUST NOT become accepted
    const withReport = wb.importExternalReport(task.id, {
      source: '外部实施 AI',
      summary: '声称已完成全部测试',
      rawReport: '所有任务均已成功执行完毕。',
      claims: ['声称已完成代码变更与测试'],
    })

    expect(withReport?.importedReports).toHaveLength(1)
    expect(withReport?.importedReports[0]?.verified).toBe(false)
    expect(withReport?.phase).not.toBe('accepted')

    // 4. Record Acceptance Evidence by Dual-Leaf Review
    const withEvidence = wb.recordAcceptanceEvidence(task.id, {
      command: 'pnpm test',
      exitCode: 0,
      leafInspector: 'gemini-leaf-1',
      secondaryLeafReviewer: 'gemini-leaf-2',
      judgment: 'passed',
      verifiedItems: ['Windows-MCP 连接', '技能路由'],
      unverifiedItems: [],
    })

    expect(withEvidence?.phase).toBe('accepted')
    expect(withEvidence?.acceptanceEvidence?.judgment).toBe('passed')
    expect(withEvidence?.acceptanceEvidence?.secondaryLeafReviewer).toBe('gemini-leaf-2')

    // 5. Workflow Templates
    const templates = wb.listTemplates()
    expect(templates.length).toBeGreaterThanOrEqual(4)
    expect(templates.map(t => t.id)).toContain('project-development')
    expect(templates.map(t => t.id)).toContain('software-debugging')
  })

  it('persists state across restarts and restores materials and tasks', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pw-persist-'))
    dirs.push(tmp)

    const wb1 = new PersonalWorkbench({ dataDirectory: tmp })
    const task = wb1.createTask({
      projectId: 'workspace-a',
      title: 'Persistent Task Alpha',
      target: 'Ensure full recovery after app relaunch',
      confirmedRequirements: ['Restore state accurately'],
    })

    wb1.addMaterial(task.id, {
      name: 'screenshot-verified.png',
      type: 'screenshot',
      source: 'CDP window capture',
      completeness: 'full',
      filePath: 'D:\\desktop\\personal-data\\evidence\\screenshots\\sample.png',
    })

    wb1.updateTask(task.id, { phase: 'waiting-user', currentBlockers: 'Waiting for token refresh' })

    // Simulate app restart by constructing new instance pointing to same directory
    const wb2 = new PersonalWorkbench({ dataDirectory: tmp })
    const loadedTask = wb2.getTask(task.id)

    expect(loadedTask).toBeTruthy()
    expect(loadedTask?.title).toBe('Persistent Task Alpha')
    expect(loadedTask?.phase).toBe('waiting-user')
    expect(loadedTask?.currentBlockers).toBe('Waiting for token refresh')
    expect(loadedTask?.materials).toHaveLength(1)
    expect(loadedTask?.materials[0]?.name).toBe('screenshot-verified.png')

    // Generate handoff prompt should include the material attachment
    const handoff = wb2.generateHandoffPrompt(task.id)
    expect(handoff).toContain('screenshot-verified.png')
    expect(handoff).toContain('CDP window capture')
  })

  it('supports all 7 required phase transitions cleanly', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pw-phases-'))
    dirs.push(tmp)
    const wb = new PersonalWorkbench({ dataDirectory: tmp })

    const task = wb.createTask({
      projectId: 'phase-test',
      title: 'Phase Transition Testing',
    })

    const phases: TaskPhase[] = [
      'pending',
      'in-progress',
      'waiting-user',
      'pending-acceptance',
      'failed-acceptance',
      'accepted',
      'canceled',
    ]

    for (const phase of phases) {
      const updated = wb.updateTask(task.id, { phase })
      expect(updated?.phase).toBe(phase)
    }
  })

  it('rejects acceptance when exitCode != 0 or failed/unverified items exist despite judgment: passed (R5)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pw-r5-'))
    dirs.push(tmp)
    const wb = new PersonalWorkbench({ dataDirectory: tmp })

    const task1 = wb.createTask({
      projectId: 'p1',
      title: 'Task with exitCode 1',
    })
    const res1 = wb.recordAcceptance(task1.id, {
      judgment: 'passed',
      exitCode: 1,
      notes: 'Passed according to caller, but exit code is 1',
    })
    expect(res1.phase).toBe('failed-acceptance')

    const task2 = wb.createTask({
      projectId: 'p2',
      title: 'Task with failed items',
    })
    const res2 = wb.recordAcceptance(task2.id, {
      judgment: 'passed',
      failedItems: ['Regression failure'],
    })
    expect(res2.phase).toBe('failed-acceptance')

    const task3 = wb.createTask({
      projectId: 'p3',
      title: 'Task with unverified items',
    })
    const res3 = wb.recordAcceptance(task3.id, {
      judgment: 'passed',
      unverifiedItems: ['Pending visual inspection'],
    })
    expect(res3.phase).toBe('pending-acceptance')

    // Cannot patch phase to accepted when failing evidence exists
    expect(() => {
      wb.updateTask(task1.id, { phase: 'accepted' })
    }).toThrow('failed or unverified')
  })

  it('enforces immutable fields and rejects invalid phase transitions (R5)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pw-transitions-'))
    dirs.push(tmp)
    const wb = new PersonalWorkbench({ dataDirectory: tmp })

    const task = wb.createTask({
      projectId: 'my-project',
      title: 'Immutable check',
    })

    // Cannot modify id
    expect(() => {
      wb.updateTask(task.id, { id: 'other-id' } as any)
    }).toThrow('Cannot modify immutable task field: id')

    // Cannot modify projectId
    expect(() => {
      wb.updateTask(task.id, { projectId: 'other-project' } as any)
    }).toThrow('Cannot modify immutable task field: projectId')

    // Cannot jump from pending to accepted directly
    expect(() => {
      wb.updateTask(task.id, { phase: 'accepted' })
    }).toThrow('Invalid phase transition')
  })

  it('auto-retrieves requirement memory rules and includes them in handoff prompt', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pw-mem-'))
    dirs.push(tmp)
    const fakeMemory = {
      search: (ws: string, query: string, limit?: number) => [
        { entry: { text: 'Rule: Always use isolated data directories' } },
        { entry: { text: 'Rule: Leaf nodes must not spawn subagents' } },
      ],
    }
    const wb = new PersonalWorkbench({ dataDirectory: tmp, memory: fakeMemory })
    const task = wb.createTask({
      projectId: 'proj-mem',
      sessionId: 'sess-12345',
      subtaskIds: ['sub-1', 'sub-2'],
      title: 'Task with rules',
      target: 'Verify memory inclusion',
    })

    expect(task.appliedRules).toContain('Rule: Always use isolated data directories')
    const prompt = wb.generateHandoffPrompt(task.id)
    expect(prompt).toContain('关联会话: sess-12345')
    expect(prompt).toContain('关联子任务: sub-1, sub-2')
    expect(prompt).toContain('Rule: Always use isolated data directories')
  })
})
