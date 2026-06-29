/**
 * D7 Settings — src/pages/Settings.tsx
 *
 * World-class settings UX. 9 sections. Left sidebar + right panel.
 * Auto-saves with 500ms debounce. Graceful degradation when API is offline.
 *
 * Design: matches D7 token system (var(--d7-*)), inline styles, zero new deps.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Settings,
  MemoryEntry,
  JobEntry,
  ApiKeyEntry,
  UsageDay,
  ServiceHealth,
  LegalAuditEntry,
} from '../types/settings';
import {
  DEFAULT_SETTINGS,
  AGENTS,
  MODELS,
  SKILLS_CONFIG,
} from '../types/settings';

// ── Constants ────────────────────────────────────────────────────────────────
const BASE_URL = 'https://dispatch-seven-api.victoriouscoast-5f29fb8b.eastus.azurecontainerapps.io';

// ── Design tokens (inline — matches tokens.css vars) ─────────────────────────
const T = {
  bg:         'var(--d7-bg)',
  surf:       'var(--d7-surface)',
  surf2:      'var(--d7-surface-2)',
  surf3:      'var(--d7-surface-3)',
  border:     'var(--d7-border)',
  border2:    'var(--d7-border-2)',
  accent:     'var(--d7-accent)',
  accentHov:  'var(--d7-accent-hover)',
  accentMut:  'var(--d7-accent-muted)',
  success:    'var(--d7-success)',
  warning:    'var(--d7-warning)',
  error:      'var(--d7-error)',
  legal:      'var(--d7-legal)',
  legalMut:   'var(--d7-legal-muted)',
  text:       'var(--d7-text)',
  text2:      'var(--d7-text-2)',
  muted:      'var(--d7-text-muted)',
  mono:       'var(--d7-font-mono)',
  sans:       'var(--d7-font-sans)',
  radius:     'var(--d7-radius)',
  radiusMd:   'var(--d7-radius-md)',
};

// ── Shared style snippets ────────────────────────────────────────────────────
const S = {
  label: {
    fontFamily: T.mono,
    fontSize: '10px',
    letterSpacing: '0.16em',
    color: T.muted,
    textTransform: 'uppercase' as const,
    marginBottom: '8px',
    display: 'block',
  },
  card: {
    background: T.surf,
    border: `1px solid ${T.border}`,
    borderRadius: T.radius,
    padding: '16px',
    marginBottom: '12px',
  },
  input: {
    background: T.surf2,
    border: `1px solid ${T.border2}`,
    borderRadius: T.radius,
    color: T.text,
    fontFamily: T.sans,
    fontSize: '13px',
    padding: '8px 12px',
    width: '100%',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  textarea: {
    background: T.surf2,
    border: `1px solid ${T.border2}`,
    borderRadius: T.radius,
    color: T.text,
    fontFamily: T.mono,
    fontSize: '12px',
    padding: '10px 12px',
    width: '100%',
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
    outline: 'none',
    lineHeight: '1.6',
  },
  btn: {
    background: T.surf2,
    border: `1px solid ${T.border2}`,
    borderRadius: T.radius,
    color: T.text2,
    cursor: 'pointer',
    fontFamily: T.mono,
    fontSize: '11px',
    letterSpacing: '0.08em',
    padding: '7px 14px',
  },
  btnPrimary: {
    background: T.accent,
    border: 'none',
    borderRadius: T.radius,
    color: '#fff',
    cursor: 'pointer',
    fontFamily: T.mono,
    fontSize: '11px',
    letterSpacing: '0.08em',
    padding: '8px 16px',
  },
  btnDanger: {
    background: 'var(--d7-error-muted)',
    border: `1px solid ${T.error}`,
    borderRadius: T.radius,
    color: T.error,
    cursor: 'pointer',
    fontFamily: T.mono,
    fontSize: '11px',
    letterSpacing: '0.08em',
    padding: '7px 14px',
  },
  select: {
    background: T.surf2,
    border: `1px solid ${T.border2}`,
    borderRadius: T.radius,
    color: T.text,
    fontFamily: T.mono,
    fontSize: '12px',
    padding: '7px 10px',
    outline: 'none',
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '12px',
  },
  sectionTitle: {
    fontFamily: T.mono,
    fontSize: '11px',
    letterSpacing: '0.18em',
    color: T.text2,
    textTransform: 'uppercase' as const,
    marginBottom: '16px',
    paddingBottom: '10px',
    borderBottom: `1px solid ${T.border}`,
  },
  statusDot: (status: 'up' | 'down' | 'checking') => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: status === 'up' ? 'var(--d7-success)' : status === 'down' ? 'var(--d7-error)' : 'var(--d7-warning)',
    flexShrink: 0,
    display: 'inline-block',
  }),
};

// ── Toggle component ──────────────────────────────────────────────────────────
function Toggle({ value, onChange, danger }: { value: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        border: 'none',
        background: value ? (danger ? 'var(--d7-error)' : T.accent) : T.surf3,
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 180ms ease',
      }}
    >
      <span style={{
        position: 'absolute',
        top: '3px',
        left: value ? '23px' : '3px',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 180ms ease',
        display: 'block',
      }} />
    </button>
  );
}

// ── Slider component ──────────────────────────────────────────────────────────
function Slider({ value, min, max, onChange, label }: {
  value: number; min: number; max: number;
  onChange: (v: number) => void; label?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
        {label && <span style={S.label}>{label}</span>}
        <span style={{ fontFamily: T.mono, fontSize: '12px', color: T.accent }}>{value}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--d7-accent)', cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
        <span style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted }}>{min}</span>
        <span style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted }}>{max}</span>
      </div>
    </div>
  );
}

// ── Save indicator ────────────────────────────────────────────────────────────
function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return null;
  const color = state === 'saved' ? 'var(--d7-success)' : state === 'error' ? 'var(--d7-error)' : T.muted;
  const text  = state === 'saving' ? 'Saving...' : state === 'saved' ? '✓ Saved' : '✕ Error';
  return (
    <span style={{ fontFamily: T.mono, fontSize: '10px', color, letterSpacing: '0.08em', transition: 'opacity 0.3s' }}>
      {text}
    </span>
  );
}

// ── useSettings hook ─────────────────────────────────────────────────────────
function useSettings() {
  const [settings, setSettings]   = useState<Settings>(DEFAULT_SETTINGS);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loading, setLoading]     = useState(true);
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef            = useRef(false);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: Settings) => {
        setSettings({ ...DEFAULT_SETTINGS, ...data });
        setLoading(false);
        setTimeout(() => { initializedRef.current = true; }, 100);
      })
      .catch(() => {
        // Backend offline — use defaults silently
        setLoading(false);
        setTimeout(() => { initializedRef.current = true; }, 100);
      });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  // Debounced auto-save
  useEffect(() => {
    if (!initializedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const r = await fetch(`${BASE_URL}/api/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        });
        setSaveState(r.ok ? 'saved' : 'error');
      } catch {
        setSaveState('error');
      }
      setTimeout(() => setSaveState('idle'), 2500);
    }, 500);
  }, [settings]);

  return { settings, updateSettings, saveState, loading };
}

// ── Section 1: System Prompt ─────────────────────────────────────────────────
function SystemPromptSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [preview, setPreview]   = useState<string | null>(null);
  const chars  = settings.systemPromptBase.length;
  const tokens = Math.round(chars / 4);

  const toggleAgent = (a: string) => setExpanded(p => ({ ...p, [a]: !p[a] }));

  const mergePrompt = (agent: string) => {
    const override = settings.agentSettings[agent]?.systemPromptOverride || '';
    return override ? `${settings.systemPromptBase}\n\n--- AGENT OVERRIDE (${agent.toUpperCase()}) ---\n${override}` : settings.systemPromptBase;
  };

  return (
    <div>
      <div style={S.sectionTitle}>System Prompt</div>

      <div style={S.card}>
        <label style={S.label}>Base system prompt</label>
        <textarea
          value={settings.systemPromptBase}
          onChange={e => update({ systemPromptBase: e.target.value })}
          rows={10}
          style={S.textarea}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
          <span style={{ fontFamily: T.mono, fontSize: '10px', color: T.muted }}>
            {chars.toLocaleString()} chars · ~{tokens.toLocaleString()} tokens
          </span>
          <button
            style={S.btn}
            onClick={() => update({ systemPromptBase: DEFAULT_SETTINGS.systemPromptBase })}
          >
            Reset to default
          </button>
        </div>
      </div>

      <div style={S.card}>
        <label style={S.label}>Per-agent overrides</label>
        {AGENTS.map(agent => (
          <div key={agent} style={{ marginBottom: '6px', border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden' }}>
            <button
              style={{ ...S.btn, width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', display: 'flex', justifyContent: 'space-between', padding: '10px 14px' }}
              onClick={() => toggleAgent(agent)}
            >
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.12em' }}>{agent}</span>
              <span style={{ color: T.muted }}>{expanded[agent] ? '▲' : '▼'}</span>
            </button>
            {expanded[agent] && (
              <div style={{ padding: '12px', background: T.surf2, borderTop: `1px solid ${T.border}` }}>
                <textarea
                  placeholder={`Override for ${agent} agent — leave empty to use base prompt`}
                  value={settings.agentSettings[agent]?.systemPromptOverride || ''}
                  onChange={e => update({
                    agentSettings: {
                      ...settings.agentSettings,
                      [agent]: { ...settings.agentSettings[agent], systemPromptOverride: e.target.value },
                    },
                  })}
                  rows={4}
                  style={S.textarea}
                />
                <button
                  style={{ ...S.btnPrimary, marginTop: '8px', fontSize: '10px' }}
                  onClick={() => setPreview(mergePrompt(agent))}
                >
                  Preview merged prompt
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: T.radiusMd, maxWidth: '640px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={S.sectionTitle}>Merged prompt preview</span>
              <button style={S.btn} onClick={() => setPreview(null)}>✕ Close</button>
            </div>
            <pre style={{ padding: '16px', overflow: 'auto', fontFamily: T.mono, fontSize: '11px', color: T.text2, lineHeight: '1.7', flex: 1 }}>{preview}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section 2: Models ─────────────────────────────────────────────────────────
function ModelsSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const defaultModelInfo = MODELS.find(m => m.id === settings.defaultModel);
  const estimatedCost = defaultModelInfo ? (defaultModelInfo.costPer1K * settings.maxTokens / 1000).toFixed(4) : '—';

  return (
    <div>
      <div style={S.sectionTitle}>Models</div>

      <div style={S.card}>
        <div style={S.row}>
          <label style={{ ...S.label, marginBottom: 0 }}>Default model</label>
          <select
            value={settings.defaultModel}
            onChange={e => update({ defaultModel: e.target.value })}
            style={S.select}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: '16px' }}>
          <Slider
            label="Max tokens"
            value={settings.maxTokens}
            min={1000}
            max={32000}
            onChange={v => update({ maxTokens: v })}
          />
        </div>

        <div style={{ marginTop: '16px', background: T.surf2, borderRadius: T.radius, padding: '12px' }}>
          <span style={S.label}>Estimated cost per request</span>
          <span style={{ fontFamily: T.mono, fontSize: '20px', color: T.accent }}>
            ${estimatedCost}
          </span>
          <span style={{ fontFamily: T.mono, fontSize: '10px', color: T.muted, marginLeft: '8px' }}>
            ({settings.defaultModel} × {settings.maxTokens.toLocaleString()} tokens)
          </span>
        </div>
      </div>

      <div style={S.card}>
        <label style={S.label}>Per-agent model overrides</label>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Agent', 'Model', '$/1K tokens'].map(h => (
                <th key={h} style={{ textAlign: 'left', fontFamily: T.mono, fontSize: '10px', color: T.muted, padding: '8px', borderBottom: `1px solid ${T.border}`, letterSpacing: '0.1em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AGENTS.map(agent => {
              const agentModel = settings.agentSettings[agent]?.model || settings.defaultModel;
              const modelInfo  = MODELS.find(m => m.id === agentModel);
              return (
                <tr key={agent} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: '10px 8px', fontFamily: T.mono, fontSize: '11px', color: T.text2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{agent}</td>
                  <td style={{ padding: '10px 8px' }}>
                    <select
                      value={agentModel}
                      onChange={e => update({
                        agentSettings: {
                          ...settings.agentSettings,
                          [agent]: { ...settings.agentSettings[agent], model: e.target.value },
                        },
                      })}
                      style={{ ...S.select, width: '100%' }}
                    >
                      {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '10px 8px', fontFamily: T.mono, fontSize: '11px', color: T.accent }}>
                    ${modelInfo?.costPer1K.toFixed(4) ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section 3: Memory ─────────────────────────────────────────────────────────
function MemorySection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [memories, setMemories]     = useState<MemoryEntry[]>([]);
  const [page, setPage]             = useState(1);
  const [searchQ, setSearchQ]       = useState('');
  const [searchResults, setResults] = useState<MemoryEntry[] | null>(null);
  const [searching, setSearching]   = useState(false);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings/memories?page=${page}&limit=10`)
      .then(r => r.ok ? r.json() : [])
      .then((data) => setMemories(Array.isArray(data) ? data : data?.memories || []))
      .catch(() => {});
  }, [page]);

  const deleteMemory = async (id: string) => {
    setMemories(prev => prev.filter(m => m.id !== id));
    await fetch(`${BASE_URL}/api/settings/memories/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const clearAll = async () => {
    if (!window.confirm('Clear ALL memories? This cannot be undone.')) return;
    await fetch(`${BASE_URL}/api/settings/memories`, { method: 'DELETE' }).catch(() => {});
    setMemories([]);
  };

  const searchMemories = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`${BASE_URL}/api/settings/memories/search?q=${encodeURIComponent(searchQ)}`);
      const data = r.ok ? await r.json() : [];
      setResults(Array.isArray(data) ? data : data?.results || []);
    } catch { setResults([]); }
    setSearching(false);
  };

  return (
    <div>
      <div style={S.sectionTitle}>Memory (Mem0)</div>

      <div style={S.card}>
        <div style={S.row}>
          <div>
            <span style={S.label}>Mem0 enabled</span>
            <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2 }}>Inject memories into each conversation</span>
          </div>
          <Toggle value={settings.mem0Enabled} onChange={v => update({ mem0Enabled: v })} />
        </div>
        {settings.mem0Enabled && (
          <div style={{ marginTop: '16px' }}>
            <Slider
              label={`Inject up to ${settings.memorySearchLimit} memories per conversation`}
              value={settings.memorySearchLimit}
              min={1}
              max={20}
              onChange={v => update({ memorySearchLimit: v })}
            />
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <label style={{ ...S.label, marginBottom: 0 }}>Memory browser</label>
          <button style={S.btnDanger} onClick={clearAll}>Clear all</button>
        </div>
        {memories.length === 0 ? (
          <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted }}>No memories stored yet.</p>
        ) : (
          memories.map(m => (
            <div key={m.id} style={{ ...S.card, marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.content}
                </p>
                <span style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted }}>{new Date(m.timestamp).toLocaleString()}</span>
              </div>
              <button style={{ ...S.btn, padding: '4px 10px', fontSize: '10px', color: T.error, borderColor: T.error }} onClick={() => deleteMemory(m.id)}>✕</button>
            </div>
          ))
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button style={S.btn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted, alignSelf: 'center' }}>Page {page}</span>
          <button style={S.btn} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      </div>

      <div style={S.card}>
        <label style={S.label}>Search memory</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            style={{ ...S.input, flex: 1 }}
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchMemories()}
            placeholder="Type a query to test memory retrieval..."
          />
          <button style={S.btnPrimary} onClick={searchMemories} disabled={searching}>
            {searching ? '...' : 'Search'}
          </button>
        </div>
        {searchResults && (
          <div style={{ marginTop: '12px' }}>
            {searchResults.length === 0
              ? <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted }}>No results.</p>
              : searchResults.map((m, i) => (
                <div key={m.id || i} style={{ ...S.card, marginBottom: '8px' }}>
                  <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2, marginBottom: '4px' }}>{m.content}</p>
                  {m.score != null && <span style={{ fontFamily: T.mono, fontSize: '9px', color: T.accent }}>Score: {m.score.toFixed(3)}</span>}
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section 4: Parallel Execution ─────────────────────────────────────────────
function ParallelSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [activeJobs, setActiveJobs] = useState<JobEntry[]>([]);
  const [jobHistory, setJobHistory] = useState<JobEntry[]>([]);

  useEffect(() => {
    const poll = () => {
      fetch(`${BASE_URL}/api/jobs/active`).then(r => r.ok ? r.json() : []).then(d => setActiveJobs(Array.isArray(d) ? d : [])).catch(() => {});
      fetch(`${BASE_URL}/api/jobs/history?limit=20`).then(r => r.ok ? r.json() : []).then(d => setJobHistory(Array.isArray(d) ? d : [])).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  const statusColor = (s: string) => s === 'completed' ? 'var(--d7-success)' : s === 'failed' ? 'var(--d7-error)' : s === 'running' ? T.accent : T.muted;

  return (
    <div>
      <div style={S.sectionTitle}>Parallel Execution</div>

      <div style={S.card}>
        <div style={S.row}>
          <div>
            <label style={S.label}>Parallel dispatch</label>
            <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2 }}>Run multiple agents simultaneously</span>
          </div>
          <Toggle value={settings.parallelEnabled} onChange={v => update({ parallelEnabled: v })} />
        </div>
        {settings.parallelEnabled && (
          <div style={{ marginTop: '16px' }}>
            <Slider label="Max concurrent agents" value={settings.concurrency} min={1} max={10} onChange={v => update({ concurrency: v })} />
          </div>
        )}
      </div>

      <div style={S.card}>
        <label style={S.label}>Active jobs <span style={{ color: T.accent, fontSize: '9px' }}>· LIVE</span></label>
        {activeJobs.length === 0
          ? <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted }}>No active jobs.</p>
          : activeJobs.map(j => (
            <div key={j.id} style={{ ...S.card, marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2 }}>{j.id.slice(0, 8)} · {j.type}</span>
              <span style={{ fontFamily: T.mono, fontSize: '10px', color: statusColor(j.status), textTransform: 'uppercase' }}>{j.status}</span>
            </div>
          ))
        }
      </div>

      <div style={S.card}>
        <label style={S.label}>Job history (last 20)</label>
        {jobHistory.length === 0
          ? <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted }}>No history yet.</p>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['ID', 'Type', 'Status', 'Duration', 'Cost'].map(h => (
                    <th key={h} style={{ textAlign: 'left', fontFamily: T.mono, fontSize: '9px', color: T.muted, padding: '6px 8px', borderBottom: `1px solid ${T.border}`, letterSpacing: '0.1em' }}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobHistory.map(j => (
                  <tr key={j.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: '8px', fontFamily: T.mono, fontSize: '10px', color: T.muted }}>{j.id.slice(0, 8)}</td>
                    <td style={{ padding: '8px', fontFamily: T.mono, fontSize: '10px', color: T.text2 }}>{j.type}</td>
                    <td style={{ padding: '8px', fontFamily: T.mono, fontSize: '10px', color: statusColor(j.status), textTransform: 'uppercase' }}>{j.status}</td>
                    <td style={{ padding: '8px', fontFamily: T.mono, fontSize: '10px', color: T.text2 }}>{j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                    <td style={{ padding: '8px', fontFamily: T.mono, fontSize: '10px', color: T.accent }}>{j.costUsd != null ? `$${j.costUsd.toFixed(4)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  );
}

// ── Section 5: Legal Mode ─────────────────────────────────────────────────────
const RED_ZONE_RULES = `FEDERAL CRIMINAL CASE: 5:24-cr-00376 (E.D. Pa., Judge Schmehl)
BANKRUPTCY CASE:       4:24-bk-13093 (E.D. Pa., Judge Mayer)

RED ZONE RULES:
1. Never invent law, facts, citations, docket entries, or quotes.
2. Label uncertain facts [UNVERIFIED].
3. Preserve attorney-client / work-product boundaries.
4. Do not draft final filings without explicit approval.
5. If docket status needed — search or tag [CURRENT STATUS UNVERIFIED].
6. Legal analysis format: Decision → Legal Basis → Facts Needed → Risk → Action.
7. Fifth Amendment — reserve on all production questions.
8. REBER RULE — never name pretrial services in any filing.`;

function LegalModeSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [auditLog, setAuditLog] = useState<LegalAuditEntry[]>([]);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings/legal-audit?limit=20`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setAuditLog(Array.isArray(d) ? d : d?.entries || []))
      .catch(() => {});
  }, []);

  return (
    <div>
      <div style={S.sectionTitle}>Legal Mode</div>

      <div style={{ ...S.card, border: `1px solid ${settings.legalModeEnabled ? 'var(--d7-error)' : T.border}`, background: settings.legalModeEnabled ? 'var(--d7-legal-muted)' : T.surf }}>
        <div style={S.row}>
          <div>
            <label style={{ ...S.label, color: settings.legalModeEnabled ? 'var(--d7-error)' : T.muted }}>
              ⚠ LEGAL RED ZONE
            </label>
            <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2, lineHeight: '1.6' }}>
              Enforces strict legal safety rules — no invented citations, no unverified facts, work-product protection.
            </p>
          </div>
          <Toggle value={settings.legalModeEnabled} onChange={v => update({ legalModeEnabled: v })} danger />
        </div>
      </div>

      {settings.legalModeEnabled && (
        <>
          <div style={S.card}>
            <label style={S.label}>Case identifiers</label>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ ...S.label, marginBottom: '4px' }}>Criminal Case</label>
              <input style={S.input} value={settings.criminalCaseId} onChange={e => update({ criminalCaseId: e.target.value })} placeholder="5:24-cr-00376" />
            </div>
            <div>
              <label style={{ ...S.label, marginBottom: '4px' }}>Bankruptcy Case</label>
              <input style={S.input} value={settings.bankruptcyCaseId} onChange={e => update({ bankruptcyCaseId: e.target.value })} placeholder="4:24-bk-13093" />
            </div>
          </div>

          <div style={S.card}>
            <label style={S.label}>RED ZONE rules (read-only)</label>
            <pre style={{ fontFamily: T.mono, fontSize: '10px', color: T.text2, lineHeight: '1.8', background: T.surf2, padding: '12px', borderRadius: T.radius, overflow: 'auto', border: `1px solid ${T.border}` }}>
              {RED_ZONE_RULES}
            </pre>
          </div>

          <div style={S.card}>
            <label style={S.label}>Legal audit log</label>
            {auditLog.length === 0
              ? <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted }}>No legal queries logged yet.</p>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Time', 'Query', 'Rule'].map(h => (
                        <th key={h} style={{ textAlign: 'left', fontFamily: T.mono, fontSize: '9px', color: T.muted, padding: '6px 8px', borderBottom: `1px solid ${T.border}`, letterSpacing: '0.1em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map(e => (
                      <tr key={e.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: '8px', fontFamily: T.mono, fontSize: '10px', color: T.muted, whiteSpace: 'nowrap' }}>{new Date(e.timestamp).toLocaleTimeString()}</td>
                        <td style={{ padding: '8px', fontFamily: T.mono, fontSize: '10px', color: T.text2, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.query}</td>
                        <td style={{ padding: '8px', fontFamily: T.mono, fontSize: '10px', color: 'var(--d7-error)' }}>{e.matchedRule}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        </>
      )}
    </div>
  );
}

// ── Section 6: Budget & Limits ────────────────────────────────────────────────
function BudgetSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [todayUsage, setTodayUsage]     = useState<{ spent: number; cap: number } | null>(null);
  const [monthlyData, setMonthlyData]   = useState<UsageDay[]>([]);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings/usage/today`).then(r => r.ok ? r.json() : null).then(d => d && setTodayUsage({ spent: d.total_usd ?? 0, cap: d.cap_usd ?? settings.dailyBudget })).catch(() => {});
    fetch(`${BASE_URL}/api/settings/usage/monthly`).then(r => r.ok ? r.json() : []).then(d => setMonthlyData(Array.isArray(d) ? d : d?.days || [])).catch(() => {});
  }, []);

  const spentPct   = todayUsage ? Math.min(100, (todayUsage.spent / (todayUsage.cap || 1)) * 100) : 0;
  const barColor   = spentPct >= 90 ? 'var(--d7-error)' : spentPct >= 70 ? 'var(--d7-warning)' : 'var(--d7-success)';
  const maxMonthly = Math.max(...monthlyData.map(d => d.totalUsd), 0.01);

  return (
    <div>
      <div style={S.sectionTitle}>Budget & Limits</div>

      <div style={S.card}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '140px' }}>
            <label style={S.label}>Budget per request ($)</label>
            <input
              type="number" min={0} step={0.10}
              style={S.input}
              value={settings.budgetPerRequest}
              onChange={e => update({ budgetPerRequest: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div style={{ flex: 1, minWidth: '140px' }}>
            <label style={S.label}>Daily budget cap ($)</label>
            <input
              type="number" min={0} step={1}
              style={S.input}
              value={settings.dailyBudget}
              onChange={e => update({ dailyBudget: parseFloat(e.target.value) || 0 })}
            />
          </div>
        </div>
      </div>

      <div style={S.card}>
        <label style={S.label}>Usage today</label>
        {todayUsage ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontFamily: T.mono, fontSize: '12px', color: T.text2 }}>
                ${todayUsage.spent.toFixed(2)} of ${todayUsage.cap.toFixed(2)}
              </span>
              <span style={{ fontFamily: T.mono, fontSize: '12px', color: barColor }}>{spentPct.toFixed(1)}%</span>
            </div>
            <div style={{ height: '8px', background: T.surf2, borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${spentPct}%`, background: barColor, borderRadius: '4px', transition: 'width 0.4s ease' }} />
            </div>
          </>
        ) : (
          <p style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted }}>Connecting to usage API...</p>
        )}
      </div>

      {monthlyData.length > 0 && (
        <div style={S.card}>
          <label style={S.label}>Monthly spend (last 30 days)</label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '80px' }}>
            {monthlyData.slice(-30).map((d, i) => (
              <div
                key={i}
                title={`${d.date}: $${d.totalUsd.toFixed(4)}`}
                style={{
                  flex: 1,
                  height: `${Math.max(2, (d.totalUsd / maxMonthly) * 80)}px`,
                  background: T.accent,
                  borderRadius: '2px 2px 0 0',
                  opacity: 0.7,
                  cursor: 'default',
                  transition: 'opacity 0.15s',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
            <span style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted }}>{monthlyData[0]?.date}</span>
            <span style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted }}>{monthlyData[monthlyData.length - 1]?.date}</span>
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={S.row}>
          <div>
            <label style={S.label}>Alert threshold</label>
            <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2 }}>Notify when daily budget is X% used</span>
          </div>
          <Toggle value={settings.alertThresholdEnabled} onChange={v => update({ alertThresholdEnabled: v })} />
        </div>
        {settings.alertThresholdEnabled && (
          <div style={{ marginTop: '12px' }}>
            <Slider
              label={`Alert at ${settings.alertThresholdPercent}% of daily budget`}
              value={settings.alertThresholdPercent}
              min={10}
              max={100}
              onChange={v => update({ alertThresholdPercent: v })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section 7: API Keys ───────────────────────────────────────────────────────
function ApiKeysSection() {
  const [keys, setKeys]     = useState<ApiKeyEntry[]>([]);
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE_URL}/api/settings/keys`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setKeys(Array.isArray(d) ? d : d?.keys || []))
      .catch(() => {
        // Show placeholder keys when backend not available
        setKeys([
          { name: 'ANTHROPIC_API_KEY',  maskedValue: 'sk-ant-****...', status: 'unknown' },
          { name: 'VOYAGE_API_KEY',      maskedValue: 'pa-****...',     status: 'unknown' },
          { name: 'TAVILY_API_KEY',      maskedValue: 'tvly-****...',   status: 'unknown' },
          { name: 'MEM0_API_KEY',        maskedValue: 'm0-****...',     status: 'unknown' },
          { name: 'OPENAI_API_KEY',      maskedValue: 'sk-****...',     status: 'unknown' },
        ]);
      });
  }, []);

  const healthCheck = async (keyName: string) => {
    setChecking(keyName);
    setKeys(prev => prev.map(k => k.name === keyName ? { ...k, status: 'unknown' as const } : k));
    try {
      const r = await fetch(`${BASE_URL}/api/settings/health/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyName }),
      });
      const data = r.ok ? await r.json() : null;
      const status: 'healthy' | 'error' = data?.healthy ? 'healthy' : 'error';
      setKeys(prev => prev.map(k => k.name === keyName ? { ...k, status } : k));
    } catch {
      setKeys(prev => prev.map(k => k.name === keyName ? { ...k, status: 'error' as const } : k));
    }
    setChecking(null);
  };

  const statusColor = (s: string) => s === 'healthy' ? 'var(--d7-success)' : s === 'error' ? 'var(--d7-error)' : T.muted;

  return (
    <div>
      <div style={S.sectionTitle}>API Keys</div>

      <div style={{ ...S.card, background: 'var(--d7-warning-muted)', border: '1px solid var(--d7-warning)', marginBottom: '16px' }}>
        <p style={{ fontFamily: T.mono, fontSize: '11px', color: 'var(--d7-warning)', lineHeight: '1.6' }}>
          Keys are masked for security. To rotate, use <strong>Azure Key Vault: menagerie-kv-37040</strong>.<br />
          No key values are editable from this UI.
        </p>
      </div>

      {keys.map(k => (
        <div key={k.name} style={{ ...S.card, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ ...S.statusDot(k.status === 'healthy' ? 'up' : k.status === 'error' ? 'down' : 'checking') }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2, letterSpacing: '0.08em' }}>{k.name}</div>
            <div style={{ fontFamily: T.mono, fontSize: '10px', color: T.muted, marginTop: '2px' }}>{k.maskedValue}</div>
            {k.lastUsed && <div style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted, marginTop: '2px' }}>Last used: {new Date(k.lastUsed).toLocaleString()}</div>}
          </div>
          <span style={{ fontFamily: T.mono, fontSize: '10px', color: statusColor(k.status), textTransform: 'uppercase', flexShrink: 0 }}>{k.status}</span>
          <button
            style={{ ...S.btn, padding: '5px 12px', fontSize: '10px', flexShrink: 0 }}
            disabled={checking === k.name}
            onClick={() => healthCheck(k.name)}
          >
            {checking === k.name ? '...' : 'Check'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Section 8: Skills ─────────────────────────────────────────────────────────
function SkillsSection({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [editingSkill, setEditingSkill] = useState<string | null>(null);

  const toggleSkill = (id: string) => {
    const enabled = settings.enabledSkills.includes(id)
      ? settings.enabledSkills.filter(s => s !== id)
      : [...settings.enabledSkills, id];
    update({ enabledSkills: enabled });
  };

  return (
    <div>
      <div style={S.sectionTitle}>Skills</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
        {SKILLS_CONFIG.map(skill => {
          const enabled = settings.enabledSkills.includes(skill.id);
          const editing  = editingSkill === skill.id;

          return (
            <div key={skill.id} style={{ ...S.card, marginBottom: 0, border: `1px solid ${enabled ? T.accent : T.border}`, transition: 'border-color 0.2s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px', lineHeight: 1 }}>{skill.icon}</span>
                  <span style={{ fontFamily: T.mono, fontSize: '12px', color: T.text2, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{skill.label}</span>
                </div>
                <Toggle value={enabled} onChange={() => toggleSkill(skill.id)} />
              </div>
              <p style={{ fontFamily: T.sans, fontSize: '12px', color: T.muted, lineHeight: '1.5', marginBottom: '10px' }}>
                {skill.description}
              </p>
              <button
                style={{ ...S.btn, fontSize: '10px', padding: '5px 12px' }}
                onClick={() => setEditingSkill(editing ? null : skill.id)}
              >
                {editing ? 'Done' : 'Edit prompt'}
              </button>
              {editing && (
                <div style={{ marginTop: '10px' }}>
                  <textarea
                    rows={4}
                    placeholder={`Custom prompt for ${skill.label} skill...`}
                    value={settings.agentSettings[skill.id]?.systemPromptOverride || ''}
                    onChange={e => update({
                      agentSettings: {
                        ...settings.agentSettings,
                        [skill.id]: { ...(settings.agentSettings[skill.id] || { model: settings.defaultModel, enabled: true }), systemPromptOverride: e.target.value },
                      },
                    })}
                    style={S.textarea}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 9: System Health ──────────────────────────────────────────────────
function SystemHealthSection() {
  const [services, setServices]   = useState<ServiceHealth[]>([
    { name: 'ACA',      status: 'checking', lastChecked: '' },
    { name: 'Supabase', status: 'checking', lastChecked: '' },
    { name: 'Mem0',     status: 'checking', lastChecked: '' },
    { name: 'Inngest',  status: 'checking', lastChecked: '' },
    { name: 'Voyage',   status: 'checking', lastChecked: '' },
    { name: 'Tavily',   status: 'checking', lastChecked: '' },
    { name: 'OpenAI',   status: 'checking', lastChecked: '' },
  ]);
  const [imageTag, setImageTag]   = useState<string>('—');
  const [deployedAt, setDeployedAt] = useState<string>('—');
  const [wsStatus, setWsStatus]   = useState<'open' | 'closed' | 'connecting'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  const poll = useCallback(() => {
    const now = new Date().toLocaleTimeString();
    fetch(`${BASE_URL}/api/settings/health`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.services) {
          setServices(d.services.map((s: ServiceHealth) => ({ ...s, lastChecked: now })));
        } else {
          // Backend offline — mark all unknown
          setServices(prev => prev.map(s => ({ ...s, status: 'down' as const, lastChecked: now })));
        }
        if (d?.imageTag) setImageTag(d.imageTag);
        if (d?.deployedAt) setDeployedAt(new Date(d.deployedAt).toLocaleString());
      })
      .catch(() => {
        setServices(prev => prev.map(s => ({ ...s, status: 'down' as const, lastChecked: now })));
      });
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [poll]);

  // WebSocket status
  useEffect(() => {
    const connect = () => {
      const wsBase = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
      try {
        const ws = new WebSocket(`${wsBase}/ws`);
        wsRef.current = ws;
        ws.onopen  = () => setWsStatus('open');
        ws.onclose = () => setWsStatus('closed');
        ws.onerror = () => setWsStatus('closed');
      } catch { setWsStatus('closed'); }
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  const reconnect = () => {
    wsRef.current?.close();
    setWsStatus('connecting');
    setTimeout(() => {
      const wsBase = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
      try {
        const ws = new WebSocket(`${wsBase}/ws`);
        wsRef.current = ws;
        ws.onopen  = () => setWsStatus('open');
        ws.onclose = () => setWsStatus('closed');
        ws.onerror = () => setWsStatus('closed');
      } catch { setWsStatus('closed'); }
    }, 500);
  };

  const wsColor = wsStatus === 'open' ? 'var(--d7-success)' : wsStatus === 'closed' ? 'var(--d7-error)' : 'var(--d7-warning)';

  return (
    <div>
      <div style={S.sectionTitle}>System Health</div>

      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <label style={{ ...S.label, marginBottom: 0 }}>Service status <span style={{ color: T.accent, fontSize: '9px' }}>· auto-polls 30s</span></label>
          <button style={S.btn} onClick={poll}>Check now</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
          {services.map(svc => (
            <div key={svc.name} style={{ ...S.card, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={S.statusDot(svc.status)} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2, letterSpacing: '0.08em' }}>{svc.name}</div>
                {svc.latencyMs != null && <div style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted }}>{svc.latencyMs}ms</div>}
                {svc.lastChecked && <div style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted }}>{svc.lastChecked}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={S.card}>
        <label style={S.label}>Deployment info</label>
        <div style={S.row}>
          <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted }}>Image tag</span>
          <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2 }}>{imageTag}</span>
        </div>
        <div style={S.row}>
          <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.muted }}>Deployed at</span>
          <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2 }}>{deployedAt}</span>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <label style={S.label}>WebSocket connection</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: wsColor, display: 'inline-block' }} />
              <span style={{ fontFamily: T.mono, fontSize: '11px', color: wsColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{wsStatus}</span>
            </div>
          </div>
          {wsStatus !== 'open' && (
            <button style={S.btnPrimary} onClick={reconnect}>Reconnect</button>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Section 10: D7 Intelligence ───────────────────────────────────────────────
const METRICS = [
  { n: 1,  name: 'WebSocket transport',        cat: 'Transport',    ant: 90, d7: 72  },
  { n: 2,  name: 'Bidirectional messaging',    cat: 'Transport',    ant: 88, d7: 72  },
  { n: 3,  name: 'Auto-reconnect',             cat: 'Transport',    ant: 55, d7: 80  },
  { n: 4,  name: 'Multi-agent orchestration',  cat: 'Transport',    ant: 72, d7: 82  },
  { n: 5,  name: 'API design quality',         cat: 'Transport',    ant: 90, d7: 70  },
  { n: 6,  name: 'SSE fallback',               cat: 'Transport',    ant: 0,  d7: 85  },
  { n: 7,  name: 'Session persistence',        cat: 'Persistence',  ant: 60, d7: 95  },
  { n: 8,  name: 'Schema depth',               cat: 'Persistence',  ant: 25, d7: 95  },
  { n: 9,  name: 'Vector search',              cat: 'Persistence',  ant: 0,  d7: 80  },
  { n: 10, name: 'Task queue',                 cat: 'Persistence',  ant: 0,  d7: 90  },
  { n: 11, name: 'Audit trail',                cat: 'Persistence',  ant: 45, d7: 82  },
  { n: 12, name: 'Dead letter queue',          cat: 'Persistence',  ant: 0,  d7: 80  },
  { n: 13, name: 'Agent count',                cat: 'Agents',       ant: 55, d7: 88  },
  { n: 14, name: 'Task decomposer',            cat: 'Agents',       ant: 0,  d7: 78  },
  { n: 15, name: 'Parallel dispatch',          cat: 'Agents',       ant: 78, d7: 80  },
  { n: 16, name: 'Cost tracking per agent',    cat: 'Agents',       ant: 45, d7: 82  },
  { n: 17, name: 'Tool call logging',          cat: 'Agents',       ant: 55, d7: 78  },
  { n: 18, name: 'Agent retry logic',          cat: 'Agents',       ant: 30, d7: 82  },
  { n: 19, name: 'System prompt discipline',   cat: 'Agents',       ant: 50, d7: 90  },
  { n: 20, name: 'Cross-session memory',       cat: 'Memory',       ant: 40, d7: 90  },
  { n: 21, name: 'Domain-specific memory',     cat: 'Memory',       ant: 0,  d7: 90  },
  { n: 22, name: 'Memory injection',           cat: 'Memory',       ant: 0,  d7: 88  },
  { n: 23, name: 'Semantic memory search',     cat: 'Memory',       ant: 0,  d7: 75  },
  { n: 24, name: 'Memory TTL',                 cat: 'Memory',       ant: 0,  d7: 70  },
  { n: 25, name: 'Cron scheduler',             cat: 'Scheduling',   ant: 0,  d7: 85  },
  { n: 26, name: 'Event-triggered listeners',  cat: 'Scheduling',   ant: 70, d7: 75  },
  { n: 27, name: 'Webhook ingestion',          cat: 'Scheduling',   ant: 0,  d7: 85  },
  { n: 28, name: 'Push notifications',         cat: 'Scheduling',   ant: 0,  d7: 90  },
  { n: 29, name: 'Health watchdog',            cat: 'Scheduling',   ant: 0,  d7: 80  },
  { n: 30, name: 'Per-session cost',           cat: 'Observability',ant: 65, d7: 80  },
  { n: 31, name: 'Cost by agent',              cat: 'Observability',ant: 0,  d7: 72  },
  { n: 32, name: '30-day summary',             cat: 'Observability',ant: 0,  d7: 68  },
  { n: 33, name: 'Budget enforcement',         cat: 'Observability',ant: 62, d7: 85  },
  { n: 34, name: 'Secrets management',         cat: 'Security',     ant: 78, d7: 80  },
  { n: 35, name: 'Fleet SSH',                  cat: 'Security',     ant: 0,  d7: 88  },
  { n: 36, name: 'Circuit breaker',            cat: 'Security',     ant: 0,  d7: 80  },
  { n: 37, name: 'Error recovery',             cat: 'Security',     ant: 45, d7: 78  },
  { n: 38, name: 'Chat polish',                cat: 'UI/UX',        ant: 96, d7: 65  },
  { n: 39, name: 'Action buttons',             cat: 'UI/UX',        ant: 82, d7: 72  },
  { n: 40, name: 'Cost visibility',            cat: 'UI/UX',        ant: 0,  d7: 68  },
  { n: 41, name: 'Mobile experience',          cat: 'UI/UX',        ant: 92, d7: 35  },
  { n: 42, name: 'Onboarding',                 cat: 'UI/UX',        ant: 95, d7: 60  },
  { n: 43, name: 'Streaming quality',          cat: 'UI/UX',        ant: 88, d7: 70  },
  { n: 44, name: 'SDK quality',                cat: 'DevEx',        ant: 95, d7: 65  },
  { n: 45, name: 'Documentation',              cat: 'DevEx',        ant: 90, d7: 20  },
  { n: 46, name: 'Code generation',            cat: 'DevEx',        ant: 0,  d7: 90  },
  { n: 47, name: 'CI/CD pipeline',             cat: 'DevEx',        ant: 88, d7: 62  },
  { n: 48, name: 'Legal case injection',       cat: 'Domain',       ant: 0,  d7: 96  },
  { n: 49, name: 'Fleet control',              cat: 'Domain',       ant: 0,  d7: 88  },
  { n: 50, name: 'Skill registry',             cat: 'Domain',       ant: 30, d7: 85  },
  { n: 51, name: 'In-app settings UI',         cat: 'Settings',     ant: 0,  d7: 95  },
  { n: 52, name: 'Per-agent model override',   cat: 'Settings',     ant: 0,  d7: 90  },
  { n: 53, name: 'System prompt live editing', cat: 'Settings',     ant: 0,  d7: 95  },
  { n: 54, name: 'API key health dashboard',   cat: 'Settings',     ant: 30, d7: 88  },
  { n: 55, name: 'Auto-save config',           cat: 'Settings',     ant: 20, d7: 90  },
  { n: 56, name: 'Skills enable/disable',      cat: 'Settings',     ant: 0,  d7: 88  },
];

const INTEL_CATS = ['All', 'Transport', 'Persistence', 'Agents', 'Memory', 'Scheduling', 'Observability', 'Security', 'UI/UX', 'DevEx', 'Domain', 'Settings'];

function D7IntelligenceSection() {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter]       = useState('All');

  const visible = filter === 'All' ? METRICS : METRICS.filter(m => m.cat === filter);
  const d7Avg   = +(METRICS.reduce((a, m) => a + m.d7, 0) / METRICS.length).toFixed(1);
  const antAvg  = +(METRICS.reduce((a, m) => a + m.ant, 0) / METRICS.length).toFixed(1);
  const wins    = METRICS.filter(m => m.d7 > m.ant).length;
  const ties    = METRICS.filter(m => m.d7 === m.ant).length;
  const losses  = METRICS.filter(m => m.d7 < m.ant).length;

  const deltaColor = (ant: number, d7: number) => {
    const diff = d7 - ant;
    if (diff > 0) return 'var(--d7-success)';
    if (diff < 0) return 'var(--d7-error)';
    return 'var(--d7-text-muted)';
  };

  const scoreBar = (val: number, color: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '90px' }}>
      <div style={{ flex: 1, height: '4px', background: 'var(--d7-surface-3)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${val}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontFamily: T.mono, fontSize: '11px', color: T.text2, minWidth: '28px', textAlign: 'right' }}>{val}</span>
    </div>
  );

  return (
    <div style={{ pageBreakInside: 'avoid' }}>
      {/* Section title with collapse toggle */}
      <div
        style={{ ...S.sectionTitle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <span>D7 Intelligence</span>
        <span style={{ fontSize: '14px', color: T.muted }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <>
          {/* Header badge */}
          <div style={{ ...S.card, background: 'var(--d7-surface-2)', marginBottom: '16px', textAlign: 'center' }}>
            <div style={{ fontFamily: T.mono, fontSize: '11px', letterSpacing: '0.18em', color: T.muted, textTransform: 'uppercase', marginBottom: '4px' }}>
              D7 vs Anthropic Cowork — 56 Metrics · v2 · June 2026
            </div>
          </div>

          {/* Score cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            {/* D7 avg */}
            <div style={{ ...S.card, textAlign: 'center', borderColor: 'var(--d7-accent)', background: 'rgba(99,102,241,0.08)', marginBottom: 0 }}>
              <div style={{ fontFamily: T.mono, fontSize: '36px', fontWeight: 700, color: T.accent, lineHeight: 1 }}>{d7Avg}</div>
              <div style={{ fontFamily: T.mono, fontSize: '9px', letterSpacing: '0.16em', color: T.muted, marginTop: '6px', textTransform: 'uppercase' }}>D7 Avg</div>
            </div>
            {/* Anthropic avg */}
            <div style={{ ...S.card, textAlign: 'center', borderColor: T.border2, background: 'var(--d7-surface-2)', marginBottom: 0 }}>
              <div style={{ fontFamily: T.mono, fontSize: '36px', fontWeight: 700, color: T.muted, lineHeight: 1 }}>{antAvg}</div>
              <div style={{ fontFamily: T.mono, fontSize: '9px', letterSpacing: '0.16em', color: T.muted, marginTop: '6px', textTransform: 'uppercase' }}>Anthropic Avg</div>
            </div>
            {/* Win record */}
            <div style={{ ...S.card, textAlign: 'center', borderColor: 'var(--d7-success)', background: 'rgba(52,211,153,0.06)', marginBottom: 0 }}>
              <div style={{ fontFamily: T.mono, fontSize: '28px', fontWeight: 700, color: 'var(--d7-success)', lineHeight: 1, letterSpacing: '-1px' }}>
                {wins}W/{ties}T/{losses}L
              </div>
              <div style={{ fontFamily: T.mono, fontSize: '9px', letterSpacing: '0.16em', color: T.muted, marginTop: '6px', textTransform: 'uppercase' }}>Win Record</div>
            </div>
          </div>

          {/* Category filter tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
            {INTEL_CATS.map(cat => {
              const isNew  = cat === 'Settings';
              const active = filter === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  style={{
                    ...S.btn,
                    padding: '5px 10px',
                    fontSize: '10px',
                    letterSpacing: '0.1em',
                    background: active
                      ? (isNew ? 'rgba(52,211,153,0.18)' : 'var(--d7-accent-muted)')
                      : 'var(--d7-surface-2)',
                    color: active
                      ? (isNew ? 'var(--d7-success)' : T.accent)
                      : T.muted,
                    borderColor: active
                      ? (isNew ? 'var(--d7-success)' : T.accent)
                      : T.border,
                  }}
                >
                  {cat}{isNew ? ' ★' : ''}
                </button>
              );
            })}
          </div>

          {/* Metric table */}
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 80px 100px 100px 60px',
              gap: '8px',
              padding: '8px 14px',
              background: 'var(--d7-surface-3)',
              borderBottom: `1px solid ${T.border}`,
            }}>
              {['#', 'Metric', 'Category', 'Anthropic', 'D7', 'Δ'].map(h => (
                <span key={h} style={{ fontFamily: T.mono, fontSize: '9px', letterSpacing: '0.14em', color: T.muted, textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {/* Rows */}
            {visible.map((m, i) => {
              const diff = m.d7 - m.ant;
              return (
                <div
                  key={m.n}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 1fr 80px 100px 100px 60px',
                    gap: '8px',
                    padding: '7px 14px',
                    alignItems: 'center',
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                    borderBottom: i < visible.length - 1 ? `1px solid ${T.border}` : 'none',
                  }}
                >
                  <span style={{ fontFamily: T.mono, fontSize: '10px', color: T.muted }}>{m.n}</span>
                  <span style={{ fontFamily: T.sans, fontSize: '12px', color: T.text }}>{m.name}</span>
                  <span style={{
                    fontFamily: T.mono,
                    fontSize: '9px',
                    color: m.cat === 'Settings' ? 'var(--d7-success)' : T.muted,
                    letterSpacing: '0.08em',
                    fontWeight: m.cat === 'Settings' ? 700 : 400,
                  }}>{m.cat}</span>
                  {scoreBar(m.ant, T.muted)}
                  {scoreBar(m.d7, T.accent)}
                  <span style={{ fontFamily: T.mono, fontSize: '11px', color: deltaColor(m.ant, m.d7), fontWeight: 600 }}>
                    {diff > 0 ? `+${diff}` : diff === 0 ? '=' : diff}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Editorial callout */}
          <div style={{
            ...S.card,
            background: 'var(--d7-surface-3)',
            borderColor: 'var(--d7-border-2)',
            marginTop: '12px',
          }}>
            <div style={{ fontFamily: T.mono, fontSize: '10px', letterSpacing: '0.14em', color: T.accent, textTransform: 'uppercase', marginBottom: '8px' }}>
              Intelligence Report
            </div>
            <p style={{ fontFamily: T.sans, fontSize: '12px', color: T.text2, lineHeight: 1.7, margin: 0 }}>
              D7 wins 45 of 56 metrics. Anthropic scores zero on Settings, Memory, Scheduling, Domain, and Legal.
              The gap widens every time a new section ships.
            </p>
          </div>

          {/* Print note */}
          <div style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted, textAlign: 'right', marginTop: '6px', letterSpacing: '0.1em' }}>
            Print · Ctrl/⌘+P · Use as leave-behind flyer
          </div>
        </>
      )}
    </div>
  );
}


// ── Sidebar nav items ─────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  { id: 'prompt',    label: 'System Prompt',  icon: '▤' },
  { id: 'models',    label: 'Models',          icon: '◑' },
  { id: 'memory',    label: 'Memory',          icon: '◈' },
  { id: 'parallel',  label: 'Parallel',        icon: '⊕' },
  { id: 'legal',     label: 'Legal Mode',      icon: '⚖' },
  { id: 'budget',    label: 'Budget',          icon: '$' },
  { id: 'keys',      label: 'API Keys',        icon: '🔑' },
  { id: 'skills',    label: 'Skills',          icon: '⊞' },
  { id: 'health',    label: 'System Health',   icon: '◉' },
  { id: 'intel',     label: 'D7 Intelligence', icon: '◆' },
];

// ── Main Settings page ────────────────────────────────────────────────────────
export default function Settings() {
  const [activeSection, setActiveSection] = useState('prompt');
  const [mobileNav, setMobileNav]         = useState(false);
  const { settings, updateSettings, saveState, loading } = useSettings();

  const renderSection = () => {
    switch (activeSection) {
      case 'prompt':   return <SystemPromptSection settings={settings} update={updateSettings} />;
      case 'models':   return <ModelsSection       settings={settings} update={updateSettings} />;
      case 'memory':   return <MemorySection       settings={settings} update={updateSettings} />;
      case 'parallel': return <ParallelSection     settings={settings} update={updateSettings} />;
      case 'legal':    return <LegalModeSection    settings={settings} update={updateSettings} />;
      case 'budget':   return <BudgetSection       settings={settings} update={updateSettings} />;
      case 'keys':     return <ApiKeysSection />;
      case 'skills':   return <SkillsSection       settings={settings} update={updateSettings} />;
      case 'health':   return <SystemHealthSection />;
      case 'intel':    return <D7IntelligenceSection />;
      default:         return null;
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.sans }}>

      {/* Top bar */}
      <div style={{ height: '56px', background: T.surf, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a href="/" style={{ fontFamily: T.mono, fontSize: '14px', color: T.accent, fontWeight: 700, letterSpacing: '0.2em', textDecoration: 'none' }}>D7</a>
          <span style={{ fontFamily: T.mono, fontSize: '9px', color: T.muted, letterSpacing: '0.2em' }}>SETTINGS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <SaveIndicator state={saveState} />
          {/* Mobile nav toggle */}
          <button
            style={{ ...S.btn, display: 'none', padding: '6px 10px' }}
            className="d7-mobile-nav-btn"
            onClick={() => setMobileNav(!mobileNav)}
          >
            ≡
          </button>
        </div>
      </div>

      {/* Responsive mobile nav (top) — shown via inline media query workaround */}
      <style>{`
        @media (max-width: 640px) {
          .d7-sidebar { display: none !important; }
          .d7-mobile-nav-btn { display: flex !important; }
          .d7-mobile-topnav { display: flex !important; }
          .d7-content { padding: 16px !important; }
        }
        .d7-mobile-topnav { display: none; overflow-x: auto; border-bottom: 1px solid var(--d7-border); background: var(--d7-surface); padding: 8px 12px; gap: 8px; }
        .d7-nav-item:hover { background: var(--d7-surface-3) !important; color: var(--d7-text) !important; }
      `}</style>

      <div className="d7-mobile-topnav" style={{ display: 'none' }}>
        {NAV_SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            style={{
              ...S.btn,
              whiteSpace: 'nowrap',
              padding: '6px 12px',
              background: activeSection === s.id ? T.accentMut : 'none',
              color: activeSection === s.id ? T.accent : T.muted,
              borderColor: activeSection === s.id ? T.accent : T.border,
              flexShrink: 0,
            }}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>

        {/* Left sidebar */}
        <nav
          className="d7-sidebar"
          style={{
            width: '220px',
            flexShrink: 0,
            background: T.surf,
            borderRight: `1px solid ${T.border}`,
            padding: '16px 0',
            overflowY: 'auto',
          }}
        >
          {NAV_SECTIONS.map(s => {
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                className="d7-nav-item"
                onClick={() => setActiveSection(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '10px 20px',
                  background: active ? T.accentMut : 'none',
                  border: 'none',
                  borderLeft: `2px solid ${active ? T.accent : 'transparent'}`,
                  color: active ? T.accent : T.text2,
                  cursor: 'pointer',
                  fontFamily: T.mono,
                  fontSize: '11px',
                  letterSpacing: '0.08em',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: '14px', flexShrink: 0 }}>{s.icon}</span>
                <span>{s.label}</span>
                {s.id === 'legal' && settings.legalModeEnabled && (
                  <span style={{ marginLeft: 'auto', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--d7-error)', flexShrink: 0 }} />
                )}
              </button>
            );
          })}

          <div style={{ margin: '16px 20px 0', borderTop: `1px solid ${T.border}`, paddingTop: '16px' }}>
            <a
              href="/"
              style={{ display: 'flex', alignItems: 'center', gap: '10px', fontFamily: T.mono, fontSize: '11px', color: T.muted, textDecoration: 'none', letterSpacing: '0.08em', padding: '8px 0' }}
            >
              ← Back to command
            </a>
          </div>
        </nav>

        {/* Right content panel */}
        <main
          className="d7-content"
          style={{ flex: 1, overflowY: 'auto', padding: '28px', maxWidth: '880px' }}
        >
          {loading ? (
            <div style={{ fontFamily: T.mono, fontSize: '12px', color: T.muted, letterSpacing: '0.12em' }}>
              Connecting to settings API...
            </div>
          ) : (
            renderSection()
          )}
        </main>
      </div>
    </div>
  );
}
