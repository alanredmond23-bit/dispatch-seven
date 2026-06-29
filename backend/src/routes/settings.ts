// routes/settings.ts — D7 Settings API
// Hono router mounted at /api/settings
// Provides CRUD for all D7Settings keys, agent config, env inspection, memory, and health

import { Hono } from 'hono';
import {
  getSettings,
  getSetting,
  updateSettings,
  setSetting,
  resetSettings,
  DEFAULTS,
  type D7Settings,
} from '../lib/settings.js';
import { supabase } from '../lib/supabase.js';
import type { AgentDomain } from '../lib/classifier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mask a secret-looking string value: show first 4 + last 4 chars */
function maskSecret(val: string): string {
  if (val.length <= 12) return '****';
  return `${val.slice(0, 4)}****${val.slice(-4)}`;
}

/** Redact settings keys whose values look like secrets before returning to client */
function redactSettings(settings: D7Settings): Record<string, unknown> {
  const SECRET_PATTERN = /key|secret|token|password|role|pat/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (SECRET_PATTERN.test(k) && typeof v === 'string') {
      out[k] = maskSecret(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const settingsRouter = new Hono();

// GET /api/settings — return full settings object (secrets masked)
settingsRouter.get('/', async (c) => {
  const settings = await getSettings();
  return c.json({ ok: true, data: redactSettings(settings) });
});

// PUT /api/settings — bulk update one or more keys
settingsRouter.put('/', async (c) => {
  let body: Partial<D7Settings>;
  try {
    body = await c.req.json<Partial<D7Settings>>();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  // Reject unknown keys
  const validKeys = new Set(Object.keys(DEFAULTS));
  const unknownKeys = Object.keys(body).filter((k) => !validKeys.has(k));
  if (unknownKeys.length) {
    return c.json({ ok: false, error: `Unknown settings keys: ${unknownKeys.join(', ')}` }, 400);
  }

  const updated = await updateSettings(body);
  return c.json({ ok: true, data: redactSettings(updated) });
});

// GET /api/settings/agents — list all agents with model + prompt preview
settingsRouter.get('/agents', async (c) => {
  const settings = await getSettings();
  const domains: AgentDomain[] = ['LEGAL', 'CODE', 'RESEARCH', 'SCHEDULER', 'ORCHESTRATOR'];

  const agents = domains.map((domain) => ({
    domain,
    model: settings.agentModelOverrides[domain] ?? settings.defaultModel,
    promptOverride: settings.agentPromptOverrides[domain] ?? null,
    systemPromptPreview: (settings.agentPromptOverrides[domain] ?? settings.systemPromptBase).slice(0, 120) + '…',
  }));

  return c.json({ ok: true, data: agents });
});

// PUT /api/settings/agents/:agent — update model or prompt for a single agent
settingsRouter.put('/agents/:agent', async (c) => {
  const agent = c.req.param('agent').toUpperCase() as AgentDomain;
  const validDomains = new Set(['LEGAL', 'CODE', 'RESEARCH', 'SCHEDULER', 'ORCHESTRATOR']);
  if (!validDomains.has(agent)) {
    return c.json({ ok: false, error: `Unknown agent domain: ${agent}` }, 400);
  }

  let body: { model?: string; promptOverride?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const settings = await getSettings();
  const patch: Partial<D7Settings> = {};

  if (body.model !== undefined) {
    patch.agentModelOverrides = { ...settings.agentModelOverrides, [agent]: body.model };
  }
  if (body.promptOverride !== undefined) {
    patch.agentPromptOverrides = { ...settings.agentPromptOverrides, [agent]: body.promptOverride };
  }

  const updated = await updateSettings(patch);
  return c.json({
    ok: true,
    data: {
      domain: agent,
      model: updated.agentModelOverrides[agent] ?? updated.defaultModel,
      promptOverride: updated.agentPromptOverrides[agent] ?? null,
    },
  });
});

// POST /api/settings/reset — reset all settings to DEFAULTS
settingsRouter.post('/reset', async (c) => {
  const defaults = await resetSettings();
  return c.json({ ok: true, data: redactSettings(defaults), message: 'Settings reset to defaults' });
});

// GET /api/settings/keys — list env var names with masked values
settingsRouter.get('/keys', (c) => {
  const relevantEnvKeys = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE',
    'ANTHROPIC_API_KEY',
    'MEM0_API_KEY',
    'INNGEST_EVENT_KEY',
    'INNGEST_SIGNING_KEY',
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_TENANT_ID',
    'VOYAGE_API_KEY',
  ];

  const keys = relevantEnvKeys.map((name) => {
    const val = process.env[name];
    return {
      name,
      set: Boolean(val),
      preview: val ? maskSecret(val) : null,
    };
  });

  return c.json({ ok: true, data: keys });
});

// GET /api/settings/memory — list recent Mem0 memories for userId
// Uses searchMemory(userId, query='') to surface stored memories
settingsRouter.get('/memory', async (c) => {
  const userId = c.req.query('userId') ?? 'default';
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  try {
    const { searchMemory } = await import('../lib/mem0.js');
    // Empty query returns recent memories from Mem0
    const memories = await searchMemory(userId, '', limit);
    return c.json({ ok: true, data: memories, userId });
  } catch (err) {
    return c.json({ ok: false, error: String(err), data: [] });
  }
});

// DELETE /api/settings/memory/:id — delete a specific memory
// Mem0 client exposes delete via client.delete(id) — thin wrapper here
settingsRouter.delete('/memory/:id', async (c) => {
  const memoryId = c.req.param('id');
  try {
    const memKey = process.env.MEM0_API_KEY;
    if (!memKey) return c.json({ ok: false, error: 'MEM0_API_KEY not set' }, 503);
    const MemoryClient = (await import('mem0ai')).default;
    const client = new MemoryClient({ apiKey: memKey });
    await (client as any).delete(memoryId);
    return c.json({ ok: true, deleted: memoryId });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// GET /api/settings/health — connectivity check for all external deps
settingsRouter.get('/health', async (c) => {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // Supabase
  const sbStart = Date.now();
  try {
    const { error } = await supabase.from('settings').select('key').limit(1);
    checks.supabase = { ok: !error, latencyMs: Date.now() - sbStart, error: error?.message };
  } catch (e) {
    checks.supabase = { ok: false, error: String(e) };
  }

  // Anthropic API (lightweight: just check env key is set, no actual call)
  checks.anthropic = { ok: Boolean(process.env.ANTHROPIC_API_KEY) };

  // Mem0 — check env key is present (no live call to avoid latency)
  checks.mem0 = { ok: Boolean(process.env.MEM0_API_KEY) };

  // Inngest (check env keys present)
  checks.inngest = {
    ok: Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY),
  };

  const allOk = Object.values(checks).every((c) => c.ok);
  return c.json({ ok: allOk, checks }, allOk ? 200 : 207);
});

// GET /api/settings/:key — get single setting value
settingsRouter.get('/:key', async (c) => {
  const key = c.req.param('key') as keyof D7Settings;
  if (!(key in DEFAULTS)) {
    return c.json({ ok: false, error: `Unknown settings key: ${key}` }, 404);
  }
  const value = await getSetting(key);
  return c.json({ ok: true, key, value });
});

// PUT /api/settings/:key — set single setting value
settingsRouter.put('/:key', async (c) => {
  const key = c.req.param('key') as keyof D7Settings;
  if (!(key in DEFAULTS)) {
    return c.json({ ok: false, error: `Unknown settings key: ${key}` }, 404);
  }

  let body: { value: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (!('value' in body)) {
    return c.json({ ok: false, error: 'Body must contain { "value": ... }' }, 400);
  }

  // Type-safe cast: trust the caller, Supabase stores jsonb
  await setSetting(key, body.value as D7Settings[typeof key]);
  return c.json({ ok: true, key, value: body.value });
});
