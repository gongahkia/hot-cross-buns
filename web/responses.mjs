import { createHash } from 'node:crypto';
import { marked } from 'marked';
import { validResponseQuote } from '../app-host/src/response-reference.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:[0-9]+|x[a-f0-9]+);/gi, entity => {const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'\"','&apos;':"'",'&nbsp;':' '};if(named[entity.toLowerCase()])return named[entity.toLowerCase()];const number=parseInt(entity.slice(2,-1).replace(/^x/i,''),/^&#x/i.test(entity)?16:10);return number>0&&number<=0x10ffff?String.fromCodePoint(number):entity;});
const normalize = text => decode(text).normalize('NFC').replace(/\s+/gu, ' ').trim();
function plainTokens(tokens, inline = false) {
  return tokens.map(token => {
    if (token.type === 'list') return token.items.map(item => plainTokens(item.tokens)).join('\n');
    if (token.type === 'table') return [token.header, ...token.rows].map(row => row.map(cell => plainTokens(cell.tokens, true)).join('\t')).join('\n');
    if (token.tokens) return plainTokens(token.tokens, token.type !== 'blockquote');
    return token.text || (token.type === 'br' ? '\n' : '');
  }).join(inline ? '' : '\n');
}
export function responseRecords(state = {}) {
  const records = [];
  for (const [index, message] of (state.messages || []).entries()) {
    if (message.role !== 'Hot Cross Buns' || !message.text || message.result) continue;
    const message_id = 'message:' + (message.revision_id || message.run_id || message.created_at || '') + ':' + index;
    const id=message.revision_id?'revision:'+message.revision_id+':'+message.run_id:'response:'+hash(message.text);
    records.push({ id, message_id, digest: hash(message.text), text: message.text,
      boundary: message.revision_id && message.run_id ? { revision_id: message.revision_id, run_id: message.run_id } : null });
  }
  for (const turn of state.dialogue || []) {
    if (!turn.response || turn.issue || !['answered','clarification'].includes(turn.state)) continue;
    records.push({ id: 'dialogue:' + turn.id + ':response', message_id: 'dialogue:' + turn.id + ':response', digest: hash(turn.response), text: turn.response,
      boundary: { turn_id: turn.id, turn_revision: turn.revision } });
  }
  return records;
}
export function responseReferences(state) { return responseRecords(state).map(({id,message_id,digest,boundary})=>({id,message_id,digest,can_fork:!!boundary})); }
export function selectedResponse(state, id, digest) {
  const response = responseRecords(state).find(value => value.id === id && value.digest === digest);
  if (!response) throw new Error('This response changed or is no longer loaded. Return to it and select it again.');
  return response;
}
export function quoteResponse(response, selected) {
  const plain = decode(plainTokens(marked.lexer(response.text))).trim() || response.text;
  const text = selected === undefined ? Array.from(plain.trim()).slice(0,1200).join('') : selected;
  const quote = { id: response.id, digest: response.digest, text };
  if (!validResponseQuote(quote) || !normalize(text) || ![plain,response.text].some(value => normalize(value).includes(normalize(text)))) throw new Error('Choose a shorter text selection within one response.');
  return quote;
}
export function checkQuote(state, quote) {
  if (!validResponseQuote(quote) || !quote) throw new Error('Invalid response quote');
  const response = selectedResponse(state,quote.id,quote.digest);
  quoteResponse(response,quote.text);
}
