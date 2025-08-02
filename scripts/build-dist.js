#!/usr/bin/env node

/**
 * Build distribution script for CollabFlow platform
 * Cross-platform implementation of build:dist command
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runCommand(command, options = {}) {
  try {
    console.log(`Running: ${command}`);
    execSync(command, { stdio: 'inherit', ...options });
  } catch (error) {
    console.error(`Error running command: ${command}`);
    process.exit(1);
  }
}

function copyRecursive(src, dest) {
  const srcPath = path.resolve(src);
  const destPath = path.resolve(dest);

  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠️  Source path does not exist: ${srcPath}`);
    return;
  }

  console.log(`Copying ${srcPath} -> ${destPath}`);

  try {
    // Ensure parent directory exists
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy with recursive and preserve timestamps (equivalent to cp -a)
    fs.cpSync(srcPath, destPath, {
      recursive: true,
      preserveTimestamps: true,
      force: true
    });

    console.log(`✅ Successfully copied ${src} to ${dest}`);
  } catch (error) {
    console.error(`❌ Error copying ${src} to ${dest}:`, error.message);
    process.exit(1);
  }
}

console.log('\n🏗️  Building distribution for CollabFlow platform...\n');

// Step 1: Clean dist directory
console.log('🧹 Cleaning dist directory...');
runCommand('shx rm -rf dist');

// Step 2: Build workspaces
console.log('\n📦 Building workspaces...');
runCommand('npm run build:dist --workspaces --if-present');

// Step 3: Copy backend dist to dist
console.log('\n📂 Copying backend distribution...');
copyRecursive('backend/dist', 'dist');

// Step 4: Copy frontend out to dist/public
console.log('\n📂 Copying frontend distribution...');
copyRecursive('frontend/out', 'dist/public');

console.log('\n✅ Distribution build complete!\n');
