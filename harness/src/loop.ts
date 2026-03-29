import type { Message, Session } from './harness.js';
import type { ModelProvider } from './models/index.js';

export async function runLoop(session: Session, provider: ModelProvider, content: string): Promise<Message> {
  const userMessage: Message = {
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };

  session.messages.push(userMessage);

  const response = await provider.generate({
    messages: session.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  });

  const assistantMessage: Message = {
    role: 'assistant',
    content: response.text,
    createdAt: new Date().toISOString(),
  };

  session.messages.push(assistantMessage);
  return assistantMessage;
}
