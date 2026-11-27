import { sourceCatalog, sourcePreview } from './source-preview.mjs';

// Combine retained data only; never fetch live files, URLs, or model responses.
export async function answerContext(request, owner, inspect) {
  if (!request || Object.keys(request).some(key => !['context', 'run', 'previews'].includes(key)) ||
      request.previews !== undefined && typeof request.previews !== 'boolean' ||
      typeof request.run !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(request.run) ||
      request.context !== `conversation:${owner.state?.conversation_id}` || !owner.current()) {
    throw new Error('Return to the answer’s conversation before inspecting its context.');
  }
  const result = { run: request.run, references: [] };
  try {
    const value = await inspect(request.run);
    if (value.error) result.context_error = value.error;
    else result.context = value.context;
  } catch (error) { result.context_error = error.message; }
  try {
    const catalog = await sourceCatalog({ context: request.context, run: request.run }, owner);
    result.truncated = catalog.truncated;
    for (const [index, reference] of catalog.references.entries()) {
      if (!owner.current()) throw new Error('The conversation changed. Reopen this answer’s context.');
      const item = { ...reference };
      if (request.previews === false) { result.references.push(item); continue; }
      if (index < 32) {
        try { item.preview = await sourcePreview({ context: request.context, run: request.run, path: `evidence:${reference.id}` }, owner); }
        catch (error) { item.error = error.message; }
      } else item.error = 'Excerpt omitted: this answer exceeds the 32-source preview limit.';
      result.references.push(item);
    }
  } catch (error) { result.sources_error = error.message; }
  if (!owner.current()) throw new Error('The conversation changed. Reopen this answer’s context.');
  return result;
}
