#!/bin/bash
set -e

echo "=== Vercel Build Script ==="

# Clean etims dist to avoid TS5055 error
echo "Cleaning @zfloat/etims dist..."
rm -rf packages/etims/dist

# Build in dependency order (sequential)
echo "Building @zfloat/etims..."
pnpm --filter @zfloat/etims build

echo "Building @zfloat/payments-core..."
pnpm --filter @zfloat/payments-core build

echo "Building all other packages..."
pnpm -r --workspace-concurrency=1 --filter './packages/*' --filter './services/*' build

# Build web
echo "Building @zfloat/web..."
pnpm --filter @zfloat/web build

echo "=== Build Complete ==="