const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 5000,
  path: '/api/auth/me',
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', body);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
  console.error('Code:', e.code);
});

req.end();