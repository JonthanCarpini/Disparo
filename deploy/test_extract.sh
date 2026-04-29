#!/bin/sh
TOKEN=$(curl -s -X POST http://localhost:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@2026"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

SESSION_ID=$(curl -s http://localhost:3333/api/whatsapp/sessions \
  -H "Authorization: Bearer $TOKEN" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "Session: $SESSION_ID"

GROUP_ID=$(curl -s "http://localhost:3333/api/whatsapp/sessions/$SESSION_ID/groups" \
  -H "Authorization: Bearer $TOKEN" | grep -o '"id":"[^"]*calcado[^"]*"\|"id":"120363425188652308@g.us"' | head -1 | cut -d'"' -f4)
echo "Group: $GROUP_ID"

echo "Extraindo..."
curl -s -X POST "http://localhost:3333/api/contacts/extract-group" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"groupId\":\"$GROUP_ID\",\"listName\":\"calcados_test\"}"
echo
