const http = require('http');

const PORT = process.env.PORT || 3000;

/**
 * Servidor HTTP mínimo para Render.
 * - Render requiere que el proceso escuche en un puerto.
 * - El endpoint GET / devuelve 200 OK para los pings del cron job.
 */
function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', bot: 'Pokebot', uptime: Math.floor(process.uptime()) }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(PORT, () => {
    console.log(`🌐 Servidor health check activo en puerto ${PORT}`);
  });
}

module.exports = { startHealthServer };
