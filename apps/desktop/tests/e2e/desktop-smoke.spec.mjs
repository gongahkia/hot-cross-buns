import { createServer } from 'node:http';

import { expect } from 'chai';

import {
  By,
  Key,
  cleanupProfileDir,
  click,
  createProfileDir,
  ensureDriverEnvironment,
  executeScript,
  launchApp,
  listButtonByName,
  quitApp,
  restartApp,
  shutdownDriverEnvironment,
  sleep,
  taskButtonByTitle,
  textContent,
  typeInto,
  waitForGone,
  waitForVisible,
} from './support/tauri-driver.mjs';

describe('Hot Cross Buns desktop smoke tests', function () {
  this.timeout(180000);

  let activeProfileDir;

  before(async function () {
    if (process.platform !== 'linux') {
      this.skip();
      return;
    }

    await ensureDriverEnvironment();
  });

  after(async () => {
    await shutdownDriverEnvironment();
  });

  afterEach(async () => {
    await quitApp();

    if (activeProfileDir) {
      await cleanupProfileDir(activeProfileDir);
      activeProfileDir = undefined;
    }
  });

  it('bootstraps Inbox and preserves a created list and task across restart', async () => {
    activeProfileDir = await createProfileDir();
    await launchApp(activeProfileDir);

    await waitForVisible(By.css('.sidebar'));
    const inboxButton = await waitForVisible(listButtonByName('Inbox'));
    expect(await inboxButton.isDisplayed()).to.equal(true);

    const listName = `E2E Project ${Date.now()}`;
    await click(By.css('.new-list-btn'));
    const newListInput = await typeInto(By.css('.new-list-input'), listName);
    await newListInput.sendKeys(Key.ENTER);
    await waitForVisible(listButtonByName(listName));

    const taskTitle = `Persisted task ${Date.now()}`;
    const quickAddInput = await typeInto(By.css('.quick-add-input'), taskTitle);
    await quickAddInput.sendKeys(Key.ENTER);
    const taskButton = await waitForVisible(taskButtonByTitle(taskTitle));
    expect(await taskButton.getText()).to.equal(taskTitle);

    await restartApp(activeProfileDir);

    await waitForVisible(By.css('.sidebar'));
    await waitForVisible(listButtonByName('Inbox'));
    await click(listButtonByName(listName));
    const persistedTaskButton = await waitForVisible(taskButtonByTitle(taskTitle));
    expect(await persistedTaskButton.getText()).to.equal(taskTitle);
  });

  it('reloads persisted sync settings and runs manual sync against the real command path', async () => {
    const syncRequests = [];
    const fakeSyncServer = await startFakeSyncServer(syncRequests);

    try {
      activeProfileDir = await createProfileDir();
      await launchApp(activeProfileDir);

      await click(By.css('button[aria-label="Sync settings"]'));
      await waitForVisible(By.css('.sync-overlay'));

      const serverUrl = `http://127.0.0.1:${fakeSyncServer.port}`;
      await typeInto(By.id('sync-server-url'), serverUrl);
      await typeInto(By.id('sync-auth-token'), 'e2e-auth-token');
      await click(By.css('.panel-close'));
      await waitForGone(By.css('.sync-overlay'));
      await sleep(500);

      await restartApp(activeProfileDir);

      await click(By.css('button[aria-label="Sync settings"]'));
      const serverUrlInput = await waitForVisible(By.id('sync-server-url'));
      const authTokenInput = await waitForVisible(By.id('sync-auth-token'));
      expect(await serverUrlInput.getAttribute('value')).to.equal(serverUrl);
      expect(await authTokenInput.getAttribute('value')).to.equal('e2e-auth-token');

      await click(By.css('.sync-now-btn'));
      const summary = await waitForVisible(By.css('.sync-summary'));
      expect(await summary.getText()).to.match(/^Pushed \d+, Pulled \d+, Conflicts 0$/);

      await waitForSyncRequests(syncRequests, 2);
      const pushRequest = syncRequests.find((entry) => entry.path === '/api/v1/sync/push');
      const pullRequest = syncRequests.find((entry) => entry.path === '/api/v1/sync/pull');

      expect(pushRequest).to.not.equal(undefined);
      expect(pullRequest).to.not.equal(undefined);
      expect(pushRequest.headers.authorization).to.equal('Bearer e2e-auth-token');
      expect(pullRequest.headers.authorization).to.equal('Bearer e2e-auth-token');
      expect(pullRequest.body).to.have.property('deviceId').that.is.a('string').and.is.not.empty;

      expect(await textContent(By.css('.panel-title'))).to.equal('Sync Settings');
    } finally {
      await fakeSyncServer.close();
    }
  });

  it('records cold-start metrics under the CI regression ceiling for a benchmark-sized dataset', async () => {
    activeProfileDir = await createProfileDir();
    await launchApp(activeProfileDir, {
      env: {
        HOTCROSSBUNS_BENCHMARK_SEED: '2000',
      },
    });

    await waitForVisible(By.css('.sidebar'));

    const metrics = await waitForStartupMetrics();
    expect(metrics.bootstrapCompletedAt).to.be.a('number');
    expect(metrics.selectedListHydratedAt).to.be.a('number');
    expect(metrics.firstInteractiveAt).to.be.a('number');
    expect(metrics.firstInteractiveAt).to.be.lessThan(3000);
  });
});

async function startFakeSyncServer(requestLog) {
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    requestLog.push({
      path: request.url,
      method: request.method,
      headers: request.headers,
      body,
    });

    response.setHeader('Content-Type', 'application/json');

    if (request.url === '/api/v1/sync/push') {
      response.writeHead(200);
      response.end(
        JSON.stringify({
          batchId: body.batchId,
          accepted: Array.isArray(body.changes) ? body.changes.length : 0,
          conflicts: 0,
        })
      );
      return;
    }

    if (request.url === '/api/v1/sync/pull') {
      response.writeHead(200);
      response.end(
        JSON.stringify({
          changes: [],
          serverTime: new Date().toISOString(),
        })
      );
      return;
    }

    response.writeHead(404);
    response.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind fake sync server');
  }

  return {
    port: address.port,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

async function waitForSyncRequests(requestLog, expectedCount) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    if (requestLog.length >= expectedCount) {
      return;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${expectedCount} sync requests`);
}

async function waitForStartupMetrics() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    const metrics = await executeScript(() => window.__HOTCROSSBUNS_STARTUP_METRICS__ ?? null);
    if (metrics?.firstInteractiveAt !== null) {
      return metrics;
    }

    await sleep(200);
  }

  throw new Error('Timed out waiting for startup metrics');
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
