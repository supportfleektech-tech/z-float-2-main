#!/bin/bash
set -e

# Clean etims dist to avoid TS5055 error
echo "Cleaning @zfloat/etims dist..."
rm -rf packages/etims/dist

# Build etims first (required by payments-core)
echo "Building @zfloat/etims..."
pnpm --filter @zfloat/etims build

# Build all other packages in dependency order (sequential)
echo "Building all packages..."
pnpm -r --workspace-concurrency=1 --filter './packages/*' --filter './services/*' build

# Build web
echo "Building @zfloat/web..."
pnpm --filter @zfloat/web build