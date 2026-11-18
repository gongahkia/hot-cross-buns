import { Fragment, createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Circle, CornerDownRight, FileText, IndentDecrease, IndentIncrease, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { MAX_OUTLINE_DEPTH, detailAt, detailSiblings, moveOutlineDetail, outlineContent, outlineNodes, refreshItemCompletion } from '../outline';
import type { TodoBody, TodoDetail, TodoItem } from '../todoText';
import { Button } from '../styles';
import { MarkdownBody } from './MarkdownBody';
import { downloadTextFile } from '../files';

const Wrap = styled.div`margin:4px 0 6px 34px;min-width:0;ul{list-style:none;margin:0;padding:0;}@media(max-width:540px){margin-left:0;}`;
const Row = styled.div<{ $depth: number }>`display:grid;grid-template-columns:28px 28px minmax(0,1fr) 36px;align-items:start;padding-left:${({ $depth }) => Math.min($depth, 6) * 14}px;min-width:0;border-radius:5px;&:hover,&:focus-within{background:var(--soft);}@media(max-width:540px){padding-left:${({ $depth }) => Math.min($depth, 4) * 9}px;}@media(pointer:coarse){grid-template-columns:36px 36px minmax(0,1fr) 44px;}`;
const Control = styled.button`display:grid;place-items:center;min-width:28px;min-height:36px;padding:4px;border:0;border-radius:5px;background:transparent;color:var(--muted);&:hover{background:var(--date-bg);color:var(--ink);}&:disabled{opacity:.45;cursor:default;}@media(pointer:coarse){min-height:44px;}`;
const Title = styled.textarea<{ $done?: boolean }>`display:block;width:100%;min-width:0;min-height:36px;padding:7px 2px;resize:none;overflow:hidden;border:0;border-radius:4px;background:transparent;color:${({ $done }) => $done ? 'var(--muted)' : 'var(--ink)'};font:inherit;font-size:14px;line-height:1.55;text-decoration:${({ $done }) => $done ? 'line-through' : 'none'};caret-color:var(--ink);@media(pointer:coarse){min-height:44px;font-size:16px;}`;
const Menu = styled.div`position:fixed;z-index:80;display:grid;width:200px;max-height:calc(100dvh - 24px);overflow:auto;padding:5px;border:1px solid var(--line);border-radius:9px;background:var(--surface);box-shadow:0 10px 24px #0003;`;
const Action = styled.button`display:flex;align-items:center;gap:9px;min-height:40px;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--ink);font:inherit;font-size:13px;text-align:left;&:hover,&:focus-visible{background:var(--soft);}&:disabled{opacity:.45;cursor:default;}@media(pointer:coarse){min-height:44px;}`;
const Body = styled.details`margin:4px 0 10px 56px;min-width:0;summary{display:flex;align-items:center;gap:6px;min-height:36px;color:var(--muted);font-size:12px;cursor:pointer;}@media(max-width:540px){margin-left:28px;}@media(pointer:coarse){summary{min-height:44px;}}`;
const BodyInput = styled.textarea`width:100%;min-height:140px;resize:vertical;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);font:13px/1.6 var(--raw-font);@media(pointer:coarse){font-size:16px;}`;
const BodyActions = styled.div`display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;button{min-height:36px;}@media(pointer:coarse){button{min-height:44px;}}`;
export const OutlineDocumentContext = createContext({ id: '', source: '' });
const hasDraft = (key: string) => { try { return sessionStorage.getItem(key) !== null; } catch { return false; } };

function MarkdownBodyEditor({ body, label, onSave, editRequest = 0, draftKey }: { body?: TodoBody[]; label: string; onSave: (markdown: string) => void; editRequest?: number; draftKey: string }) {
  const { source } = useContext(OutlineDocumentContext);
  const markdown = (body ?? []).map(block => block.markdown).join('\n\n');
  const [recovered] = useState(() => {
    try { const raw = sessionStorage.getItem(draftKey); if (raw) { const saved = JSON.parse(raw); if (typeof saved.draft === 'string' && typeof saved.base === 'string' && typeof saved.label === 'string') return saved as { draft: string; base: string; label: string; source?: string }; return { draft: raw, base: '', label: '', source: '' }; } }
    catch { /* an in-memory draft and download remain available. */ }
    return null;
  });
  const [editing, setEditing] = useState(!!editRequest || !!recovered), [draft, setDraft] = useState(recovered?.draft ?? markdown);
  const [error, setError] = useState(recovered ? 'A previous notes draft was recovered. Review it before saving.' : '');
  const baseline = useRef({ markdown: recovered?.base ?? markdown, label: recovered?.label ?? label, source: recovered ? recovered.source ?? '' : source });
  const [submitted, setSubmitted] = useState(false);
  const [visible, setVisible] = useState(!!editRequest || !!recovered);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (editRequest) { if (!editing) { baseline.current = { markdown, label, source }; setDraft(markdown); } setEditing(true); if (ref.current) ref.current.open = true; } }, [editRequest]);
  useEffect(() => {
    if (!editing || draft === baseline.current.markdown) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ base: baseline.current.markdown, label: baseline.current.label, source: baseline.current.source, draft })); }
    catch { setError('Could not checkpoint these notes. Keep the editor open or download the draft before leaving.'); }
  }, [draft, editing, draftKey]);
  const clear = () => { try { sessionStorage.removeItem(draftKey); } catch { /* the saved document remains available. */ } };
  useEffect(() => { if (submitted && markdown.trim() === draft.trim()) { clear(); setEditing(false); setSubmitted(false); setError(''); } }, [markdown, draft, submitted]);
  const save = () => {
    if (source !== baseline.current.source || markdown !== baseline.current.markdown || label !== baseline.current.label) { setError('The document changed while this draft was open. Download your draft, then cancel to review the latest notes.'); return; }
    if (draft === markdown) { clear(); setEditing(false); return; }
    setSubmitted(true); setError('The draft stays open until the change is validated. Finish any recurrence-scope review to apply it.'); onSave(draft);
  };
  return <Body ref={ref} open={!!editRequest || !!recovered || undefined} onToggle={event => setVisible(event.currentTarget.open)} data-journal-editor="true" data-editor-dirty={editing && draft !== baseline.current.markdown ? 'true' : 'false'}>
    <summary><FileText size={14}/>{markdown ? 'Notes' : 'Add notes'}</summary>
    {editing ? <>
      <BodyInput autoFocus data-markdown-body-editor aria-label={`Markdown notes for ${label}`} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save(); } }}/>
      {error && <p role="status">{error}</p>}
      <BodyActions><Button type="button" onClick={save}>Save notes</Button><Button type="button" onClick={() => downloadTextFile(draft, 'Planner-notes-draft.md')}>Download notes draft</Button><Button type="button" onClick={() => { clear(); baseline.current = { markdown, label, source }; setDraft(markdown); setEditing(false); setSubmitted(false); setError(''); }}>Cancel notes edit</Button></BodyActions>
    </> : visible ? <><MarkdownBody markdown={markdown}/><BodyActions><Button type="button" onClick={() => { baseline.current = { markdown, label, source }; setDraft(markdown); setEditing(true); }}>Edit notes</Button></BodyActions></> : null}
  </Body>;
}

type Change = (item: TodoItem) => void;
type Draft = { parent: number[]; index: number; note: boolean };

export function OutlineEditor({ item, dated, onEdit: edit, onToggle: toggle, onPromote, addRequest = 0, notesRequest = 0, reveal = false }: {
  item: TodoItem; dated: boolean; onEdit: (change: Change) => void | Promise<void>; onToggle: (change: Change) => void;
  onPromote: (path: number[], expected: string) => void; addRequest?: number; notesRequest?: number; reveal?: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null), [draftText, setDraftText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const draftSubmitted = useRef(false);
  const content = outlineContent(item);
  const checked = (change: Change): Change => next => {
    if (outlineContent(next) !== content) throw new Error('This outline changed while the edit was being prepared. Your draft was kept; review the latest outline and retry.');
    change(next);
  };
  const onEdit = (change: Change) => edit(checked(change));
  const onToggle = (change: Change) => toggle(checked(change));
  const [focus, setFocus] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusBaseline = useRef(item);
  const { id: documentId } = useContext(OutlineDocumentContext);
  const draftKey = `hcb-body-draft:${documentId}:${item.id}`;
  const priorAddRequest = useRef(addRequest);
  useEffect(() => { if (addRequest !== priorAddRequest.current) { priorAddRequest.current = addRequest; setDraft({ parent: [], index: item.details.length, note: !dated }); setDraftText(''); } }, [addRequest, dated, item.details.length]);
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
      <OutlineNode node={node} path={path} dated={dated} reveal={reveal} siblings={details.length} draftKey={`${draftKey}:${node.sourceRef ?? path.join('.')}`}
      onSave={text => onEdit(next => { detailAt(next.details, path).text = text; })}
      onToggle={() => onToggle(next => { const target = detailAt(next.details, path), completed = !target.completed; for (const child of outlineNodes([target])) if (child.kind !== 'note') child.completed = completed; refreshItemCompletion(next); })}
      onMove={direction => move(path, direction)} onAdd={note => add(path, node.children?.length ?? 0, note)} onSibling={() => add(parent, index + 1, node.kind === 'note')}
      onDelete={() => onEdit(next => { detailSiblings(next, path).splice(index, 1); if (dated) refreshItemCompletion(next); })}
      onPromote={() => onPromote(path, content)} onBody={markdown => onEdit(next => { detailAt(next.details, path).body = markdown.trim() ? [{ markdown }] : undefined; })}
      childrenContent={nodes(node.children ?? [], path)}
      draftContent={draft && draft.parent.join('.') === path.join('.') ? true : null}/>
    </Fragment>;
  })}{draft && draft.parent.join('.') === parent.join('.') && draft.index >= details.length ? draftField() : null}</ul>;
  const draftField = () => <li><Row $depth={draft?.parent.length ?? 0}><span/><span/><Title autoFocus aria-label={`New outline item for ${item.text}`} aria-busy={submitted} value={draftText} onChange={event => { draftSubmitted.current = false; setDraftText(event.target.value); }} onBlur={() => saveDraft()} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); if (!submitted) { setDraft(null); setDraftText(''); draftSubmitted.current = false; } } }}/><Control type="button" aria-label="Save outline item" disabled={submitted} onMouseDown={event => event.preventDefault()} onClick={() => saveDraft(true)}><Check size={15}/></Control></Row></li>;
  return <Wrap ref={root} role="group" aria-label={`Outline for ${item.text}`}>
    {!!(item.body?.length || notesRequest || hasDraft(draftKey)) && <MarkdownBodyEditor draftKey={draftKey} label={item.text} body={item.body} editRequest={notesRequest} onSave={markdown => onEdit(next => { next.body = markdown.trim() ? [{ markdown }] : undefined; })}/>}
    {nodes(item.details)}
  </Wrap>;
}

function OutlineNode({ node, path, dated, reveal, siblings, draftKey, onSave, onToggle, onMove, onAdd, onSibling, onDelete, onPromote, onBody, childrenContent, draftContent }: {
  node: TodoDetail; path: number[]; dated: boolean; reveal: boolean; siblings: number; onSave: (text: string) => void; onToggle: () => void;
  draftKey: string;
  onMove: (direction: 'up' | 'down' | 'in' | 'out') => void; onAdd: (note: boolean) => void; onSibling: () => void; onDelete: () => void; onPromote: () => void;
  onBody: (markdown: string) => void; childrenContent: React.ReactNode; draftContent: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(path.length < 4), [menu, setMenu] = useState(false), [notes, setNotes] = useState(0);
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
  const run = (action: () => void) => { setMenu(false); action(); };
  return <li>
    <Row $depth={path.length - 1}>
      {node.children?.length || draftContent ? <Control type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} outline ${node.text}`} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</Control> : <span/>}
      {task ? <Control type="button" aria-label={`${node.completed ? 'Reopen' : 'Complete'} detail ${node.text}`} aria-pressed={node.completed} onClick={onToggle}>{node.completed ? <Check size={15}/> : <Circle size={14}/>}</Control> : <span aria-hidden="true" style={{display:'grid',placeItems:'center',minHeight:36}}><Circle size={5} fill="currentColor"/></span>}
      <Title ref={title} rows={1} data-journal-entry data-outline-path={path.join('.')} aria-label={`Edit detail ${node.text}`} $done={task && node.completed} value={value} onChange={event => setValue(event.target.value.replace(/[\r\n]+/g, ' '))} onKeyDown={shortcut} onBlur={() => { if (!cancelled.current && value.trim() && value.trim() !== node.text) onSave(value.trim()); else setValue(node.text); cancelled.current = false; }}/>
      <Control ref={trigger} type="button" aria-label={`More actions for detail ${node.text}`} aria-expanded={menu} onClick={() => setMenu(value => !value)}><MoreHorizontal size={16}/></Control>
    </Row>
    {(node.body?.length || notes || hasDraft(draftKey)) ? <MarkdownBodyEditor draftKey={draftKey} label={node.text} body={node.body} editRequest={notes} onSave={markdown => { onBody(markdown); }}/> : null}
    {expanded && <div id={id}>{childrenContent}</div>}
    {menu && rect && createPortal(<Menu ref={panel} aria-label={`Actions for detail ${node.text}`} style={{ left: Math.max(8, Math.min(rect.right - 200, innerWidth - 208)), top: Math.max(8, Math.min(rect.bottom + 4, innerHeight - (dated ? 450 : 400))) }}>
      {dated && <Action disabled={path.length >= MAX_OUTLINE_DEPTH} onClick={() => run(() => { setExpanded(true); onAdd(false); })}><Plus size={15}/> add subtask</Action>}
      <Action disabled={path.length >= MAX_OUTLINE_DEPTH} onClick={() => run(() => { setExpanded(true); onAdd(true); })}><Plus size={15}/> add nested note</Action>
      <Action disabled={!index || path.length >= MAX_OUTLINE_DEPTH} onClick={() => run(() => onMove('in'))}><IndentIncrease size={15}/> indent</Action>
      <Action disabled={path.length < 2} onClick={() => run(() => onMove('out'))}><IndentDecrease size={15}/> outdent</Action>
      <Action disabled={!index} onClick={() => run(() => onMove('up'))}><ArrowUp size={15}/> move up</Action>
      <Action disabled={index === siblings - 1} onClick={() => run(() => onMove('down'))}><ArrowDown size={15}/> move down</Action>
      <Action onClick={() => run(() => setNotes(value => value + 1))}><FileText size={15}/> edit notes</Action>
      <Action aria-label={`Make detail ${node.text} an item`} onClick={() => run(onPromote)}><CornerDownRight size={15}/> make item</Action>
      <Action aria-label={`Delete detail ${node.text} and its children`} onClick={() => run(onDelete)}><Trash2 size={15}/> delete branch</Action>
    </Menu>, document.body)}
  </li>;
}
