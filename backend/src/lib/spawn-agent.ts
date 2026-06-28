// Allows a running agent to spawn sub-agents at runtime, adding nodes to the DAG
// The spawned agent's result is fed back into the parent context via agent_runs table
// ws is optional — pass it to get real-time spawn notification on the WS connection
import { supabase } from './supabase.js';

interface SpawnTask {
  title: string;
  agent: string;
  prompt: string;
  dependsOn?: string[];
}

export async function spawnSubAgent(
  parentSessionId: string,
  task: SpawnTask,
  ws?: any
) {
  const nodeId = `spawn_${Date.now()}`;

  // Record the spawn in agent_runs so DAG executor can pick it up
  await supabase.from('agent_runs').insert({
    session_id: parentSessionId,
    agent_type: task.agent,
    status: 'queued',
    prompt: task.prompt,
    metadata: {
      spawned_by: 'parent',
      parent_session: parentSessionId,
      node_id: nodeId,
      depends_on: task.dependsOn ?? [],
    },
  });

  if (ws) {
    ws.send(JSON.stringify({ type: 'agent_spawned', agent: task.agent, title: task.title, node_id: nodeId }));
  }

  return nodeId;
}
