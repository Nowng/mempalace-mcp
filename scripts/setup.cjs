#!/usr/bin/env node
/*
 * Postinstall entry point.
 *
 * Clones the MemPalace source tree, builds a Python venv, and installs
 * MemPalace (together with its Python dependencies) into that venv.
 *
 * This file runs automatically on `npm install` via the "postinstall" script
 * declared in package.json. When LM Studio installs this plugin from the Hub,
 * it executes npm install, so the whole MemPalace environment is provisioned
 * before the plugin is first used.
 *
 * Kept as ".cjs" on purpose: this package is ESM ("type": "module"), so a
 * plain ".js" file would be interpreted as an ES module where require() and
 * __dirname are not available. CommonJS keeps the install script simple and
 * robust across environments.
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MEMPALACE_DIR = path.join(ROOT, 'MemPalace');
const VENV_DIR = path.join(ROOT, '.venv');

function run(cmd) {
  console.log('[setup] $ ' + cmd);
  execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
}

// Resolve the venv python executable for the current platform.
function venvPython() {
  if (process.platform === 'win32') {
    return path.join(VENV_DIR, 'Scripts', 'python.exe');
  }
  return path.join(VENV_DIR, 'bin', 'python');
}

// [a] Clone the MemPalace source tree. Skip when already present so that a
//     future `git pull` inside MemPalace keeps working and stays up to date.
function ensureClone() {
  if (fs.existsSync(path.join(MEMPALACE_DIR, '.git'))) {
    console.log('[setup] MemPalace already cloned; skipping clone.');
    return;
  }
  console.log('[setup] Cloning MemPalace source tree...');
  run('git clone https://github.com/MemPalace/mempalace ' + MEMPALACE_DIR);
}

// Find a working Python interpreter. In some sandboxed environments the `python3`
// on PATH is a symlink whose sys.executable resolves to an empty string, which
// breaks `venv`. Prefer absolute paths to real interpreters and verify each one.
function findPython() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push('python');
  } else {
    // Absolute paths first — these work even when the PATH symlink is broken.
    for (const p of [
      '/usr/bin/python3.14',
      '/usr/bin/python3.13',
      '/usr/bin/python3.12',
      '/usr/bin/python3.11',
      '/usr/bin/python3.10',
      '/usr/bin/python3',
      '/usr/local/bin/python3',
    ]) {
      if (fs.existsSync(p)) candidates.push(p);
    }
    candidates.push('python3', 'python');
  }

  for (const py of candidates) {
    try {
      const exe = execSync('"' + py + '" -c "import sys; print(sys.executable)"', {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (exe) return py;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(
    'No working Python interpreter found. Ensure python3 (>=3.9) is installed and on PATH.',
  );
}

// [b] Create the Python virtual environment if it does not exist yet.
function ensureVenv() {
  if (fs.existsSync(venvPython())) {
    console.log('[setup] venv already exists; skipping creation.');
    return;
  }
  const pythonBin = findPython();
  console.log('[setup] Creating Python venv at ' + VENV_DIR + ' (using ' + pythonBin + ') ...');
  run(pythonBin + ' -m venv ' + VENV_DIR);
}

// [c] Install MemPalace (and its dependencies) into the venv.
function installPackage() {
  const py = venvPython();
  console.log('[setup] Upgrading pip/setuptools/wheel...');
  run('"' + py + '" -m pip install --upgrade pip setuptools wheel');
  console.log('[setup] Installing MemPalace (editable) from ' + MEMPALACE_DIR + ' ...');
  run('"' + py + '" -m pip install -e "' + MEMPALACE_DIR + '"');
}

try {
  ensureClone();
  ensureVenv();
  installPackage();
  console.log('[setup] Done. MemPalace MCP server is ready.');
} catch (err) {
  console.error('[setup] FAILED: ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
