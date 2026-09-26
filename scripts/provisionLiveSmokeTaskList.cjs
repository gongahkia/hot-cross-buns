const { _electron: electron } = require("@playwright/test");
const { resolve } = require("node:path");

const acknowledgement = "I_UNDERSTAND_HCB_LIVE_TEST_WRITES_AND_DELETES";
const profileDir = requiredEnvironment("HCB_LIVE_GOOGLE_PROFILE_DIR");
const accountEmail = requiredEnvironment("HCB_LIVE_GOOGLE_TEST_ACCOUNT_EMAIL").toLowerCase();
const taskListName = requiredEnvironment("HCB_LIVE_GOOGLE_TEST_TASK_LIST_NAME");

if (process.env.HCB_LIVE_GOOGLE_TEST_MODE !== "mutating") {
  throw new Error("Provisioning requires HCB_LIVE_GOOGLE_TEST_MODE=mutating.");
}

if (process.env.HCB_LIVE_GOOGLE_TEST_MUTATION_ACK !== acknowledgement) {
  throw new Error("Provisioning requires the explicit live-test mutation acknowledgement.");
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before provisioning the smoke task list.`);
  return value;
}

function requireSuccess(result, label) {
  if (!result?.ok || result.data === undefined) {
    throw new Error(`${label} failed: ${result?.error?.message ?? "No result returned"}`);
  }
  return result.data;
}

async function main() {
  const app = await electron.launch({
    args: [resolve(__dirname, ".."), `--user-data-dir=${profileDir}`],
    env: { ...process.env, NODE_ENV: "test" }
  });

  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="app-shell"]');
    const result = await page.evaluate(async ({ accountEmail, taskListName }) => {
      const googleStatus = await window.hcb?.google.status();
      if (!googleStatus?.ok) return { error: googleStatus?.error?.message ?? "Google status was unavailable." };

      const accounts = googleStatus.data.accounts ?? (googleStatus.data.account ? [googleStatus.data.account] : []);
      const account = accounts.find((candidate) =>
        candidate.connectionState === "connected" && candidate.email?.toLowerCase() === accountEmail
      );
      if (!account) return { error: `No connected account matched ${accountEmail}.` };

      const status = await window.hcb?.sync.status();
      if (!status?.ok) return { error: status?.error?.message ?? "Sync status was unavailable." };
      if ((status.data.pendingMutationCount ?? 0) !== 0) {
        return { error: "The profile has pending mutations; refusing to provision the smoke task list." };
      }

      const listed = await window.hcb?.tasks.listTaskLists({ limit: 1_000 });
      if (!listed?.ok) return { error: listed?.error?.message ?? "Task-list lookup failed." };
      let matches = listed.data.items.filter((item) => item.accountId === account.accountId && item.title === taskListName);
      if (matches.length > 1) return { error: `Found ${matches.length} task lists named ${taskListName}; refusing to choose one.` };

      let created = false;
      if (matches.length === 0) {
        const create = await window.hcb?.tasks.createTaskList({ accountId: account.accountId, title: taskListName });
        if (!create?.ok) return { error: create?.error?.message ?? "Task-list creation failed." };
        created = true;
        const synced = await window.hcb?.sync.runNow({ accountId: account.accountId, reason: "live-google-provision-task-list" });
        if (!synced?.ok) return { error: synced?.error?.message ?? "Task-list provisioning sync failed." };
      }

      const verified = await window.hcb?.tasks.listTaskLists({ limit: 1_000 });
      if (!verified?.ok) return { error: verified?.error?.message ?? "Task-list verification failed." };
      matches = verified.data.items.filter((item) => item.accountId === account.accountId && item.title === taskListName);
      if (matches.length !== 1) return { error: `Expected exactly one task list named ${taskListName}; found ${matches.length}.` };

      return { created, ok: true };
    }, { accountEmail, taskListName });

    if (!result.ok) throw new Error(result.error ?? "Task-list provisioning failed.");
    process.stdout.write(`${result.created ? "Created" : "Verified existing"} dedicated task list: ${taskListName}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
