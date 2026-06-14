export interface AIHelpResponse {
  conversationId: string;
  reply: string;
  turnsRemaining: number;
  conversationsRemaining: number;
}

export async function askAIHelp(message: string, conversationId?: string): Promise<AIHelpResponse> {
  const endpoint = import.meta.env.VITE_AI_HELP_URL || '/api/ai/help';
  const res = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.message === 'string' ? data.message : 'AI uplink is unavailable.');
  }
  if (typeof data.reply !== 'string' || typeof data.conversationId !== 'string') {
    throw new Error('AI uplink is not connected in this build.');
  }
  return data as AIHelpResponse;
}
