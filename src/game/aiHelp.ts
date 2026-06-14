export interface AIHelpResponse {
  conversationId: string;
  reply: string;
  turnsRemaining: number;
  conversationsRemaining: number;
}

function plainTextReply(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*{1,2}\s+/g, '- ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim();
}

export async function askAIHelp(
  message: string,
  conversationId?: string,
  context?: unknown,
  history?: { role: 'assistant' | 'user'; content: string }[],
): Promise<AIHelpResponse> {
  const endpoint = import.meta.env.VITE_AI_HELP_URL;
  if (!endpoint) {
    throw new Error('AI uplink is not configured yet.');
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId, context, history }),
  });
  const raw = await res.text();
  let data: Record<string, any> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('AI uplink returned a non-JSON response. Refresh the game and try again.');
  }
  if (!res.ok) {
    throw new Error(typeof data.message === 'string' ? data.message : 'AI uplink is unavailable.');
  }
  const reply =
    typeof data.reply === 'string' ? data.reply :
    typeof data.answer === 'string' ? data.answer :
    typeof data.message === 'string' ? data.message :
    typeof data.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content :
    '';
  if (!reply) {
    throw new Error('AI uplink returned an incomplete response. Refresh the game and try again.');
  }
  return {
    conversationId: typeof data.conversationId === 'string' ? data.conversationId : conversationId ?? crypto.randomUUID(),
    reply: plainTextReply(reply),
    turnsRemaining: Number.isFinite(Number(data.turnsRemaining)) ? Number(data.turnsRemaining) : 0,
    conversationsRemaining: Number.isFinite(Number(data.conversationsRemaining)) ? Number(data.conversationsRemaining) : 0,
  };
}
