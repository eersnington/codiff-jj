import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const {
  detectInitialAgentBackend,
  getAgent,
  getAgentMenuModels,
  listAgents,
  normalizeAgentBackend,
} = require('../agent.cjs') as {
  detectInitialAgentBackend: (
    isAvailable?: (agent: { id: 'codex' | 'claude' | 'opencode' | 'pi' }) => boolean,
  ) => string;
  getAgent: (backendId: unknown) => {
    id: string;
    isAvailable: () => boolean;
    label: string;
    models: ReadonlyArray<{ id: string; label: string }>;
    modelSettingKey: string;
    sessionLaunchOptionKey: string;
    notFoundCode: string;
    run: unknown;
    readSessionContext: unknown;
  };
  getAgentMenuModels: (
    agent: ReturnType<typeof getAgent>,
    selectedModel: string,
    models?: ReadonlyArray<{ id: string; label: string }>,
  ) => ReadonlyArray<{ id: string; label: string }>;
  listAgents: () => ReadonlyArray<{ id: string }>;
  normalizeAgentBackend: (value: unknown) => string;
};

test('normalizes unknown agent backends to the default', () => {
  expect(normalizeAgentBackend('claude')).toBe('claude');
  expect(normalizeAgentBackend('codex')).toBe('codex');
  expect(normalizeAgentBackend('opencode')).toBe('opencode');
  expect(normalizeAgentBackend('pi')).toBe('pi');
  expect(normalizeAgentBackend('gpt')).toBe('codex');
  expect(normalizeAgentBackend(undefined)).toBe('codex');
});

test('lists all agent backends', () => {
  expect(listAgents().map((agent) => agent.id)).toEqual(['codex', 'claude', 'opencode', 'pi']);
});

test('detects the first available agent backend in priority order', () => {
  const checked: Array<string> = [];
  const backend = detectInitialAgentBackend((agent) => {
    checked.push(agent.id);
    return agent.id === 'opencode';
  });

  expect(backend).toBe('opencode');
  expect(checked).toEqual(['codex', 'claude', 'opencode']);
});

test('falls back to Codex when no agent backend is installed', () => {
  expect(detectInitialAgentBackend(() => false)).toBe('codex');
});

test('resolves the Codex agent with its session wiring', () => {
  const agent = getAgent('codex');
  expect(agent.id).toBe('codex');
  expect(agent.modelSettingKey).toBe('openAIModel');
  expect(agent.sessionLaunchOptionKey).toBe('codexSessionId');
  expect(agent.notFoundCode).toBe('CODEX_NOT_FOUND');
  expect(typeof agent.isAvailable).toBe('function');
  expect(typeof agent.run).toBe('function');
  expect(typeof agent.readSessionContext).toBe('function');
});

test('resolves the Claude Code agent with its session wiring', () => {
  const agent = getAgent('claude');
  expect(agent.id).toBe('claude');
  expect(agent.label).toBe('Claude Code');
  expect(agent.modelSettingKey).toBe('claudeModel');
  expect(agent.sessionLaunchOptionKey).toBe('claudeSessionId');
  expect(agent.notFoundCode).toBe('CLAUDE_NOT_FOUND');
});

test('resolves the Pi agent with its session wiring', () => {
  const agent = getAgent('pi');
  expect(agent.id).toBe('pi');
  expect(agent.label).toBe('Pi');
  expect(agent.modelSettingKey).toBe('piModel');
  expect(agent.sessionLaunchOptionKey).toBe('piSessionId');
  expect(agent.notFoundCode).toBe('PI_NOT_FOUND');
  expect(typeof agent.run).toBe('function');
  expect(typeof agent.readSessionContext).toBe('function');
});

test('resolves the OpenCode agent with its runtime wiring', () => {
  const agent = getAgent('opencode');
  expect(agent.id).toBe('opencode');
  expect(agent.label).toBe('OpenCode');
  expect(agent.modelSettingKey).toBe('opencodeModel');
  expect(agent.sessionLaunchOptionKey).toBe('opencodeSessionId');
  expect(agent.notFoundCode).toBe('OPENCODE_NOT_FOUND');
  expect(typeof agent.run).toBe('function');
  expect(typeof agent.readSessionContext).toBe('function');
});

test('shows a custom configured model in the agent model menu', () => {
  const agent = getAgent('opencode');

  expect(getAgentMenuModels(agent, 'anthropic/claude-sonnet-4-6')).toBe(agent.models);
  expect(getAgentMenuModels(agent, 'cloudflare/custom-model')).toEqual([
    ...agent.models,
    { id: 'cloudflare/custom-model', label: 'Custom: cloudflare/custom-model' },
  ]);
});

test('shows the models reported by the agent CLI and keeps a retired selection', () => {
  const agent = getAgent('codex');
  const reported = [
    { id: 'codex-default', label: 'Codex default' },
    { id: 'gpt-6-sol', label: 'GPT-6-Sol' },
  ];

  expect(getAgentMenuModels(agent, 'gpt-6-sol', reported)).toBe(reported);
  expect(getAgentMenuModels(agent, 'gpt-5.6-terra', reported)).toEqual([
    ...reported,
    { id: 'gpt-5.6-terra', label: 'Custom: gpt-5.6-terra' },
  ]);
});

test('falls back to the default backend for unknown ids', () => {
  expect(getAgent('unknown').id).toBe('codex');
});
