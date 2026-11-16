import assert from 'node:assert/strict';
import test from 'node:test';

for (const variant of ['index.js', 'dev/index.js']) test(`parser ${variant} preserves event identity/order without recopying unchanged prefixes`, async () => {
  const { EditMap } = await import(`../node_modules/micromark-util-edit-map/${variant}`);
  let seed = 17;
  const random = limit => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  for (let run = 0; run < 1000; run++) {
    const events = Array.from({ length: 100 }, (_, index) => ({ index }));
    const original = [...events], expected = [...events], edits = [], map = new EditMap();
    for (let index = random(5); index < events.length; index += 5) {
      const added = [{ run, index }], first = [{ before: index }], remove = random(3);
      map.add(index, remove, added); map.addBefore(index, 0, first);
      edits.push({ index, remove, added: [...first] });
    }
    for (const edit of edits.reverse()) expected.splice(edit.index, edit.remove, ...edit.added);
    const reference = events; map.consume(events);
    assert.equal(events, reference);
    assert.equal(events.length, expected.length);
    events.forEach((event, index) => assert.equal(event, expected[index]));
    map.consume(events); assert.deepEqual(events, expected);
    map.add(0, 1, [original[0]]); map.consume(events); assert.equal(events[0], original[0]);
  }
  const events = Array.from({ length: 10000 }, (_, index) => ({ index }));
  let copied = 0;
  events.slice = function (...args) { const result = Array.prototype.slice.apply(this,args); copied += result.length; return result; };
  const map = new EditMap(); map.add(9999,1,[{ replacement:true }]); map.consume(events);
  assert.ok(copied < 10, `Copied ${copied} unchanged event references`);
  assert.equal(events.length,10000);
  assert.equal(events[9999].replacement,true);
});
