// Pipes Anthropic streaming API response directly to a WS client
// Each token chunk is sent as: { type: 'token', delta: string, agent: string }
// On finish: { type: 'done', agent: string, tokens_in: number, tokens_out: number, cost_usd: number }
// On error: { type: 'error', agent: string, message: string }
// Budget guard aborts stream early if cost exceeds budgetUsd threshold
import Anthropic from '@anthropic-ai/sdk';

export async function streamToWs(
  ws: any,
  agentId: string,
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  budgetUsd: number = 0.50
) {
  const client = new Anthropic();
  let tokensIn = 0, tokensOut = 0;

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 8096,
      system: systemPrompt,
      messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        ws.send(JSON.stringify({ type: 'token', delta: chunk.delta.text, agent: agentId }));
      }
      if (chunk.type === 'message_delta' && chunk.usage) {
        tokensOut = chunk.usage.output_tokens;
      }
      if (chunk.type === 'message_start' && chunk.message.usage) {
        tokensIn = chunk.message.usage.input_tokens;
      }

      // Budget guard: $3/1M input, $15/1M output for Sonnet
      const costSoFar = (tokensIn * 3 + tokensOut * 15) / 1_000_000;
      if (costSoFar > budgetUsd) {
        ws.send(JSON.stringify({ type: 'budget_exceeded', agent: agentId, cost_usd: costSoFar }));
        stream.abort();
        break;
      }
    }

    const finalMsg = await stream.finalMessage().catch(() => null);
    const finalOut = finalMsg?.usage?.output_tokens ?? tokensOut;
    const cost = (tokensIn * 3 + finalOut * 15) / 1_000_000;

    ws.send(JSON.stringify({
      type: 'done',
      agent: agentId,
      tokens_in: tokensIn,
      tokens_out: finalOut,
      cost_usd: cost,
    }));

    return { tokensIn, tokensOut: finalOut, cost };
  } catch (err: any) {
    ws.send(JSON.stringify({ type: 'error', agent: agentId, message: err?.message ?? String(err) }));
    throw err;
  }
}
