import type { ModelProvider } from './models/index.js';
import type { SessionStore } from './sessions/index.js';
import type { Message, Session } from './sessions/index.js';

export async function runLoop(
  session: Session,
  sessionStore: SessionStore,
  provider: ModelProvider,
  content: string,
): Promise<Message> {
  const userMessage: Message = {
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };

  await sessionStore.appendMessage(session.id, userMessage);
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

  await sessionStore.appendMessage(session.id, assistantMessage);
  session.messages.push(assistantMessage);
  return assistantMessage;
}
