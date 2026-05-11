#!/bin/bash
set -e
cd "$1"
npm install --silent --no-audit --no-fund
npm test
