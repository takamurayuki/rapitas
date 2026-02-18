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

// Debug: List all directories in frontend
console.log('Checking frontend directory structure:');
console.log('Frontend path:', FRONTEND_DIR);
try {
  const frontendContents = fs.readdirSync(FRONTEND_DIR);
  console.log('Frontend directory contents:', frontendContents);

  // Check for .next directory
  if (fs.existsSync(path.join(FRONTEND_DIR, '.next'))) {
    console.log('.next directory exists');
    const nextContents = fs.readdirSync(path.join(FRONTEND_DIR, '.next'));
    console.log('.next directory contents:', nextContents);
  }

  // Check for out directory
  if (fs.existsSync(path.join(FRONTEND_DIR, 'out'))) {
    console.log('out directory exists');
    const outContents = fs.readdirSync(path.join(FRONTEND_DIR, 'out'));
    console.log('out directory contents:', outContents);
  }

  // Check if running in CI environment
  console.log('CI environment:', process.env.CI);
  console.log('TAURI_BUILD env:', process.env.TAURI_BUILD);
  console.log('NEXT_TURBO env:', process.env.NEXT_TURBO);
} catch (error) {
  console.error('Error checking directory structure:', error);
}

// Check both possible output directories
// Note: When TAURI_BUILD=true and distDir='.next-tauri', the static export
// still goes to the 'out' directory, but it might be at the root level
const possibleDirs = [
  path.join(FRONTEND_DIR, 'out'),
  path.join(FRONTEND_DIR, '.next-tauri'),
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
  console.error('\nERROR: Frontend build output not found!');
  console.error('Checked directories:');
  possibleDirs.forEach(dir => console.error(' - ' + dir));
  console.error('\nMake sure to run "pnpm run build:tauri:ci" in the frontend directory first!');
  console.error('\nExpected flow:');
  console.error('1. Run "pnpm run build:tauri:ci" in rapitas-frontend');
  console.error('2. This should create an "out" directory with the static build');
  console.error('3. Then run "pnpm run ci:prepare" in rapitas-desktop');
  process.exit(1);
}

console.log('\nCI build preparation completed successfully!');