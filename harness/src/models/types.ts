export type ModelMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ModelRequest = {
  messages: ModelMessage[];
};

export type ModelResponse = {
  text: string;
};
