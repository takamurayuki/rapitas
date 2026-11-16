'use strict';
/**
 * readme-restart.test
 *
 * Keeps rapitas-desktop/README.md honest about the pull that the app's
 * 再起動 performs. Checks key points, not exact wording, so a prose edit
 * does not break it.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const devSource = fs.readFileSync(path.join(__dirname, 'dev.js'), 'utf8');

/** Returns the README section that documents the restart pull. */
function restartSection() {
  const match = readme.match(/^#{3,4} [^\n]*再起動[^\n]*\n([\s\S]*?)(?=^#{1,4} |$(?![\s\S]))/m);
  return match ? match[0] : '';
}

describe('README: restart pull', () => {
  const section = restartSection();

  test('has a section about the restart', () => {
    assert.ok(section.length > 0, 'no heading mentioning 再起動');
  });

  test('says the restart pulls the latest develop', () => {
    assert.match(section, /develop/);
    assert.match(section, /fast-forward|取り込/);
    assert.match(section, /dev-pull\.cjs/);
  });

  test('states when the pull is skipped', () => {
    assert.match(section, /dirty/);
    assert.match(section, /分岐/);
    assert.match(section, /オフライン/);
    assert.match(section, /--no-pull/);
    assert.match(section, /RAPITAS_DEV_PULL=0/);
  });

  test('states that a change to dev.js needs a relaunch', () => {
    assert.match(section, /dev\.js/);
    assert.match(section, /起動し直/);
  });

  test('matches the implementation it describes', () => {
    assert.match(devSource, /pullLatestOnLaunch\('restart'\)/);
    assert.ok(fs.existsSync(path.join(__dirname, 'dev-pull.cjs')));
  });
});
