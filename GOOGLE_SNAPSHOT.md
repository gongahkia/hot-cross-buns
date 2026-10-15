# One-time Google snapshot

`scripts/pull_google_snapshot.py` saves Google Calendar and Google Tasks API responses as local JSON. It does **not** convert them to Hito `TODO.txt` or change browser data. The later conversion step can inspect this snapshot without making another Google request.

## Set up

1. In a Google Cloud project, enable **Google Calendar API** and **Google Tasks API**.
2. Configure the OAuth consent screen and create or reuse an OAuth client with application type **Desktop app**. An API key or a client ID alone cannot grant access to your private calendars and tasks. Google’s [Calendar Python quickstart](https://developers.google.com/workspace/calendar/api/quickstart/python) walks through these steps.
3. Install the script’s Python dependencies:

   ```sh
   python3 -m venv .local/google-venv
   .local/google-venv/bin/python -m pip install -r scripts/google_snapshot_requirements.txt
   ```

4. Run the pull. In a terminal, the script asks whether to use the downloaded Desktop client JSON or an env file, then asks for its path. The env path defaults to this repository's `.env`. For automated runs, specify a source directly:

   ```sh
   .local/google-venv/bin/python scripts/pull_google_snapshot.py --credentials /path/to/client_secret.json
   .local/google-venv/bin/python scripts/pull_google_snapshot.py --env-file .env
   ```

   The env file needs `CLIENT_ID=...` and `CLIENT_SECRET=...` from the **same Desktop app OAuth client**. Plain or single/double quoted values are accepted. The script reads these values as text; it does not run the env file or write another copy of them. Keep the env file private, for example with `chmod 600 .env` on macOS/Linux. The JSON and env methods request the same read-only scopes and still require you to complete browser sign-in and consent.

The script opens Google’s consent page in your browser. It requests only `calendar.readonly` and `tasks.readonly`. Each run asks you to sign in again; it does not save OAuth access or refresh tokens. Use `--output /path/to/snapshot.json` to choose a destination. The default is a timestamped JSON file under `.local/`, which Git ignores.

## What is saved

The snapshot contains each raw, paginated response, the query used for each collection, and UTC start and finish times. It includes the user’s visible and hidden calendar-list entries, events from each listed calendar, task lists, and tasks from each list. Calendar events are **not expanded into recurring instances**, preserving recurring event rules and exceptions. The script requests cancelled events and hidden invitations, plus completed, hidden, deleted, and assigned tasks. These choices follow Google’s [Calendar events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) and [Tasks list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list) parameters.

The script follows every `nextPageToken`; a short or empty page does not end the pull. The JSON has format marker `hito-google-raw-v1`. It preserves the API objects as returned, including fields Hito may not support yet.

The output is a snapshot of records available through these APIs and the signed-in account’s permissions. Google may omit old deleted data or details of shared calendars that the account cannot read. If any request fails, no new snapshot is published. Existing output files are never replaced. Keep the OAuth client JSON and snapshot private; both the default output directory and common downloaded client JSON names are Git-ignored.
