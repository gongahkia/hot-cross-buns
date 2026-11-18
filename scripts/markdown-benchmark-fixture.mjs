export function benchmarkPlanner(size, date, run = 0) {
  if (!Number.isInteger(size) || size < 20 || size > 10000) throw new Error('Benchmark fixtures support 20–10,000 entries.');
  const lines = ['---', 'hcb-format: 2', `document-id: benchmark-${size}-${run}`, '---', '', '[shared]: https://example.invalid/reference', '', '## Dated', '', '### 2000-01-01', ''];
  for (let index = 0; index < size - 20; index++) {
    lines.push('- [x] Historical item', '  ```hcb', `  id: historical-${index}`, '  ```', '  - [x] Checked detail');
    if (index % 100 === 0) lines.push('', '  Context with **formatting**, [a reference][shared] and $$x_i$$.');
    if (index % 500 === 0) lines.push('', '  ~~~js', '  const retained = "Unicode 👩🏽‍💻";', '  ~~~');
    lines.push('');
  }
  lines.push(`### ${date}`, '');
  for (let index = 0; index < 20; index++) {
    lines.push(`- [ ] Visible task ${index}`, '  ```hcb', `  id: visible-${index}`, '  ```');
    if (!index) lines.push('', '  A **small** note with [context][shared].');
    lines.push('');
  }
  lines.push('## Undated', '', '### Inbox', '', '- A reference note', '', '## Scratchpad', 'Shared capture.', '');
  return lines.join('\n');
}
