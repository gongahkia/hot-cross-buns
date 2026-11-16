import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Button, InlineError, Muted } from '../styles';
import { loadWorkspaceArchive, startMarkdownWorkspace, type TodoState, type ScratchpadState } from '../todoStore';
import { journalFromModel } from '../journalDocument';
import { normalizeDocument, serializeTodoText } from '../todoText';
import { downloadTextFile } from '../files';

const Wrap = styled.main`width:min(650px,calc(100% - 40px));margin:60px auto;color:var(--ink);h1{font-size:24px;}p{line-height:1.6;}pre{max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;}button{margin:8px 8px 0 0;}`;
type Archive = NonNullable<Awaited<ReturnType<typeof loadWorkspaceArchive>>>;

export function WorkspaceTransition({ archive, onReady }: { archive: Archive; onReady: () => void }) {
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const old = archive.state.current as TodoState | undefined;
  const scratch = archive.scratchpad.current as ScratchpadState | undefined;
  const preview = useMemo(() => {
    try { return { source: journalFromModel(old ? normalizeDocument(old.document) : { days: [] }, scratch?.text ?? '', 'transition-preview').source!, error: '' }; }
    catch (error) { return { source: '', error: String(error) }; }
  }, [archive]);
  const start = async (convert: boolean) => {
    setBusy(true); setError('');
    try { await startMarkdownWorkspace(convert); onReady(); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const recover = () => {
    const output = JSON.stringify({ format: 'hcb-txt-workspace-recovery', ...archive }, (_key,value) =>
      value && typeof value === 'object' && ['file','directory'].includes(value.kind) && typeof value.name === 'string'
        ? { kind: value.kind, name: value.name, browserHandleKept: true } : value, 2);
    downloadTextFile(output,'Hot-Cross-Buns-TXT-recovery.json');
  };
  return <Wrap aria-label="Markdown workspace transition">
    <h1>Open your Markdown planner</h1>
    <p>This browser has an earlier TXT workspace. Choose how to begin. Its saved journal, scratchpad, file handles and pending sync records have been kept in a browser recovery archive.</p>
    <p>Converting puts the saved entries and scratchpad into one Markdown document. <strong>The scratchpad will be shared when you link that document.</strong> Appearance preferences stay local.</p>
    <p>Earlier file links stay archived. Link a new Planner.md file or folder target after this step. Existing TODO.txt files and remote history are not renamed, overwritten or deleted. Pending old submissions are preserved for recovery and are not sent automatically.</p>
    <details><summary>Preview converted Markdown</summary>{preview.error ? <InlineError>{preview.error}</InlineError> : <><pre>{preview.source.slice(0,24000)}</pre>{preview.source.length > 24000 && <Muted>Preview shortened. Download the complete converted source.</Muted>}<Button onClick={() => downloadTextFile(preview.source,'Planner-converted-preview.md')}>Download converted preview</Button></>}</details>
    <div><Button disabled={busy} onClick={recover}>Download workspace recovery</Button>{old && <Button disabled={busy} onClick={() => downloadTextFile(serializeTodoText(old.document),'TODO-before-Markdown.txt')}>Download original journal</Button>}{scratch && <Button disabled={busy} onClick={() => downloadTextFile(scratch.text,'scratchpad-before-Markdown.md')}>Download original scratchpad</Button>}</div>
    <p><Muted>The recovery JSON includes saved text and pending revisions. Browser file permissions cannot be transferred by a download; the original handles remain in this browser archive.</Muted></p>
    {error && <InlineError role="alert">{error}</InlineError>}
    <Button $primary disabled={busy || !!preview.error} onClick={() => void start(true)}>Convert saved workspace</Button>
    <Button disabled={busy} onClick={() => void start(false)}>Start an empty Markdown workspace</Button>
    <p><Muted>Both choices retain the earlier browser archive. Export it before clearing browser data.</Muted></p>
  </Wrap>;
}
