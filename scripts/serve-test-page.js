'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const host = '127.0.0.1';
const port = Number(process.env.VSC_TEST_PORT) || 4173;
const testRoot = path.resolve(__dirname, '../test/manual');

http.createServer((request, response) => {
  const requestedPath = request.url === '/' ? '/media.html' : request.url;
  const filePath = path.resolve(testRoot, `.${requestedPath}`);
  if (!filePath.startsWith(`${testRoot}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
      return;
    }
    const contentType = path.extname(filePath) === '.webm' ? 'video/webm' : 'text/html; charset=utf-8';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(content);
  });
}).listen(port, host, () => {
  console.log(`Manual test page: http://${host}:${port}/media.html`);
});
