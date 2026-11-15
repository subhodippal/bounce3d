#!/usr/bin/env node
// Zero-dependency static server for Rebound 3D.
// Serves the game on this computer AND on other devices on the same Wi-Fi.
//
//   node server.js            -> port 8000
//   node server.js -p 8005    -> port 8005   (also: --port 8005, --port=8005, PORT=8005)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = __dirname;
const HOST = '0.0.0.0'; // listen on all network interfaces so phones can connect

function parsePort(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--port') return argv[i + 1];
    if (a.startsWith('--port=')) return a.slice(7);
    if (a === '-h' || a === '--help') {
      console.log('Usage: node server.js [-p PORT]\n  -p, --port   port to listen on (default 8000)');
      process.exit(0);
    }
  }
  return process.env.PORT || 8000;
}

const port = Number(parsePort(process.argv.slice(2)));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid port. Example: node server.js -p 8005');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const file = path.normalize(path.join(ROOT, urlPath));
  // Block path traversal and hidden files (e.g. .git)
  if (!file.startsWith(ROOT + path.sep) || file.split(path.sep).some((p) => p.startsWith('.') && p !== '.nojekyll')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      log(req, 404);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      // no caching during development, so edits show up on reload
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
    log(req, 200);
  });
});

function log(req, code) {
  const t = new Date().toLocaleTimeString();
  console.log(`${t}  ${code}  ${req.method} ${req.url}  (${req.socket.remoteAddress})`);
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Try: node server.js -p ${port + 1}`);
  else if (e.code === 'EACCES') console.error(`No permission to use port ${port}. Use a port above 1024, e.g. -p 8005`);
  else console.error(e);
  process.exit(1);
});

server.listen(port, HOST, () => {
  console.log('\n  Rebound 3D server running\n');
  console.log(`  This computer:   http://localhost:${port}/`);
  const lan = lanAddresses();
  if (lan.length) {
    for (const { name, address } of lan) console.log(`  Phone (same Wi-Fi): http://${address}:${port}/   [${name}]`);
  } else {
    console.log('  (No network connection found, so only localhost is available)');
  }
  console.log('\n  If the phone can\'t connect, allow this port through your firewall,');
  console.log(`  e.g. on Ubuntu: sudo ufw allow ${port}/tcp`);
  console.log('  Press Ctrl+C to stop.\n');
});
