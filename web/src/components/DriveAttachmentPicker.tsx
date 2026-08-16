import { useState } from "react";

import type { GoogleDriveFile, GoogleEventAttachment } from "@/types";

interface DriveAttachmentPickerProps {
  readonly authorized: boolean;
  authorize(): Promise<void>;
  search(query: string): Promise<GoogleDriveFile[]>;
  addAttachment(attachment: GoogleEventAttachment): void;
}

export function DriveAttachmentPicker({ authorized, authorize, search, addAttachment }: DriveAttachmentPickerProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GoogleDriveFile[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function runSearch(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      setResults(await search(query));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Drive search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="attachment-picker">
      <legend>Google Drive attachments</legend>
      {!authorized ? (
        <button type="button" onClick={() => void authorize().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Drive authorization failed"))}>
          Authorize Drive metadata
        </button>
      ) : (
        <div className="inline-form">
          <input aria-label="Search Drive files" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search existing Drive files" />
          <button type="button" disabled={busy || !query.trim()} onClick={() => void runSearch()}>{busy ? "Searching…" : "Search"}</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="drive-results">
        {results.map((file) => (
          <li key={file.id}>
            <span>{file.name}</span>
            <button
              type="button"
              disabled={!file.webViewLink}
              onClick={() => file.webViewLink && addAttachment({ fileUrl: file.webViewLink, title: file.name, mimeType: file.mimeType })}
            >
              Attach
            </button>
          </li>
        ))}
      </ul>
      <p className="field-help">Only file metadata and a selected file link are used. File contents are never read.</p>
    </fieldset>
  );
}
