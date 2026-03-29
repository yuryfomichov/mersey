export type Message = {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type Session = {
  id: string;
  createdAt: string;
  messages: Message[];
};
