#!/bin/bash
set -euo pipefail

npx truffle migrate --config cfg/truffle-config.avalanche.js --network fuji --reset
