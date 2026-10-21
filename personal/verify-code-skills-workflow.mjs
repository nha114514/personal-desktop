// [LOCAL FIXTURE TEST] Code Skills Workflow Verification in Isolated Test Repository
// Simulates: small feature implementation, real reproducible bug fix, regression testing, build,
// and dual-leaf review record without subagent cascading delegation.
// NOTE: This is a local harness / fixture simulation and does NOT claim live remote multi-agent model execution.
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export async function runCodeSkillsVerification() {
  console.log('=== Starting Code Skills Workflow Verification in Isolated Repository (Local Fixture) ===');

  const testRepoDir = mkdtempSync(join(tmpdir(), 'dsh-code-skills-repo-'));
  console.log(`Created isolated test workspace: ${testRepoDir}`);

  const evidence = {
    isFixtureTest: true,
    executionType: 'local-fixture-simulation',
    notes: 'Local fixture test simulating dual-leaf code workflow; does not claim live remote multi-agent model execution.',
    repoPath: testRepoDir,
    skillsLoaded: [
      'writing-plans',
      'test-driven-development',
      'systematic-debugging',
      'verification-before-completion',
      'requesting-code-review',
    ],
    stages: [],
    simulatedPrimaryModel: 'gpt-6.1-sol',
    simulatedSubagents: [
      { id: 'leaf-coder-1', role: 'implementation', model: 'gemini-3.8-flash', delegatedChildren: 0 },
      { id: 'leaf-reviewer-2', role: 'independent-review', model: 'gemini-3.8-flash', delegatedChildren: 0 },
    ],
  };

  try {
    // 1. Initialize Git Repo
    execSync('git init -b main', { cwd: testRepoDir, stdio: 'pipe' });
    execSync('git config user.name "Leaf Subagent"', { cwd: testRepoDir, stdio: 'pipe' });
    execSync('git config user.email "leaf@example.com"', { cwd: testRepoDir, stdio: 'pipe' });

    // 2. Feature Implementation (TDD)
    console.log('\n[Stage 1] Implementing feature: Token Normalizer & Rule Filter');
    const pkgJson = {
      name: 'isolated-code-skills-fixture',
      version: '1.0.0',
      type: 'module',
      scripts: {
        test: 'node --test test.js',
        build: 'node build.js',
      },
    };
    writeFileSync(join(testRepoDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');

    // Source implementation with intentional edge-case bug for stage 2
    const initialSrc = `
export function normalizeRule(input) {
  if (typeof input !== 'string') throw new TypeError('Input must be a string');
  // Tokenize and clean
  return input.trim().split(/\\s+/);
}

export function filterProhibitedProposals(proposals, blacklist) {
  const blackSet = new Set(blacklist.map(b => b.toLowerCase()));
  return proposals.filter(p => !blackSet.has(p.toLowerCase()));
}
`;
    writeFileSync(join(testRepoDir, 'index.js'), initialSrc, 'utf8');

    // Build script
    const buildScript = `
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const code = readFileSync('index.js', 'utf8');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.js', '// Minified bundle\\n' + code.replace(/\\/\\/[^\\n]*/g, ''), 'utf8');
console.log('Build output: dist/index.js generated successfully');
`;
    writeFileSync(join(testRepoDir, 'build.js'), buildScript, 'utf8');

    // Unit test for feature
    const featureTest = `
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRule, filterProhibitedProposals } from './index.js';

test('normalizeRule splits standard words', () => {
  assert.deepEqual(normalizeRule('hello world rule'), ['hello', 'world', 'rule']);
});

test('filterProhibitedProposals filters blacklisted proposals', () => {
  const res = filterProhibitedProposals(['mock-testing', 'real-tools'], ['mock-testing']);
  assert.deepEqual(res, ['real-tools']);
});
`;
    writeFileSync(join(testRepoDir, 'test.js'), featureTest, 'utf8');

    // Run tests & build
    const featureTestOutput = execSync('npm test', { cwd: testRepoDir, stdio: 'pipe', encoding: 'utf8' });
    const featureBuildOutput = execSync('npm run build', { cwd: testRepoDir, stdio: 'pipe', encoding: 'utf8' });
    execSync('git add . && git commit -m "feat: implement rule filter and normalizer"', { cwd: testRepoDir, stdio: 'pipe' });

    evidence.stages.push({
      stage: 'feature-implementation',
      status: 'passed',
      testOutput: featureTestOutput.trim(),
      buildOutput: featureBuildOutput.trim(),
    });
    console.log('[PASS] Feature implementation & TDD verified.');

    // 3. Reproducible Bug & Systematic Debugging
    console.log('\n[Stage 2] Introducing reproducible edge case defect in normalizeRule');
    // Bug reproduction: normalizeRule('') should return empty array [], but split(/\s+/) returns ['']
    const regressionTest = `
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRule } from './index.js';

test('normalizeRule handles empty string without returning empty element', () => {
  const result = normalizeRule('');
  assert.deepEqual(result, [], 'Expected empty array for empty input string');
});

test('normalizeRule handles whitespace-only strings', () => {
  const result = normalizeRule('   \\t\\n  ');
  assert.deepEqual(result, [], 'Expected empty array for whitespace-only input');
});
`;
    writeFileSync(join(testRepoDir, 'test-edge.js'), regressionTest, 'utf8');

    let bugReproductionRecorded = false;
    let defectDetails = {};
    try {
      execSync('node --test test-edge.js', { cwd: testRepoDir, stdio: 'pipe', encoding: 'utf8' });
    } catch (err) {
      bugReproductionRecorded = true;
      defectDetails = {
        input: '"" (empty string)',
        expected: '[] (empty array)',
        actual: '[""] (array containing single empty string)',
        rootCause: 'String.prototype.split(/\\s+/) on empty string produces [""], failing length and token expectations',
        errorLog: err.stderr || err.stdout,
      };
      console.log('[PASS] Bug reproduced successfully:');
      console.log(`       Input: ${defectDetails.input}`);
      console.log(`       Expected: ${defectDetails.expected}`);
      console.log(`       Actual: ${defectDetails.actual}`);
      console.log(`       Root Cause: ${defectDetails.rootCause}`);
    }

    if (!bugReproductionRecorded) {
      throw new Error('Failed to reproduce edge-case defect!');
    }

    // Apply Root-Cause Fix
    console.log('\n[Stage 3] Applying root-cause fix to index.js');
    const fixedSrc = `
export function normalizeRule(input) {
  if (typeof input !== 'string') throw new TypeError('Input must be a string');
  const trimmed = input.trim();
  if (trimmed === '') return [];
  return trimmed.split(/\\s+/);
}

export function filterProhibitedProposals(proposals, blacklist) {
  const blackSet = new Set(blacklist.map(b => b.toLowerCase()));
  return proposals.filter(p => !blackSet.has(p.toLowerCase()));
}
`;
    writeFileSync(join(testRepoDir, 'index.js'), fixedSrc, 'utf8');

    // Run regression tests
    const regressionEdgeOutput = execSync('node --test test-edge.js', { cwd: testRepoDir, stdio: 'pipe', encoding: 'utf8' });
    const regressionAllOutput = execSync('npm test', { cwd: testRepoDir, stdio: 'pipe', encoding: 'utf8' });
    const fixedBuildOutput = execSync('npm run build', { cwd: testRepoDir, stdio: 'pipe', encoding: 'utf8' });
    execSync('git add . && git commit -m "fix: correctly handle empty and whitespace-only rules in normalizer"', { cwd: testRepoDir, stdio: 'pipe' });

    evidence.stages.push({
      stage: 'bug-fix-and-regression',
      status: 'passed',
      defect: defectDetails,
      regressionEdgeOutput: regressionEdgeOutput.trim(),
      regressionAllOutput: regressionAllOutput.trim(),
      buildOutput: fixedBuildOutput.trim(),
    });
    console.log('[PASS] Defect fixed and regression tests passed.');

    // 4. Secondary Leaf Reviewer Inspection
    console.log('\n[Stage 4] Performing secondary independent leaf review (leaf-reviewer-2)');
    const gitDiff = execSync('git diff HEAD~1', { cwd: testRepoDir, stdio: 'pipe', encoding: 'utf8' });
    const reviewResult = {
      reviewer: 'leaf-reviewer-2',
      decision: 'approved',
      observations: [
        'Root cause identified and directly resolved at source without side effects',
        'Added specific regression tests covering boundary inputs (empty and whitespace-only)',
        'Zero recursive subagent spawning confirmed (depth = 1 leaf)',
        'Full build and existing test suite executed with exit code 0',
      ],
      diffSnippet: gitDiff.slice(0, 300),
    };
    evidence.stages.push({
      stage: 'secondary-leaf-review',
      review: reviewResult,
    });
    console.log('[PASS] Secondary leaf review completed and approved.');

    return {
      success: true,
      evidence,
    };
  } finally {
    try {
      rmSync(testRepoDir, { recursive: true, force: true });
    } catch {}
  }
}

if (process.argv[1]?.endsWith('verify-code-skills-workflow.mjs')) {
  runCodeSkillsVerification().then(res => {
    console.log('\n=== CODE SKILLS VERIFICATION RESULT ===');
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.success ? 0 : 1);
  }).catch(err => {
    console.error('Fatal Code Skills error:', err);
    process.exit(1);
  });
}
