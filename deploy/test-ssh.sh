#!/bin/bash
ssh -i "$USERPROFILE/.ssh/disparo_vps" \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=10 \
    root@178.238.236.103 "echo SSH_OK && uname -a"
