import { Fragment, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Circle, CornerDownRight, FileText, IndentDecrease, IndentIncrease, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { MAX_OUTLINE_DEPTH, detailAt, detailSiblings, moveOutlineDetail, outlineContent, outlineNodes, refreshItemCompletion, replaceMarkdownBody } from '../outline';
import type { TodoBody, TodoDetail, TodoItem } from '../todoText';
import { Button } from '../styles';
import { MarkdownBody } from './MarkdownBody';
import { downloadTextFile } from '../files';
import { MarkdownDocumentContext as OutlineDocumentContext } from '../markdownContext';
import { markdownLink, usedMarkdownPreparations, withMarkdownPreparation, type MarkdownLinkPreparation, type MarkdownTarget } from '../markdownNavigation';
import { MarkdownLinkPicker } from './MarkdownLinkPicker';
import { MarkdownBacklinks } from './MarkdownBacklinks';
export { MarkdownDocumentContext as OutlineDocumentContext } from '../markdownContext';

const Wrap = styled.div`margin:4px 0 6px 34px;min-width:0;ul{list-style:none;margin:0;padding:0;}@media(max-width:540px){margin-left:0;}`;
const Row = styled.div<{ $depth: number }>`display:grid;grid-template-columns:28px 28px minmax(0,1fr) 36px;align-items:start;padding-left:${({ $depth }) => Math.min($depth, 6) * 14}px;min-width:0;border-radius:5px;&:hover,&:focus-within{background:var(--soft);}@media(max-width:540px){padding-left:${({ $depth }) => Math.min($depth, 4) * 9}px;}@media(pointer:coarse){grid-template-columns:36px 36px minmax(0,1fr) 44px;}`;
const Control = styled.button`display:grid;place-items:center;min-width:28px;min-height:36px;padding:4px;border:0;border-radius:5px;background:transparent;color:var(--muted);&:hover{background:var(--date-bg);color:var(--ink);}&:disabled{opacity:.45;cursor:default;}@media(pointer:coarse){min-height:44px;}`;
const Title = styled.textarea<{ $done?: boolean }>`display:block;width:100%;min-width:0;min-height:36px;padding:7px 2px;resize:none;overflow:hidden;border:0;border-radius:4px;background:transparent;color:${({ $done }) => $done ? 'var(--muted)' : 'var(--ink)'};font:inherit;font-size:14px;line-height:1.55;text-decoration:${({ $done }) => $done ? 'line-through' : 'none'};caret-color:var(--ink);@media(pointer:coarse){min-height:44px;font-size:16px;}`;
const Menu = styled.div`position:fixed;z-index:80;display:grid;width:200px;max-height:calc(100dvh - 24px);overflow:auto;padding:5px;border:1px solid var(--line);border-radius:9px;background:var(--surface);box-shadow:0 10px 24px #0003;`;
const Action = styled.button`display:flex;align-items:center;gap:9px;min-height:40px;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--ink);font:inherit;font-size:13px;text-align:left;&:hover,&:focus-visible{background:var(--soft);}&:disabled{opacity:.45;cursor:default;}@media(pointer:coarse){min-height:44px;}`;
const Body = styled.details<{ $document?: boolean }>`margin:${({ $document }) => $document ? '0' : '4px 0 10px 56px'};min-width:0;summary{display:flex;align-items:center;gap:6px;min-height:36px;color:var(--muted);font-size:12px;cursor:pointer;}@media(max-width:540px){margin-left:${({ $document }) => $document ? '0' : '28px'};}@media(pointer:coarse){summary{min-height:44px;}}`;
const BodyInput = styled.textarea<{ $document?: boolean }>`display:block;width:100%;min-height:${({ $document }) => $document ? '64px' : '140px'};resize:${({ $document }) => $document ? 'none' : 'vertical'};padding:${({ $document }) => $document ? '8px 0' : '8px'};border:0;border-radius:0;background:transparent;color:var(--ink);font:${({ $document }) => $document ? 'inherit' : '13px/1.6 var(--raw-font)'};${({ $document }) => $document ? 'font-size:14px;line-height:1.6;' : ''}@media(pointer:coarse){font-size:16px;}`;
const BodyActions = styled.div`display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;button{min-height:36px;}@media(pointer:coarse){button{min-height:44px;}}`;
const WritingLine = styled.button`display:block;width:100%;min-height:44px;margin:4px 0;padding:8px 0;border:0;border-radius:0;background:transparent;color:var(--muted);font:inherit;font-size:14px;line-height:1.6;text-align:left;&:not(:disabled){cursor:text;}&:hover{color:var(--ink);}&:focus-visible{outline:none;box-shadow:inset 0 -2px 0 var(--focus);}@media(pointer:coarse){font-size:16px;}`;
const hasDraft = (key: string) => { try { return sessionStorage.getItem(key) !== null; } catch { return false; } };

export function MarkdownBodyEditor({ body, label, onSave, editRequest = 0, draftKey, expanded = false, blockOnly = false, documentMode = false, onToggleTask, readOnly = false, onMoveBlock, appendRequest = 0, onEditRequest, onNodeAction, draftRequest }: { draftRequest?: {key:number;index:number;markdown?:string;selection?:number}; onNodeAction?: (start:number,anchor:HTMLButtonElement)=>void; onEditRequest?: (index:number)=>boolean; appendRequest?: number; body?: TodoBody[]; label: string; onSave: (markdown: string, block?: number, expectedSource?: string, links?: MarkdownLinkPreparation[]) => void | boolean | Promise<void | boolean>; editRequest?: number; draftKey: string; expanded?: boolean; blockOnly?: boolean; documentMode?: boolean; onToggleTask?: (start: number) => void; readOnly?: boolean; onMoveBlock?: (index: number, anchor: HTMLButtonElement) => void }) {
  const { source, navigation } = useContext(OutlineDocumentContext);
  const markdown = (body ?? []).map(block => block.markdown).join('\n\n');
  const [recovered] = useState(() => {
    try { const raw = sessionStorage.getItem(draftKey); if (raw) { const saved = JSON.parse(raw); if (typeof saved.draft === 'string' && typeof saved.base === 'string' && typeof saved.label === 'string') return saved as { draft: string; base: string; label: string; source?: string; block?: number; links?: MarkdownLinkPreparation[] }; return { draft: raw, base: '', label: '', source: '', block: undefined }; } }
    catch { /* an in-memory draft and download remain available. */ }
    return null;
  });
  const [editing, setEditing] = useState(!!editRequest || !!recovered), [draft, setDraft] = useState(recovered?.draft ?? markdown);
  const [activeBlock, setActiveBlock] = useState<number | null>(Number.isInteger(recovered?.block) && recovered!.block! >= 0 ? recovered!.block! : null);
  const [error, setError] = useState(recovered ? 'A previous notes draft was recovered. Review it before saving.' : '');
  const baseline = useRef({ markdown: recovered?.base ?? markdown, label: recovered?.label ?? label, source: recovered ? recovered.source ?? '' : source });
  const expected = useRef('');
  const pendingLinks = useRef<MarkdownLinkPreparation[]>(Array.isArray(recovered?.links) ? recovered.links : []);
  const input = useRef<HTMLTextAreaElement>(null), selection = useRef({ start: 0, end: 0 });
  const [linkOpen, setLinkOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [visible, setVisible] = useState(expanded || !!editRequest || !!recovered);
  const ref = useRef<HTMLDetailsElement>(null);
  const restoreFocus = (block: number | null) => requestAnimationFrame(() => {
    const button = (block === null ? null : ref.current?.querySelector<HTMLElement>(`[data-writing-block="${block}"],[data-block-index="${block}"]`)) ?? ref.current?.querySelector<HTMLButtonElement>('[data-edit-notes],[data-add-writing]');
    button?.focus({ preventScroll: true });
  });
  useEffect(() => { if (editRequest) { if (!editing) { baseline.current = { markdown, label, source }; setDraft(markdown); setActiveBlock(null); } setEditing(true); if (ref.current) ref.current.open = true; } }, [editRequest]);
  useEffect(() => {
    if (!editing) return;
    const original = activeBlock === null ? baseline.current.markdown : body?.[activeBlock]?.markdown ?? '';
    if (draft === original && source === baseline.current.source) { try { sessionStorage.removeItem(draftKey); } catch { /* the unchanged saved block remains authoritative. */ } return; }
    try { sessionStorage.setItem(draftKey, JSON.stringify({ base: baseline.current.markdown, label: baseline.current.label, source: baseline.current.source, draft, links: pendingLinks.current, ...(activeBlock === null ? {} : { block: activeBlock }) })); }
    catch { setError('Could not checkpoint these notes. Keep the editor open or download the draft before leaving.'); }
  }, [draft, editing, draftKey, activeBlock, body, source]);
  const clear = () => { try { sessionStorage.removeItem(draftKey); } catch { /* the saved document remains available. */ } };
  useEffect(() => { if (submitted && markdown.trim() === expected.current.trim()) { clear(); setEditing(false); setSubmitted(false); setActiveBlock(null); setError(''); restoreFocus(activeBlock); } }, [markdown, submitted]);
  const begin = (block: number | null) => {
    if (block !== null && onEditRequest?.(block)) return false;
    if (editing && draft !== (activeBlock === null ? baseline.current.markdown : body?.[activeBlock]?.markdown ?? '')) { setError('Save, download or cancel this draft before editing another block.'); return false; }
    baseline.current = { markdown, label, source }; pendingLinks.current = []; setDraft(block === null ? markdown : body?.[block]?.markdown ?? ''); setActiveBlock(block); setSubmitted(false); setError(''); setEditing(true); return true;
  };
  const requestedSelection=useRef<number|null>(null);
  useEffect(()=>{if(draftRequest && begin(draftRequest.index)){requestedSelection.current=draftRequest.selection??null;if(draftRequest.markdown!==undefined)setDraft(draftRequest.markdown);}},[draftRequest?.key]);
  useLayoutEffect(()=>{if(input.current && requestedSelection.current!==null){input.current.focus();input.current.setSelectionRange(requestedSelection.current,requestedSelection.current+9);requestedSelection.current=null;}},[editing,draft,activeBlock]);
  useLayoutEffect(() => {
    if (!documentMode || !editing || !input.current) return;
    const field = input.current;
    field.style.height = 'auto';
    field.style.height = `${Math.min(560, Math.max(64, field.scrollHeight))}px`;
  }, [documentMode, editing, draft, activeBlock]);
  const priorAppend = useRef(0);
  useEffect(() => { if (appendRequest && priorAppend.current !== appendRequest) { priorAppend.current = appendRequest; begin(body?.length ?? 0); } }, [appendRequest]);
  const save = () => {
    if (readOnly) { setError('Take over editing before saving this draft.'); return; }
    if (source !== baseline.current.source || markdown !== baseline.current.markdown || label !== baseline.current.label) { setError('The document changed while this draft was open. Download your draft, then cancel to review the latest notes.'); return; }
    if (draft === (activeBlock === null ? markdown : body?.[activeBlock]?.markdown ?? '')) { clear(); setEditing(false); setActiveBlock(null); restoreFocus(activeBlock); return; }
    if (activeBlock !== null && !body?.[activeBlock] && !(documentMode && activeBlock === (body?.length ?? 0))) { setError('This block is no longer available. Download your draft, then cancel to review the latest document.'); return; }
    expected.current = documentMode && activeBlock === (body?.length ?? 0) ? [...body ?? [], { markdown: draft }].map(block => block.markdown).join('\n\n') : (replaceMarkdownBody(body, draft, activeBlock ?? undefined) ?? []).map(block => block.markdown).join('\n\n');
    setSubmitted(true); setError('The draft stays open until the change is validated. Finish any recurrence-scope review to apply it.');
    void Promise.resolve(onSave(draft, activeBlock ?? undefined, baseline.current.source, usedMarkdownPreparations(draft, pendingLinks.current))).then(applied => { if (applied === true) { clear(); setEditing(false); setSubmitted(false); setActiveBlock(null); setError(''); restoreFocus(activeBlock); } }).catch(error => { setSubmitted(false); setError(String(error)); });
  };
  const openLinks = () => { if (!navigation || !input.current) return; selection.current = { start: input.current.selectionStart, end: input.current.selectionEnd }; setLinkOpen(true); };
  const insertLink = (target: MarkdownTarget) => {
    let fragment = target.fragment;
    if (!fragment && target.entryRef) {
      let prepared = pendingLinks.current.find(link => link.entryRef === target.entryRef);
      if (!prepared) { prepared = { entryRef: target.entryRef, id: crypto.randomUUID() }; pendingLinks.current.push(prepared); }
      fragment = `hcb-${prepared.id}`;
    }
    if (!fragment || !input.current) return;
    const { start, end } = selection.current, text = markdownLink(draft.slice(start, end) || target.label, fragment);
    input.current.focus(); input.current.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) { setError('Automatic link insertion is unavailable. Copy this Markdown link into the draft: ' + text); return; }
    setDraft(input.current.value); setLinkOpen(false);
  };
  const original = activeBlock === null ? baseline.current.markdown : body?.[activeBlock]?.markdown ?? '';
  const editor = <>
    <BodyInput $document={documentMode} ref={input} autoFocus readOnly={readOnly} data-markdown-body-editor aria-label={`Markdown ${documentMode ? 'for' : 'notes for'} ${label}`} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopPropagation(); openLinks(); } if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save(); } }}/>
    {linkOpen && navigation && <MarkdownLinkPicker navigation={navigation} onSelect={insertLink} onClose={() => { setLinkOpen(false); input.current?.focus(); }}/>}
    {error && <p role="status">{error}</p>}
    <BodyActions><Button type="button" disabled={readOnly} onClick={save}>{documentMode ? 'Save' : 'Save notes'}</Button>{navigation && <Button type="button" onMouseDown={event => event.preventDefault()} onClick={openLinks}>Insert link</Button>}<Button type="button" onClick={() => downloadTextFile(draft, documentMode ? 'Planner-writing-draft.md' : 'Planner-notes-draft.md')}>{documentMode ? 'Download draft' : 'Download notes draft'}</Button><Button type="button" onClick={() => { clear(); baseline.current = { markdown, label, source }; setDraft(markdown); setEditing(false); setActiveBlock(null); setSubmitted(false); setError(''); setLinkOpen(false); restoreFocus(activeBlock); }}>{documentMode ? 'Cancel' : 'Cancel notes edit'}</Button></BodyActions>
    <div aria-label="Live Markdown preview"><MarkdownBody markdown={draft} documentMode={documentMode}/></div>
  </>;
  return <Body as={documentMode ? 'section' : 'details'} $document={documentMode} ref={ref} open={documentMode ? undefined : expanded || !!editRequest || !!recovered || undefined} onToggle={documentMode ? undefined : (event: SyntheticEvent<HTMLDetailsElement>) => setVisible(event.currentTarget.open)} data-journal-editor="true" data-editor-dirty={editing && (draft !== original || source !== baseline.current.source) ? 'true' : 'false'}>
    {!documentMode && <summary><FileText size={14}/>{markdown ? 'Notes' : 'Add notes'}</summary>}
    {editing && activeBlock === null ? editor : documentMode || visible ? <><MarkdownBody onNodeAction={editing || readOnly ? undefined : onNodeAction} markdown={markdown} body={body} label={label} onEditBlock={readOnly ? undefined : index => begin(index)} activeBlock={editing ? activeBlock : null} editor={editor} onToggleTask={editing || readOnly ? undefined : onToggleTask} documentMode={documentMode} onMoveBlock={editing || readOnly ? undefined : onMoveBlock}/>{editing && documentMode && activeBlock === (body?.length ?? 0) && editor}{!editing && !readOnly && (documentMode ? <WritingLine data-add-writing type="button" aria-label={`Write in ${label}`} onClick={() => begin(body?.length ?? 0)}>Write something…</WritingLine> : !blockOnly && <BodyActions><Button data-edit-notes type="button" onClick={() => begin(null)}>Edit notes</Button></BodyActions>)}</> : null}
  </Body>;
}

type Change = (item: TodoItem) => void;
type Draft = { parent: number[]; index: number; note: boolean };

export function OutlineEditor({ item, dated, onEdit: edit, onToggle: toggle, onPromote, addRequest = 0, notesRequest = 0, reveal = false, unified = false }: {
  item: TodoItem; dated: boolean; onEdit: (change: Change) => void | Promise<void>; onToggle: (change: Change) => void;
  onPromote: (path: number[], expected: string) => void; unified?: boolean; addRequest?: number; notesRequest?: number; reveal?: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null), [draftText, setDraftText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const draftSubmitted = useRef(false);
  const content = outlineContent(item);
  const checked = (change: Change): Change => next => {
    if (outlineContent(next) !== content) throw new Error('This outline changed while the edit was being prepared. Your draft was kept; review the latest outline and retry.');
    change(next);
  };
  const onEdit = (change: Change, source?: string, links?: MarkdownLinkPreparation[]) => edit(withMarkdownPreparation(checked(change), source, links));
  const onToggle = (change: Change) => toggle(checked(change));
  const [focus, setFocus] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusBaseline = useRef(item);
  const { id: documentId } = useContext(OutlineDocumentContext);
  const draftKey = `hcb-body-draft:${documentId}:${item.id}`;
  const priorAddRequest = useRef(addRequest);
  useEffect(() => { if (addRequest !== priorAddRequest.current) { priorAddRequest.current = addRequest; setDraft({ parent: [], index: item.details.length, note: unified ? item.kind === 'note' : !dated }); setDraftText(''); } }, [addRequest, dated, item.details.length, unified, item.kind]);
  useLayoutEffect(() => { if (focus && item !== focusBaseline.current) { root.current?.querySelector<HTMLTextAreaElement>(`[data-outline-path="${focus}"]`)?.focus(); setFocus(null); } }, [item, focus]);
  const requestFocus = (path: number[]) => { focusBaseline.current = item; setFocus(path.join('.')); };
  useEffect(() => {
    if (!draft || !draftText.trim()) return;
    try { if (detailAt(item.details, [...draft.parent, draft.index]).text === draftText.trim()) { setDraft(null); setDraftText(''); draftSubmitted.current = false; } } catch { /* validation or scope review is still pending. */ }
  }, [item]);
  const add = (parent: number[], index: number, note = !dated) => { setDraftText(''); setSubmitted(false); draftSubmitted.current = false; setDraft({ parent, index, note }); };
  const saveDraft = (retry = false) => {
    if (!draft || draftSubmitted.current && !retry) return;
    const text = draftText.trim(), location = draft;
    if (!text) { setDraft(null); setDraftText(''); return; }
    setSubmitted(true); draftSubmitted.current = true;
    void Promise.resolve(onEdit(next => {
      const siblings = location.parent.length ? (detailAt(next.details, location.parent).children ??= []) : next.details;
      siblings.splice(location.index, 0, { text, completed: false, ...(dated && location.note ? { kind: 'note' as const } : {}) });
      if (dated) refreshItemCompletion(next);
    })).finally(() => setSubmitted(false));
    requestFocus([...location.parent, location.index]);
  };
  const move = (path: number[], direction: 'up' | 'down' | 'in' | 'out') => {
    const index = path.at(-1)!, parent = path.slice(0, -1);
    onEdit(next => moveOutlineDetail(next, path, direction));
    const target = direction === 'in' ? [...parent, index - 1, item.details.length] : direction === 'out' ? [...parent.slice(0,-1), parent.at(-1)! + 1] : [...parent, index + (direction === 'up' ? -1 : 1)];
    if (direction === 'in') target[target.length - 1] = detailAt(item.details, [...parent, index - 1]).children?.length ?? 0;
    requestFocus(target);
  };
  const nodes = (details: TodoDetail[], parent: number[] = []): React.ReactNode => <ul>{details.map((node, index) => {
    const path = [...parent, index];
    return <Fragment key={node.sourceRef ?? path.join('.')}>
      {draft && draft.parent.join('.') === parent.join('.') && draft.index === index ? draftField() : null}
      <OutlineNode unified={unified} node={node} path={path} dated={dated} reveal={reveal} siblings={details.length} draftKey={`${draftKey}:${node.sourceRef ?? path.join('.')}`}
      onSave={text => onEdit(next => { detailAt(next.details, path).text = text; })}
      onToggle={() => onToggle(next => { const target = detailAt(next.details, path), completed = !target.completed; for (const child of outlineNodes([target])) if (child.kind !== 'note') child.completed = completed; refreshItemCompletion(next); })}
      onMove={direction => move(path, direction)} onAdd={note => add(path, node.children?.length ?? 0, note)} onSibling={() => add(parent, index + 1, node.kind === 'note')}
      onConvert={()=>onEdit(next=>{const node=detailAt(next.details,path);if(node.completed)throw new Error('Reopen this task before making it plain.');node.kind=node.kind==='note'?undefined:'note';refreshItemCompletion(next);})}
      onDelete={() => onEdit(next => { detailSiblings(next, path).splice(index, 1); if (dated) refreshItemCompletion(next); })}
      onPromote={() => onPromote(path, content)} onBody={(markdown, block, source, links) => onEdit(next => { const node = detailAt(next.details, path); node.body = replaceMarkdownBody(node.body, markdown, block); }, source, links)}
      childrenContent={nodes(node.children ?? [], path)}
      draftContent={draft && draft.parent.join('.') === path.join('.') ? true : null}/>
    </Fragment>;
  })}{draft && draft.parent.join('.') === parent.join('.') && draft.index >= details.length ? draftField() : null}</ul>;
  const draftField = () => <li><Row $depth={draft?.parent.length ?? 0}><span/><span/><Title autoFocus aria-label={`New outline item for ${item.text}`} aria-busy={submitted} value={draftText} onChange={event => { draftSubmitted.current = false; setDraftText(event.target.value); }} onBlur={() => saveDraft()} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); if (!submitted) { setDraft(null); setDraftText(''); draftSubmitted.current = false; } } }}/><Control type="button" aria-label="Save outline item" disabled={submitted} onMouseDown={event => event.preventDefault()} onClick={() => saveDraft(true)}><Check size={15}/></Control></Row></li>;
  return <Wrap ref={root} role="group" aria-label={`Outline for ${item.text}`}>
    {!!(item.body?.length || notesRequest || hasDraft(draftKey)) && <MarkdownBodyEditor documentMode={unified} draftKey={draftKey} label={item.text} body={item.body} editRequest={notesRequest} onSave={(markdown, block, source, links) => onEdit(next => { next.body = replaceMarkdownBody(next.body, markdown, block); }, source, links)}/>}
    {nodes(item.details)}
    <MarkdownBacklinks itemId={item.id}/>
  </Wrap>;
}

function OutlineNode({ node, path, dated, unified, reveal, siblings, draftKey, onSave, onToggle, onMove, onAdd, onSibling, onDelete, onPromote, onBody, onConvert, childrenContent, draftContent }: {
  node: TodoDetail; path: number[]; dated: boolean; unified: boolean; reveal: boolean; siblings: number; onSave: (text: string) => void; onToggle: () => void;
  draftKey: string;
  onMove: (direction: 'up' | 'down' | 'in' | 'out') => void; onAdd: (note: boolean) => void; onSibling: () => void; onDelete: () => void; onPromote: () => void;
  onConvert:()=>void; onBody: (markdown: string, block?: number, expectedSource?: string, links?: MarkdownLinkPreparation[]) => void | Promise<void>; childrenContent: React.ReactNode; draftContent: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(path.length < 4), [menu, setMenu] = useState(false), [notes, setNotes] = useState(0),[moving,setMoving]=useState(false);
  const [value, setValue] = useState(node.text);
  const title = useRef<HTMLTextAreaElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const id = useId(), task = dated && node.kind !== 'note', index = path.at(-1)!;
  useEffect(() => setValue(node.text), [node.text]);
  useEffect(() => { if (reveal || draftContent) setExpanded(true); }, [reveal, draftContent]);
  useLayoutEffect(() => { if (title.current) { title.current.style.height = 'auto'; title.current.style.height = title.current.scrollHeight + 'px'; } }, [value]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenu(false); };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key); window.addEventListener('resize', dismiss);
    function dismiss() { setMenu(false); }
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); window.removeEventListener('resize', dismiss); };
  }, [menu]);
  const shortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const directions = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'out', ArrowRight: 'in' } as const;
    const direction = event.altKey ? directions[event.key as keyof typeof directions] : undefined;
    if (direction) {
      event.preventDefault();
      if (value !== node.text) event.currentTarget.blur();
      if ((direction === 'in' || direction === 'up') && !index || direction === 'out' && path.length === 1 || direction === 'down' && index === siblings - 1) return;
      onMove(direction); return;
    }
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); onSibling(); }
    if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; event.currentTarget.blur(); }
  };
  const rect = menu ? trigger.current?.getBoundingClientRect() : null;
  const dialog = trigger.current?.closest('dialog'), origin = dialog?.getBoundingClientRect();
  const run = (action: () => void) => { setMenu(false);setMoving(false); action(); };
  return <li>
    <Row $depth={path.length - 1}>
      {node.children?.length || draftContent ? <Control type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} outline ${node.text}`} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</Control> : <span/>}
      {task ? <Control type="button" aria-label={`${node.completed ? 'Reopen' : 'Complete'} detail ${node.text}`} aria-pressed={node.completed} onClick={onToggle}>{node.completed ? <Check size={15}/> : <Circle size={14}/>}</Control> : <span aria-hidden="true" style={{display:'grid',placeItems:'center',minHeight:36}}><Circle size={5} fill="currentColor"/></span>}
      <Title ref={title} rows={1} data-journal-entry data-outline-path={path.join('.')} aria-label={`Edit detail ${node.text}`} $done={task && node.completed} value={value} onChange={event => setValue(event.target.value.replace(/[\r\n]+/g, ' '))} onKeyDown={shortcut} onBlur={() => { if (!cancelled.current && value.trim() && value.trim() !== node.text) onSave(value.trim()); else setValue(node.text); cancelled.current = false; }}/>
      <Control ref={trigger} type="button" aria-label={`More actions for detail ${node.text}`} aria-expanded={menu} onClick={() => setMenu(value => !value)}><MoreHorizontal size={16}/></Control>
    </Row>
    {(node.body?.length || notes || hasDraft(draftKey)) ? <MarkdownBodyEditor documentMode={unified} draftKey={draftKey} label={node.text} body={node.body} editRequest={notes} onSave={onBody}/> : null}
    {expanded && <div id={id}>{childrenContent}</div>}
    {menu && rect && createPortal(<Menu ref={panel} aria-label={`Actions for detail ${node.text}`} style={{ left: Math.max((origin?.left ?? 0) + 8, Math.min(rect.right - 200, (origin?.right ?? innerWidth) - 208)) - (origin?.left ?? 0) + (dialog?.scrollLeft ?? 0), top: Math.max((origin?.top ?? 0) + 8, Math.min(rect.bottom + 4, (origin?.bottom ?? innerHeight) - (dated ? 450 : 400))) - (origin?.top ?? 0) + (dialog?.scrollTop ?? 0), maxHeight: origin ? origin.height - 24 : undefined }}>
      {!moving && <>
      {!unified && dated && <Action disabled={path.length >= MAX_OUTLINE_DEPTH} onClick={() => run(() => { setExpanded(true); onAdd(false); })}><Plus size={15}/> add subtask</Action>}
      <Action disabled={path.length >= MAX_OUTLINE_DEPTH} onClick={() => run(() => { setExpanded(true); onAdd(unified ? node.kind === 'note' : true); })}><Plus size={15}/>{unified ? 'Add child' : 'add nested note'}</Action>
      <Action onClick={() => run(() => setNotes(value => value + 1))}><FileText size={15}/>{unified ? 'Edit content' : 'edit notes'}</Action>
      {unified && <><Action disabled={node.completed} onClick={()=>run(onConvert)}>{node.kind==='note'?'Make task':'Make plain item'}</Action><Action onClick={()=>setMoving(true)}>Move…</Action></>}
      </>}
      {(!unified || moving) && <>
      {unified && <Action onClick={()=>setMoving(false)}>Back to item actions</Action>}
      <Action disabled={!index || path.length >= MAX_OUTLINE_DEPTH} onClick={() => run(() => onMove('in'))}><IndentIncrease size={15}/> indent</Action>
      <Action disabled={path.length < 2} onClick={() => run(() => onMove('out'))}><IndentDecrease size={15}/> outdent</Action>
      <Action disabled={!index} onClick={() => run(() => onMove('up'))}><ArrowUp size={15}/> move up</Action>
      <Action disabled={index === siblings - 1} onClick={() => run(() => onMove('down'))}><ArrowDown size={15}/> move down</Action>
      <Action aria-label={`Make detail ${node.text} an item`} onClick={() => run(onPromote)}><CornerDownRight size={15}/> make item</Action>
      </>}
      {!moving && <Action aria-label={`Delete detail ${node.text} and its children`} onClick={() => run(onDelete)}><Trash2 size={15}/> delete branch</Action>}
    </Menu>, dialog ?? document.body)}
  </li>;
}
