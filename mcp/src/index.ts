import { startHttpServer, startStdioServer } from './server.js';

// BOOKCLAW_MCP_TRANSPORT=stdio → the client launches this process and speaks
// JSON-RPC over stdio. Anything else (default) → the Streamable HTTP server.
if ((process.env.BOOKCLAW_MCP_TRANSPORT ?? 'http').toLowerCase() === 'stdio') {
  startStdioServer().catch((err) => {
    console.error('Failed to start stdio server:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  startHttpServer();
}
