#!/usr/bin/env node
/**
 * Prepare backend binary for Tauri build in CI/CD
 * This script handles the backend binary resource configuration dynamically
 */
const fs = require('fs');
const path = require('path');

// Get the target from environment or command line
const target = process.env.TARGET || process.argv[2] || 'x86_64-unknown-linux-gnu';
const isWindows = target.includes('windows');
const isMacos = target.includes('apple-darwin');
const isLinux = target.includes('linux');

// Determine the binary name based on target
let binaryName;
if (isWindows) {
  binaryName = `rapitas-backend-${target}.exe`;
} else if (isMacos) {
  binaryName = `rapitas-backend-${target}`;
} else {
  binaryName = `rapitas-backend-${target}`;
}

// Path to binaries directory
const binariesDir = path.join(__dirname, '..', 'src-tauri', 'binaries');
const binaryPath = path.join(binariesDir, binaryName);

// Ensure binaries directory exists
if (!fs.existsSync(binariesDir)) {
  fs.mkdirSync(binariesDir, { recursive: true });
  console.log(`Created binaries directory: ${binariesDir}`);
}

// Check if binary exists
if (!fs.existsSync(binaryPath)) {
  console.log(`Backend binary not found: ${binaryPath}`);
  console.log(`Looking for alternatives in ${binariesDir}...`);

  const files = fs.readdirSync(binariesDir);
  console.log('Found files:', files);

  // Try to find any rapitas-backend file
  const backendFile = files.find(f => f.startsWith('rapitas-backend') && !f.includes('placeholder'));
  if (backendFile) {
    console.log(`Found alternative: ${backendFile}`);
    // Create a symlink or copy with the expected name
    const alternativePath = path.join(binariesDir, backendFile);
    try {
      fs.copyFileSync(alternativePath, binaryPath);
      console.log(`Copied ${backendFile} to ${binaryName}`);
    } catch (e) {
      console.error(`Failed to copy binary: ${e.message}`);
    }
  }
}

// Read the build config
const configPath = path.join(__dirname, '..', 'src-tauri', 'tauri.build.conf.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error(`Failed to read tauri.build.conf.json: ${e.message}`);
  process.exit(1);
}

// Update resources to include the specific binary file
if (!config.bundle) {
  config.bundle = {};
}

// Remove glob patterns and add specific file
config.bundle.resources = [
  {
    path: "../../rapitas-backend/prisma/migrations",
    target: "migrations"
  },
  {
    path: "../../rapitas-backend/prisma/schema.prisma",
    target: "schema.prisma"
  }
];

// Set externalBin to include the specific binary file
if (fs.existsSync(binaryPath)) {
  config.bundle.externalBin = [`binaries/${binaryName}`];
  console.log(`Set externalBin to include ${binaryName}`);
} else {
  // Check for any existing backend binary
  let foundBinary = null;
  if (fs.existsSync(binariesDir)) {
    const files = fs.readdirSync(binariesDir);
    foundBinary = files.find(f => f.startsWith('rapitas-backend') && !f.includes('placeholder'));
  }

  if (foundBinary) {
    config.bundle.externalBin = [`binaries/${foundBinary}`];
    console.log(`Using alternative binary: ${foundBinary}`);
  } else {
    console.warn(`Warning: No backend binary found in ${binariesDir}`);
    // Create an empty placeholder file to prevent build failure
    const placeholderName = isWindows ? 'rapitas-backend-placeholder.exe' : 'rapitas-backend-placeholder';
    const placeholderPath = path.join(binariesDir, placeholderName);

    if (!fs.existsSync(binariesDir)) {
      fs.mkdirSync(binariesDir, { recursive: true });
    }

    // Create empty placeholder file
    fs.writeFileSync(placeholderPath, '');
    if (!isWindows) {
      fs.chmodSync(placeholderPath, 0o755);
    }

    config.bundle.externalBin = [`binaries/${placeholderName}`];
    console.log(`Created placeholder binary: ${placeholderName}`);
  }
}

// Write the updated config
try {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('Updated tauri.build.conf.json successfully');
} catch (e) {
  console.error(`Failed to write tauri.build.conf.json: ${e.message}`);
  process.exit(1);
}