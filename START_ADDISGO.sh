#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "====================================================================="
echo "                AddisGo - Addis Ababa City Guide"
echo "     Electric Mobility, Verified Local Guides & Small-Group Tours"
echo "====================================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed. Please install Node 22+ from https://nodejs.org"
  exit 1
fi

(sleep 2 && (command -v xdg-open >/dev/null && xdg-open "http://localhost:3003" || open "http://localhost:3003")) &

echo "Running at http://localhost:3003"
echo "Press Ctrl+C to stop."
echo ""

node api/server.js
