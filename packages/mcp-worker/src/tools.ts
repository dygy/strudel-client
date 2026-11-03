/** Static tool definitions: plain JSON Schema, with no per-request setup (tech spec 2.1). */
import type { AssistantIdentity } from './auth';

export const TOOLS = [
  {
    name: 'whoami',
    title: 'Who am I',
    description: 'Shows which Strudel user this connection acts for, and which client it was issued to.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        email: { type: ['string', 'null'] },
        client_id: { type: 'string' },
      },
      required: ['user_id', 'email', 'client_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

export function whoami(identity: AssistantIdentity) {
  const structuredContent = { user_id: identity.userId, email: identity.email, client_id: identity.clientId };
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
}
