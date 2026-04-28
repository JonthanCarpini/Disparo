#!/bin/sh
TOKEN=$(curl -s -X POST http://localhost:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@2026"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

SESSION_ID=$(curl -s http://localhost:3333/api/whatsapp/sessions \
  -H "Authorization: Bearer $TOKEN" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "Session: $SESSION_ID"
echo "Sync status:"
curl -s "http://localhost:3333/api/whatsapp/sessions/$SESSION_ID/sync-status" \
  -H "Authorization: Bearer $TOKEN"
