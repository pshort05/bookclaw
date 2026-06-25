// Shared studio provider list + per-provider default model (placeholder hints).
// Keep AI_PROVIDERS in sync with CONSISTENCY_PROVIDERS in
// gateway/src/services/consistency/model-selection.ts (cross-package; can't import gateway TS).
export const AI_PROVIDERS = ['gemini', 'deepseek', 'claude', 'openai', 'ollama', 'openrouter'] as const;
export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  gemini: 'gemini-2.5-flash', deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o', ollama: 'llama3.2', openrouter: 'anthropic/claude-sonnet-4-5',
};
