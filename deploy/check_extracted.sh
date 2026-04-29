#!/bin/sh
docker exec disparo_mysql mysql -udisparo -pDisparo@2026 disparo_whats -e "SELECT phone, jid, name FROM contacts WHERE list_id = '71f0b069-d4f9-431b-bce0-a71648500b3c' LIMIT 15;"
echo
echo "=== Quantos com LID, quantos com phone real ==="
docker exec disparo_mysql mysql -udisparo -pDisparo@2026 disparo_whats -e "SELECT (CASE WHEN jid LIKE '%@lid' THEN 'lid' ELSE 'phone' END) AS tipo, COUNT(*) AS total FROM contacts WHERE list_id = '71f0b069-d4f9-431b-bce0-a71648500b3c' GROUP BY tipo;"
