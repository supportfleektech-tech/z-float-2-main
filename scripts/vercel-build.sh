#!/bin/bash
set -e

# Build etims first (required by payments-core)
echo "Building @zfloat/etims..."
pnpm --filter @zfloat/etims build

# Build all other packages in dependency order (sequential)
echo "Building all packages..."
pnpm -r --workspace-concurrency=1 --filter './packages/*' --filter './services/*' build

# Build web
echo "Building @zfloat/web..."
pnpm --filter @zfloat/web build