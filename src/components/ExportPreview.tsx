import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Button, Field } from '../styles';
import { Modal } from './Modal';

export type LineEnding = 'lf' | 'crlf';

const Layout = styled.div`
  display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 24px;
  @media (max-width: 700px) { grid-template-columns: 1fr; gap: 18px; }
`;
const Title = styled.h2`margin-bottom: 4px; font-size: 23px; font-weight: 600;`;
const Description = styled.p`margin-bottom: 18px; color: var(--muted); font-size: 13px;`;
const DocumentFrame = styled.div`
  min-width: 0; max-height: min(65dvh, 760px); overflow: auto;
  padding: 24px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--paper);
  @media (max-width: 700px) { max-height: 42dvh; padding: 16px; }
`;
const Text = styled.pre<{ $wrap: boolean }>`
  min-height: 260px; margin: 0; color: var(--ink);
  font: 13px/1.7 var(--raw-font); tab-size: 2;
  white-space: ${({ $wrap }) => $wrap ? 'pre-wrap' : 'pre'};
  overflow-wrap: ${({ $wrap }) => $wrap ? 'anywhere' : 'normal'};
  @media (max-width: 700px) { min-height: 160px; font-size: 12px; }
`;
const Empty = styled.p`color: var(--muted); font-size: 13px;`;
const Options = styled.div`display: flex; flex-direction: column; min-width: 0; gap: 17px;`;
const Label = styled.label`display: grid; gap: 6px; font-size: 13px;`;
const Select = styled.select`
  min-height: 44px; width: 100%; padding: 8px 10px;
  border: 1px solid var(--line); border-radius: 7px; background: var(--field); color: var(--ink);
  @media(pointer:coarse) { font-size:16px; }
`;
const Check = styled.label`display: flex; align-items: center; gap: 9px; min-height: 44px; font-size: 13px; cursor: pointer;`;
const Note = styled.p`color: var(--muted); font-size: 12px; line-height: 1.5;`;
const Actions = styled.div`
  display: flex; gap: 8px; justify-content: flex-end; margin-top: auto; padding-top: 12px;
  @media (max-width: 700px) { justify-content: stretch; > button { flex: 1; } }
`;

export function exportFileName(value: string) {
  const safe = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
  return safe ? safe.toLowerCase().endsWith('.txt') ? safe : `${safe}.txt` : 'TODO.txt';
}

export function ExportPreview({ open, text, onClose, onDownload }: {
  open: boolean; text: string; onClose: () => void;
  onDownload: (fileName: string, lineEnding: LineEnding) => void;
}) {
  const [fileName, setFileName] = useState('TODO.txt');
  const [lineEnding, setLineEnding] = useState<LineEnding>('lf');
  const [wrap, setWrap] = useState(true);
  useEffect(() => {
    if (open) { setFileName('TODO.txt'); setLineEnding('lf'); setWrap(true); }
  }, [open]);
  return <Modal open={open} onClose={onClose} title="Download TODO.txt" preview>
    <Title>TODO.txt</Title>
    <Description>Preview the complete file before downloading.</Description>
    <Layout>
      <DocumentFrame>
        {text ? <Text aria-label="TODO.txt preview" $wrap={wrap}>{text}</Text> : <Empty>The journal is empty.</Empty>}
      </DocumentFrame>
      <Options>
        <Label>File name<Field aria-label="File name" value={fileName} onChange={event => setFileName(event.target.value)} onBlur={() => setFileName(exportFileName(fileName))}/></Label>
        <Label>Line endings<Select aria-label="Line endings" value={lineEnding} onChange={event => setLineEnding(event.target.value as LineEnding)}>
          <option value="lf">LF (default)</option><option value="crlf">CRLF</option>
        </Select></Label>
        <Check><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)}/>Wrap long lines in preview</Check>
        <Note>All dates, items, details, and repeat rules are included. Preview wrapping does not change the file.</Note>
        <Actions><Button type="button" onClick={onClose}>cancel</Button><Button $primary type="button" autoFocus onClick={() => onDownload(exportFileName(fileName), lineEnding)}>download</Button></Actions>
      </Options>
    </Layout>
  </Modal>;
}
