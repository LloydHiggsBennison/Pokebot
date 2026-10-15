const http = require('http');

const PORT = process.env.PORT || 3000;

/**
 * Servidor HTTP mínimo para Render.
 * - Render requiere que el proceso escuche en un puerto.
 * - El endpoint GET / devuelve 200 OK para los pings del cron job.
 */
function startHealthServer(getStatus = () => ({})) {
  const server = http.createServer((req, res) => {
    if(req.url?.split('?')[0].startsWith('/paypal/')) {
      require('./paypalHttp').handle(req,res).catch(error=>{
        console.error('[PayPal HTTP]',error.message);
        if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});
        res.end('Payment processing unavailable. Retry from Discord.');
      });return;
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/ready')) {
      const state = getStatus();
      const ready = Boolean(state.connected && state.emojis?.status === 'ready');
      res.writeHead(req.url === '/ready' && !ready ? 503 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ready' : 'starting', bot: 'Pokebot', uptime: Math.floor(process.uptime()), ...state }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(PORT, () => {
    console.log(`🌐 Servidor health check activo en puerto ${PORT}`);
  });
  return server;
}

module.exports = { startHealthServer };
