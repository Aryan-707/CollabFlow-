#!/usr/bin/env node

/**
 * Post-install script for CollabFlow platform
 * Sets up Husky git hooks after installation
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runCommand(command, options = {}) {
  try {
    console.log(`Running: ${command}`);
    execSync(command, { stdio: 'inherit', ...options });
  } catch (error) {
    if (options.ignoreError) {
      console.warn(`⚠️  ${options.errorMessage || 'Command failed but continuing...'}`);
    } else {
      console.error(`Error running command: ${command}`);
      process.exit(1);
    }
  }
}

function isCI() {
  // Check for common CI environment variables
  return !!(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.BUILD_NUMBER ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.JENKINS_URL
  );
}

console.log('\n📦 Running postinstall for CollabFlow platform...\n');

// Skip husky setup in CI environments or if .git doesn't exist
const gitDir = path.join(__dirname, '..', '.git');
if (isCI()) {
  console.log('🤖 CI environment detected, skipping Husky setup\n');
} else if (!fs.existsSync(gitDir)) {
  console.log('📁 Not a git repository, skipping Husky setup\n');
} else {
  // Run husky setup
  console.log('🐶 Setting up Husky git hooks...\n');
  runCommand('npx husky', {
    ignoreError: true,
    errorMessage: 'Husky setup failed (may not be needed)'
  });
}

console.log('✅ Postinstall complete!\n');
