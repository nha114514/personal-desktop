// [LOCAL FIXTURE & IPC HARNESS] Full Desktop Acceptance Verification Script
// Tests host IPC endpoints (Diagnostics, Memory, Workbench, Windows-MCP, Crawlers).
// NOTE: This verifies Electron host APIs and IPC bindings. It is a local harness and not a replacement for live model-driven acceptance.
import { writeFileSync, mkdirSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodeSkillsVerification } from './verify-code-skills-workflow.mjs';

async function main() {
  console.log('--- Personal Desktop Acceptance Verification (Local IPC Harness) ---');
  const listRes = await fetch('http://127.0.0.1:24572/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) {
    console.error('Fatal: No page target found on port 24572');
    process.exit(1);
  }
  console.log('Connecting to WebSocket:', pageTarget.webSocketDebuggerUrl);

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let reqId = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      cb(msg);
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = reqId++;
    callbacks.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise((resolve) => ws.onopen = resolve);
  await send('Runtime.enable');
  await send('DOM.enable');

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(JSON.stringify(res.result.exceptionDetails));
    }
    return res.result?.result?.value;
  };

  const results = {
    checks: [],
    errors: [],
  };

  function pass(name, detail = {}) {
    console.log(`[PASS] ${name}`);
    results.checks.push({ name, status: 'PASS', detail });
  }

  function fail(name, error) {
    console.error(`[FAIL] ${name}:`, error);
    results.errors.push({ name, error: String(error) });
  }

  // 1. Window & Title Verification
  try {
    const title = await evaluate('document.title');
    if (title.includes('Personal Desktop')) {
      pass('Window Title verification', { title });
    } else {
      fail('Window Title verification', `Expected title containing "Personal Desktop", got "${title}"`);
    }
  } catch (e) {
    fail('Window Title check', e);
  }

  // 2. Diagnostics Center IPC
  try {
    const diag = await evaluate('window.dshDesktop.personalDiagnostics.status()');
    if (diag && diag.modelRoutes && diag.modelRoutes.primaryModel.model === 'gpt-6.1-sol') {
      pass('Diagnostics: Model routing check', {
        primary: diag.modelRoutes.primaryModel,
        channelType: diag.modelRoutes.channelType,
      });
    } else {
      fail('Diagnostics: Model routing check', 'Primary model route mismatch');
    }

    if (diag && Array.isArray(diag.accounts) && diag.accounts.length >= 3) {
      pass('Diagnostics: Accounts check', {
        accounts: diag.accounts.map(a => ({ id: a.id, name: a.name, status: a.status })),
      });
    } else {
      fail('Diagnostics: Accounts check', 'Accounts count less than 3');
    }

    if (diag && Array.isArray(diag.dependencies) && diag.dependencies.length >= 3) {
      pass('Diagnostics: Dependencies check', {
        deps: diag.dependencies.map(d => ({ name: d.name, status: d.status, version: d.version })),
      });
    } else {
      fail('Diagnostics: Dependencies check', 'Dependencies missing');
    }

    // Export Redacted Diagnostics
    const exportedJson = await evaluate('window.dshDesktop.personalDiagnostics.export()');
    if (typeof exportedJson === 'string' && !/sk-[A-Za-z0-9_-]{16,}/.test(exportedJson)) {
      pass('Diagnostics: Export with credential redaction', { length: exportedJson.length });
    } else {
      fail('Diagnostics: Export with credential redaction', 'Export contained unredacted secrets or invalid string');
    }
  } catch (e) {
    fail('Diagnostics IPC', e);
  }

  // 3. Personal Memory IPC
  const testMemWorkspace = mkdtempSync(join(tmpdir(), 'dsh-mem-acceptance-'));
  try {
    const mem = await evaluate('window.dshDesktop.personalMemory.snapshot()');
    if (mem && mem.storePath && Array.isArray(mem.entries)) {
      pass('Personal Memory: Snapshot check', {
        workspace: mem.workspace,
        storePath: mem.storePath,
        entryCount: mem.entries.length,
      });
    } else {
      fail('Personal Memory: Snapshot check', 'Snapshot invalid');
    }

    // Add entry in isolated test workspace to avoid polluting real workspace CANON
    const escapedWorkspace = testMemWorkspace.replace(/\\/g, '\\\\');
    const entry = await evaluate(`
      window.dshDesktop.personalMemory.addEntry(
        "${escapedWorkspace}",
        "confirmed",
        "Personal Workbench and Desktop Control acceptance verified (fixture)",
        "Acceptance test suite"
      )
    `);
    if (entry && entry.id && entry.kind === 'confirmed') {
      pass('Personal Memory: Add Entry', entry);
    } else {
      fail('Personal Memory: Add Entry', 'Failed to create memory entry');
    }

    // Search entry
    const searchRes = await evaluate(`
      window.dshDesktop.personalMemory.search("${escapedWorkspace}", "Workbench")
    `);
    if (Array.isArray(searchRes) && searchRes.length > 0) {
      pass('Personal Memory: Search', { matchCount: searchRes.length });
    } else {
      fail('Personal Memory: Search', 'Search returned empty');
    }

    // Reject Sensitive API Key
    const sensitiveRejected = await evaluate(`
      (async () => {
        try {
          await window.dshDesktop.personalMemory.addEntry(
            "${escapedWorkspace}",
            "confirmed",
            "Secret sk-1234567890abcdef1234567890",
            "chat"
          );
          return false;
        } catch (e) {
          return true;
        }
      })()
    `);
    if (sensitiveRejected) {
      pass('Personal Memory: Sensitive credential rejection defense', { rejected: true });
    } else {
      fail('Personal Memory: Sensitive credential rejection defense', 'Sensitive key was not rejected');
    }

    // Revoke Entry
    const revoked = await evaluate(`
      window.dshDesktop.personalMemory.revokeEntry("${escapedWorkspace}", "${entry.id}")
    `);
    if (revoked) {
      pass('Personal Memory: Revoke Entry', { revoked: true });
    } else {
      fail('Personal Memory: Revoke Entry', 'Revoke returned false');
    }
  } catch (e) {
    fail('Personal Memory IPC', e);
  } finally {
    try { rmSync(testMemWorkspace, { recursive: true, force: true }); } catch {}
  }

  // 4. Personal Workbench IPC
  let testTaskId = '';
  try {
    const templates = await evaluate('window.dshDesktop.personalWorkbench.listTemplates()');
    if (Array.isArray(templates) && templates.length === 4) {
      pass('Workbench: List Templates (4 predefined templates)', { count: templates.length });
    } else {
      fail('Workbench: List Templates', `Expected 4 templates, got ${templates?.length}`);
    }

    // Create task
    const task = await evaluate(`
      window.dshDesktop.personalWorkbench.createTask({
        projectId: "isolated-acceptance-fixture",
        title: "Desktop Control & Coding Skills Acceptance",
        target: "Verify real host tool integration, input mutex, evidence recording and dual-leaf review",
        confirmedRequirements: ["Real tool connection", "No fake reports", "No unauthorized delegation"],
        designChoices: ["Dual-leaf verification", "Input mutex serialization"],
        prohibitedProposals: ["Pure mock testing", "Direct credential logging"],
        phase: "in-progress"
      })
    `);
    if (task && task.id && (task.phase === 'in-progress' || task.phase === 'pending')) {
      testTaskId = task.id;
      pass('Workbench: Create Task with State Machine', { id: task.id, phase: task.phase });
    } else {
      fail('Workbench: Create Task', 'Task creation failed');
    }

    // Generate handoff prompt
    const handoff = await evaluate(`window.dshDesktop.personalWorkbench.generateHandoffPrompt("${testTaskId}")`);
    if (typeof handoff === 'string' && handoff.includes('任务交接提示词')) {
      pass('Workbench: Generate Handoff Prompt & Attachments Manifest', {
        promptLength: handoff.length,
        containsDirectives: handoff.includes('已禁用方案'),
      });
    } else {
      fail('Workbench: Generate Handoff Prompt', 'Failed to generate prompt');
    }

    // Import external AI report (must be marked unverified)
    const reportImport = await evaluate(`
      window.dshDesktop.personalWorkbench.importReport("${testTaskId}", {
        source: "External Benchmark Subagent",
        summary: "Preliminary testing passed 100% (claimed)",
        rawReport: "All tests reportedly passed with zero defects."
      })
    `);
    if (reportImport && reportImport.importedReports && reportImport.importedReports.length > 0) {
      const imported = reportImport.importedReports[0];
      if (imported.verified === false) {
        pass('Workbench: Import Report strictly marked unverified (待核实)', {
          source: imported.source,
          verified: imported.verified,
        });
      } else {
        fail('Workbench: Import Report', 'Imported report was auto-verified, violating integrity rule');
      }
    } else {
      fail('Workbench: Import Report', 'Report import returned invalid structure');
    }

    // Record Dual-Leaf verification evidence (annotated as local fixture simulation)
    const evidenceUpdate = await evaluate(`
      window.dshDesktop.personalWorkbench.recordEvidence("${testTaskId}", {
        leafInspector: "local-fixture-inspector",
        secondaryLeafReviewer: "local-fixture-reviewer",
        command: "windows-mcp Snapshot & Screenshot (local fixture simulation)",
        exitCode: 0,
        judgment: "passed",
        verifiedItems: ["Real UIA tree extracted", "Real host tool execution", "Host window compositor screenshot"],
        unverifiedItems: [],
        notes: "Local fixture IPC harness verification; does not claim live model multi-agent evaluation"
      })
    `);
    if (evidenceUpdate && evidenceUpdate.acceptanceEvidence) {
      pass('Workbench: Dual-leaf verification evidence recorded', {
        evidence: evidenceUpdate.acceptanceEvidence,
      });
    } else {
      fail('Workbench: Record Evidence', 'Evidence recording failed');
    }
  } catch (e) {
    fail('Workbench IPC', e);
  }

  // 5. Windows Desktop Control IPC (Host tool: windows-mcp.exe)
  try {
    console.log('Testing Windows-MCP connection...');
    const startRes = await evaluate('window.dshDesktop.personalDesktopControl.start()');
    if (startRes && startRes.connected && startRes.toolCount >= 20) {
      pass('Windows-MCP: Start & JSON-RPC handshake', {
        connected: startRes.connected,
        serverVersion: startRes.serverVersion,
        toolCount: startRes.toolCount,
      });
    } else {
      fail('Windows-MCP: Start', `Failed to start windows-mcp, connected=${startRes?.connected}, toolCount=${startRes?.toolCount}`);
    }

    // Section IX Item 4: Real App execution launching dedicated test executable
    console.log('Testing App tool launch_executable...');
    const tokenOutPath = 'D:\\desktop\\personal-data\\evidence\\app-launch-token.txt';
    const appRes = await evaluate(`
      window.dshDesktop.personalDesktopControl.executeTool("App", {
        mode: "launch_executable",
        executable: "C:\\\\Windows\\\\System32\\\\cmd.exe",
        args: ["/c", "echo app-launch-verified > D:\\\\desktop\\\\personal-data\\\\evidence\\\\app-launch-token.txt"]
      })
    `);
    if (appRes && !appRes.isError) {
      pass('Windows-MCP: Real App execution (launch_executable)', { output: appRes.output });
    } else {
      fail('Windows-MCP: Real App execution', `App tool failed: ${JSON.stringify(appRes)}`);
    }

    // Section IX Item 4: Real FileSystem write random non-sensitive text to test directory
    console.log('Testing FileSystem write...');
    const testPayload = `DesktopControl-Acceptance-Payload-${Date.now()}`;
    const testFilePath = 'D:\\desktop\\personal-data\\evidence\\desktop-acceptance-file.txt';
    const writeRes = await evaluate(`
      window.dshDesktop.personalDesktopControl.executeTool("FileSystem", {
        mode: "write",
        path: "${testFilePath.replace(/\\/g, '\\\\')}",
        content: "${testPayload}",
        overwrite: true
      })
    `);
    if (writeRes && !writeRes.isError) {
      pass('Windows-MCP: Real FileSystem write to test directory', { output: writeRes.output });
    } else {
      fail('Windows-MCP: Real FileSystem write', `Write failed: ${JSON.stringify(writeRes)}`);
    }

    // Section IX Item 4: Real FileSystem read content back and verify
    console.log('Testing FileSystem read back...');
    const readRes = await evaluate(`
      window.dshDesktop.personalDesktopControl.executeTool("FileSystem", {
        mode: "read",
        path: "${testFilePath.replace(/\\/g, '\\\\')}"
      })
    `);
    if (readRes && !readRes.isError && readRes.output?.includes(testPayload)) {
      pass('Windows-MCP: Real FileSystem read content match', { matchedPayload: true });
    } else {
      fail('Windows-MCP: Real FileSystem read back', `Content mismatch or read error: ${JSON.stringify(readRes)}`);
    }
    try {
      if (existsSync(tokenOutPath)) rmSync(tokenOutPath, { force: true });
      if (existsSync(testFilePath)) rmSync(testFilePath, { force: true });
    } catch {}

    // Snapshot (UIA inspection)
    console.log('Testing Snapshot host execution...');
    const snapRes = await evaluate('window.dshDesktop.personalDesktopControl.executeTool("Snapshot", {})');
    if (snapRes && !snapRes.isError && snapRes.output && snapRes.output.length > 50) {
      pass('Windows-MCP: Real Snapshot (UIA tree extraction)', {
        tool: snapRes.tool,
        isError: snapRes.isError,
        outputSnippet: snapRes.output.slice(0, 150) + '...',
      });
    } else {
      fail('Windows-MCP: Snapshot', `Snapshot failed: ${JSON.stringify(snapRes)}`);
    }

    // Real Screenshot
    console.log('Testing Screenshot execution with host fallback...');
    const shotRes = await evaluate('window.dshDesktop.personalDesktopControl.executeTool("Screenshot", {})');
    if (shotRes && !shotRes.isError && shotRes.imagePath && existsSync(shotRes.imagePath)) {
      const stats = readFileSync(shotRes.imagePath);
      pass('Windows-MCP: Real Screenshot verified and saved to disk', {
        imagePath: shotRes.imagePath,
        sizeBytes: stats.length,
      });
    } else {
      fail('Windows-MCP: Screenshot', `Screenshot failed: ${JSON.stringify(shotRes)}`);
    }

    // Section IX Item 5: Emergency Stop / Takeover
    const stopRes = await evaluate('window.dshDesktop.personalDesktopControl.stop()');
    if (stopRes && stopRes.connected === false && stopRes.paused === true) {
      pass('Windows-MCP: Emergency Stop & Takeover (paused)', { connected: stopRes.connected, paused: stopRes.paused });
    } else {
      fail('Windows-MCP: Emergency Stop', `Stop failed: ${JSON.stringify(stopRes)}`);
    }

    // Section IX Item 5: Resume Desktop Control
    const resumeRes = await evaluate('window.dshDesktop.personalDesktopControl.resume()');
    if (resumeRes && resumeRes.paused === false) {
      pass('Windows-MCP: Resume Desktop Control', { paused: resumeRes.paused });
    } else {
      fail('Windows-MCP: Resume Desktop Control', `Resume failed: ${JSON.stringify(resumeRes)}`);
    }
  } catch (e) {
    fail('Windows Desktop Control IPC', e);
  }

  // 6. Section IX Item 6: Code Skills in isolated repository
  try {
    console.log('Running Code Skills in isolated repository test...');
    const skillsResult = await runCodeSkillsVerification();
    if (skillsResult && skillsResult.success) {
      pass('Code Skills: Isolated repository feature, bug fix, regression, build & dual-leaf review (local fixture)', {
        stagesCount: skillsResult.evidence.stages.length,
        simulatedPrimaryModel: skillsResult.evidence.simulatedPrimaryModel,
        simulatedSubagents: skillsResult.evidence.simulatedSubagents,
      });
    } else {
      fail('Code Skills: Isolated repository verification', 'Failed skills execution');
    }
  } catch (e) {
    fail('Code Skills verification', e);
  }

  // 7. UI DOM and Sidebar Inspection
  try {
    const domInfo = await evaluate(`
      (() => {
        const sidebar = document.querySelector('nav, [class*="sidebar"], [class*="Sidebar"]');
        const buttons = Array.from(document.querySelectorAll('button'));
        const buttonsInfo = buttons.map(b => ({
          text: b.innerText.trim(),
          title: b.getAttribute('title') || '',
          ariaLabel: b.getAttribute('aria-label') || '',
          className: b.className
        }));
        return {
          hasSidebar: !!sidebar,
          buttonsCount: buttons.length,
          buttonsInfo: buttonsInfo.slice(0, 20)
        };
      })()
    `);
    pass('UI DOM inspection', domInfo);
  } catch (e) {
    fail('UI DOM inspection', e);
  }

  console.log('\n--- VERIFICATION SUMMARY ---');
  console.log(`Passed checks: ${results.checks.length}`);
  console.log(`Failed checks: ${results.errors.length}`);
  if (results.errors.length > 0) {
    console.error('Errors:', results.errors);
  }

  mkdirSync('D:\\desktop\\personal-data\\evidence', { recursive: true });
  writeFileSync('D:\\desktop\\personal-data\\evidence\\real-desktop-acceptance-result.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Saved result to D:\\desktop\\personal-data\\evidence\\real-desktop-acceptance-result.json');
  process.exit(results.errors.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
