import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Builder, By, Capabilities, Key, until } from 'selenium-webdriver';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const SRC_TAURI_ROOT = path.join(APP_ROOT, 'src-tauri');
const DRIVER_URL = 'http://127.0.0.1:4444/';

let tauriDriverProcess;
let currentDriver;
let applicationBinary;

function resolveTauriDriverBinary() {
  if (process.env.TAURI_DRIVER_PATH) {
    return process.env.TAURI_DRIVER_PATH;
  }

  return path.join(os.homedir(), '.cargo', 'bin', 'tauri-driver');
}

async function waitForDriverReady(timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`${DRIVER_URL}status`, (response) => {
          response.resume();
          resolve();
        });
        req.on('error', reject);
      });
      return;
    } catch {
      await sleep(250);
    }
  }

  throw new Error('tauri-driver did not become ready in time');
}

function buildDesktopApp() {
  const result = spawnSync('npm', ['run', 'tauri', '--', 'build', '--debug', '--no-bundle'], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error(`Failed to build desktop app, exit code ${result.status}`);
  }
}

async function resolveApplicationBinary() {
  if (applicationBinary) {
    return applicationBinary;
  }

  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(SRC_TAURI_ROOT, 'target', 'debug', 'Hot Cross Buns.app', 'Contents', 'MacOS', 'Hot Cross Buns'),
      path.join(SRC_TAURI_ROOT, 'target', 'debug', 'hot-cross-buns')
    );
  } else if (process.platform === 'win32') {
    candidates.push(path.join(SRC_TAURI_ROOT, 'target', 'debug', 'hot-cross-buns.exe'));
  } else {
    candidates.push(
      path.join(SRC_TAURI_ROOT, 'target', 'debug', 'hot-cross-buns'),
      path.join(SRC_TAURI_ROOT, 'target', 'debug', 'Hot Cross Buns')
    );
  }

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      applicationBinary = candidate;
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Could not find the built desktop binary. Tried: ${candidates.join(', ')}`);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function writeLaunchScript(profileDir, env = {}) {
  const binaryPath = await resolveApplicationBinary();
  const scriptPath = path.join(profileDir, process.platform === 'win32' ? 'launch-app.cmd' : 'launch-app.sh');
  const dataHome = path.join(profileDir, 'data');
  const homeDir = path.join(profileDir, 'home');

  await fs.mkdir(dataHome, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });

  if (process.platform === 'win32') {
    const script = [
      '@echo off',
      `set "XDG_DATA_HOME=${dataHome}"`,
      `set "HOME=${homeDir}"`,
      ...Object.entries(env).map(([key, value]) => `set "${key}=${value}"`),
      `"${binaryPath}" %*`,
      '',
    ].join('\r\n');
    await fs.writeFile(scriptPath, script, 'utf8');
  } else {
    const script = [
      '#!/bin/sh',
      `export XDG_DATA_HOME=${shellEscape(dataHome)}`,
      `export HOME=${shellEscape(homeDir)}`,
      ...Object.entries(env).map(([key, value]) => `export ${key}=${shellEscape(value)}`),
      `exec ${shellEscape(binaryPath)} "$@"`,
      '',
    ].join('\n');
    await fs.writeFile(scriptPath, script, 'utf8');
    await fs.chmod(scriptPath, 0o755);
  }

  return scriptPath;
}

export async function ensureDriverEnvironment() {
  buildDesktopApp();

  const tauriDriverBinary = resolveTauriDriverBinary();
  try {
    await fs.access(tauriDriverBinary);
  } catch {
    throw new Error(`tauri-driver is not installed at ${tauriDriverBinary}`);
  }

  tauriDriverProcess = spawn(tauriDriverBinary, [], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  tauriDriverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      // Surface unexpected exits in the test logs.
      console.error(`tauri-driver exited unexpectedly with code ${code}`);
    }
  });

  await waitForDriverReady();
}

export async function shutdownDriverEnvironment() {
  await quitApp();

  if (tauriDriverProcess) {
    tauriDriverProcess.kill();
    tauriDriverProcess = undefined;
  }
}

export async function createProfileDir(prefix = 'hotcrossbuns-e2e-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function launchApp(profileDir, options = {}) {
  const application = await writeLaunchScript(profileDir, options.env ?? {});
  const capabilities = new Capabilities();
  capabilities.setBrowserName('wry');
  capabilities.set('tauri:options', { application });

  currentDriver = await new Builder()
    .usingServer(DRIVER_URL)
    .withCapabilities(capabilities)
    .build();

  await waitForVisible(By.css('.app'));
  return currentDriver;
}

export async function restartApp(profileDir, options = {}) {
  await quitApp();
  return launchApp(profileDir, options);
}

export async function quitApp() {
  if (!currentDriver) {
    return;
  }

  try {
    await currentDriver.quit();
  } finally {
    currentDriver = undefined;
  }
}

export function getDriver() {
  if (!currentDriver) {
    throw new Error('The Tauri app is not currently running');
  }

  return currentDriver;
}

export async function executeScript(script, ...args) {
  return getDriver().executeScript(script, ...args);
}

export async function cleanupProfileDir(profileDir) {
  await fs.rm(profileDir, { recursive: true, force: true });
}

export async function waitForVisible(locator, timeoutMs = 15000) {
  const driver = getDriver();
  const element = await driver.wait(until.elementLocated(locator), timeoutMs);
  await driver.wait(until.elementIsVisible(element), timeoutMs);
  return element;
}

export async function waitForGone(locator, timeoutMs = 15000) {
  const driver = getDriver();

  await driver.wait(async () => {
    const elements = await driver.findElements(locator);
    if (elements.length === 0) {
      return true;
    }

    try {
      return !(await elements[0].isDisplayed());
    } catch {
      return true;
    }
  }, timeoutMs);
}

export async function typeInto(locator, value) {
  const element = await waitForVisible(locator);
  await element.clear();
  await element.sendKeys(value);
  return element;
}

export async function click(locator) {
  const element = await waitForVisible(locator);
  await element.click();
  return element;
}

export async function textContent(locator) {
  const element = await waitForVisible(locator);
  return element.getText();
}

export function listButtonByName(name) {
  return By.xpath(`//button[contains(@class, 'list-item')][.//*[normalize-space()=${xpathLiteral(name)}]]`);
}

export function taskButtonByTitle(title) {
  return By.css(`button[aria-label="Select task: ${cssEscape(title)}"]`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function xpathLiteral(value) {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }

  const parts = value.split("'").map((part) => `'${part}'`);
  return `concat(${parts.join(`, "'", `)})`;
}

function cssEscape(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export { By, Key, until };
