/**
 * isChatCommand — whether a chat message should be dispatched as a command
 * (a slash command, or a natural-language project-advance verb) rather than sent
 * to the AI as prose. Shared by the /api/chat route and the Socket.IO message
 * handler so both surfaces dispatch commands identically — without it, socket
 * clients (the studio chat + standalone Chat app) send `/editors` etc. straight
 * to the model instead of the command handler.
 */
const NL_COMMANDS = ['continue', 'next', 'go', 'resume'];

export function isChatCommand(message: string): boolean {
  if (typeof message !== 'string') return false;
  if (message.startsWith('/')) return true;
  return NL_COMMANDS.includes(message.toLowerCase().trim());
}
