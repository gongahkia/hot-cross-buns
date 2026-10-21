import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Pencil, Plus, Search } from "lucide-react";
import { MarkdownEditor } from "@renderer/components/MarkdownEditor";
import type { Note } from "./model";
import { Empty, IconButton, Tag } from "./ui";

export function NoteDocument({ note, onChange, small = false }: { note: Note; onChange: (note: Note) => void; small?: boolean }) {
  const [editing, setEditing] = useState(false);
  return <article className={`note-document ${small ? "small-document" : ""}`}>
    <div className="document-topline"><span><FileText size={14} /> {note.list} <span>/</span> {note.title}</span><button type="button" className="subtle-button" onClick={() => setEditing(!editing)}><Pencil size={13} />{editing ? "Done" : "Edit"}</button></div>
    <div className="document-page"><div className="document-kicker">{note.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}<span className="muted">{editing ? "Changes stay in this tab" : `Edited ${note.updated.toLowerCase()}`}</span></div>
      {editing ? <><input aria-label="Note title" className="document-title-input" value={note.title} onChange={e => onChange({ ...note, title: e.target.value })} /><MarkdownEditor aria-label="Note body" value={note.body} onValueChange={body => onChange({ ...note, body, updated: "Today" })} showControls={false} /></> : <div className="document-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown></div>}
    </div>
  </article>;
}
export function NotesView({ notes, selected, onSelect, onChange, onNew }: { notes: Note[]; selected: string; onSelect: (id: string) => void; onChange: (note: Note) => void; onNew: () => void }) {
  const [query, setQuery] = useState(""); const [list, setList] = useState("All notes");
  const note = notes.find(n => n.id === selected) ?? notes[0];
  const matches = notes.filter(n => (list === "All notes" || n.list === list) && `${n.title} ${n.body}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="notes-workspace"><aside className="note-list-panel"><div className="collection-heading"><strong>Your notes <span className="muted">{notes.length}</span></strong><IconButton label="New note" onClick={onNew}><Plus size={16} /></IconButton></div>
    <div className="note-filter"><Search size={14} /><input aria-label="Filter notes" placeholder="Find a thought…" value={query} onChange={e => setQuery(e.target.value)} /></div>
    <div className="small-tabs">{["All notes", "Journal", "Projects"].map(label => <button key={label} aria-pressed={list === label} onClick={() => setList(label)}>{label}</button>)}</div>
    <div className="note-list">{matches.map(n => <button type="button" key={n.id} aria-label={`Open note ${n.title}`} className={`note-list-item ${note?.id === n.id ? "active" : ""}`} onClick={() => onSelect(n.id)}><span className="note-list-icon"><FileText size={17} /></span><strong>{n.title}</strong><p>{n.body.replace(/[#>*_[\]|-]/g, "").slice(0, 90)}</p><span>{n.updated} <span>·</span> {n.list}</span></button>)}{!matches.length && <Empty title="No matching notes">Try another word.</Empty>}</div>
    <div className="note-local-label">Private notes · stored on this device in HCB</div>
  </aside>{note ? <NoteDocument key={note.id} note={note} onChange={onChange} /> : <Empty title="A space for your thoughts"><button className="primary-button" onClick={onNew}>Create a note</button></Empty>}</div>;
}
