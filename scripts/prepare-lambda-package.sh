#!/usr/bin/env bash

set -euo pipefail

BUILD_DIR="build/lambda"

if [ ! -d node_modules ]; then
  echo "node_modules was not found. Run npm install before packaging the Lambda bundle." >&2
  exit 1
fi

mkdir -p build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cp -R src "$BUILD_DIR/src"
cp -R node_modules "$BUILD_DIR/node_modules"
