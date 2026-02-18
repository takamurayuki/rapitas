#!/usr/bin/env node
/**
 * CI Build Script
 *
 * This script is used in CI/CD environments to prepare the Tauri build.
 * It skips database operations and development server startup.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Define paths
const DESKTOP_DIR = path.join(__dirname, '..');
const BACKEND_DIR = path.join(__dirname, '..', '..', 'rapitas-backend');
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'rapitas-frontend');

console.log('CI Build Script - Preparing for Tauri build...\n');

// Create binaries directory
const binariesDir = path.join(DESKTOP_DIR, 'src-tauri', 'binaries');
if (!fs.existsSync(binariesDir)) {
  fs.mkdirSync(binariesDir, { recursive: true });
  console.log('Created binaries directory');
}

// Copy frontend build output
const frontendBuildDir = path.join(FRONTEND_DIR, 'out');
const desktopPublicDir = path.join(DESKTOP_DIR, 'public');

// Check both possible output directories
const possibleDirs = [
  path.join(FRONTEND_DIR, 'out'),
  path.join(FRONTEND_DIR, '.next-tauri', 'out'),
  path.join(FRONTEND_DIR, '.next', 'out')
];

let foundBuildDir = null;
for (const dir of possibleDirs) {
  if (fs.existsSync(dir)) {
    foundBuildDir = dir;
    console.log('Found frontend build output at:', dir);
    break;
  }
}

if (foundBuildDir) {
  console.log('Copying frontend build output...');
  // Remove existing public directory
  if (fs.existsSync(desktopPublicDir)) {
    fs.rmSync(desktopPublicDir, { recursive: true, force: true });
  }
  // Copy frontend build to public
  fs.cpSync(foundBuildDir, desktopPublicDir, { recursive: true });
  console.log('Frontend build copied to public directory');
} else {
  console.error('Frontend build output not found. Checked directories:');
  possibleDirs.forEach(dir => console.error(' - ' + dir));
  process.exit(1);
}

console.log('\nCI build preparation completed successfully!');