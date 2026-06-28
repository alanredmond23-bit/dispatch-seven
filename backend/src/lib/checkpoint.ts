// Called after each agent_run. If estimated context fill > 80%, writes a checkpoint.
// Checkpoint = structured summary of decisions, open threads, key facts, next steps.
// Stored in dispatch_tasks with status='checkpoint' for session continuity across context windows.
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from './supabase.js';

const CONTEXT_LIMIT = 200_000; // claude-sonnet-4-5 context window tokens
const CHECKPOINT_THRESHOLD = 0.80;

export async function maybeCheckpoint(
  sessionId: string,
  totalTokensUsed: number,
  projectId?: string
) {
  const fillRatio = totalTokensUsed / CONTEXT_LIMIT;
  if (fillRatio < CHECKPOINT_THRESHOLD) return null;

  // Fetch last 20 agent_run results for this session to summarize
  const { data: runs } = await supabase
    .from('agent_runs')
    .select('result, started_at')
    .eq('session_id', sessionId)
    .order('started_at', { ascending: false })
    .limit(20);

  if (!runs?.length) return null;

  // Use Haiku for cheap summarization — checkpoint cost should be minimal
  const client = new Anthropic();
  const summary = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Summarize this session into a structured checkpoint. Output JSON with keys: decisions (array of strings), open_threads (array of strings), key_facts (array of strings), next_steps (array of strings). Session data:\n${JSON.stringify(runs, null, 2)}`,
    }],
  });

  const checkpointData = JSON.parse((summary.content[0] as any).text);

  await supabase.from('dispatch_tasks').insert({
    session_id: sessionId,
    project_id: projectId ?? null,
    title: `Checkpoint — ${new Date().toISOString()}`,
    status: 'checkpoint',
    output_summary: JSON.stringify(checkpointData),
    agent: 'checkpoint-runner',
  });

  return checkpointData;
}
