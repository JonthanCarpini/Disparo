#!/bin/sh
echo "=== PREFLIGHT OPTIONS ==="
curl -s -I -X OPTIONS http://178.238.236.103:3333/api/auth/login \
  -H "Origin: http://178.238.236.103:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type"

echo ""
echo "=== POST LOGIN ==="
curl -s -X POST http://178.238.236.103:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://178.238.236.103:3000" \
  -d '{"username":"admin","password":"Admin@2026"}'
