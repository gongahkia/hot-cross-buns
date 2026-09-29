#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repositoryRoot, "docs/architecture/hot-cross-buns-architecture.json");
const drawioPath = resolve(repositoryRoot, "docs/architecture/hot-cross-buns-current-architecture.drawio");
const svgPath = resolve(repositoryRoot, "docs/assets/hot-cross-buns-current-architecture.svg");
const checkOnly = process.argv.includes("--check");

const colors = {
  background: "#181818",
  panel: "#202020",
  panelHeader: "#2b2b2b",
  node: "#32302f",
  database: "#3c3836",
  note: "#282828",
  text: "#fbf1c7",
  subtext: "#a89984",
  edgeText: "#d5c4a1",
  muted: "#a89984",
  blue: "#83a598",
  green: "#b8bb26",
  brightGreen: "#8ec07c",
  yellow: "#d79921",
  orange: "#fe8019",
  border: "#665c54",
  boundary: "#504945"
};

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

function assertArchitecture(model) {
  if (!model || typeof model !== "object") throw new Error("Architecture source must be a JSON object.");
  for (const key of ["title", "subtitle", "note", "lastReviewed"]) {
    if (typeof model[key] !== "string" || !model[key].trim()) throw new Error(`Architecture source is missing ${key}.`);
  }
  if (!Array.isArray(model.groups) || !Array.isArray(model.nodes) || !Array.isArray(model.edges)) {
    throw new Error("Architecture source requires groups, nodes, and edges arrays.");
  }
  const ids = new Set(model.nodes.map((node) => node.id));
  if (ids.size !== model.nodes.length) throw new Error("Architecture node IDs must be unique.");
  for (const edge of model.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`Architecture edge ${edge.label} references an unknown node.`);
  }
}

function wrapText(value, maxCharacters) {
  const words = value.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharacters && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function nodeStyle(node) {
  const accent = colors[node.accent] ?? colors.border;
  if (node.kind === "user") return `ellipse;html=1;whiteSpace=wrap;fillColor=${colors.database};strokeColor=${accent};fontColor=${colors.text};fontSize=15;fontStyle=1;`;
  if (node.kind === "database") return `shape=cylinder;html=1;whiteSpace=wrap;boundedLbl=1;backgroundOutline=1;fillColor=${colors.database};strokeColor=${accent};fontColor=${colors.text};fontSize=14;fontStyle=1;`;
  if (node.kind === "cloud" || node.kind === "cloudOptional") return `shape=cloud;html=1;whiteSpace=wrap;fillColor=${colors.node};strokeColor=${accent};${node.kind === "cloudOptional" ? "dashed=1;" : ""}fontColor=${colors.text};fontSize=14;fontStyle=1;`;
  if (node.kind === "browser") return `shape=mxgraph.basic.browser;html=1;whiteSpace=wrap;fillColor=${colors.database};strokeColor=${accent};fontColor=${colors.text};fontSize=15;fontStyle=1;`;
  if (node.kind === "boundary") return `rounded=1;html=1;whiteSpace=wrap;fillColor=${colors.note};strokeColor=${colors.boundary};dashed=1;fontColor=${colors.subtext};fontSize=12;`;
  return `rounded=1;html=1;whiteSpace=wrap;fillColor=${colors.node};strokeColor=${accent};fontColor=${colors.text};fontSize=16;fontStyle=1;`;
}

function drawioLabel(node) {
  if (!node.detail) return escapeXml(node.label);
  return `${escapeXml(node.label)}&lt;br&gt;&lt;font style=&quot;font-size:12px&quot;&gt;${escapeXml(node.detail)}&lt;/font&gt;`;
}

function generateDrawio(model) {
  const groupCells = model.groups.map((group) => `        <mxCell id="${escapeXml(group.id)}" value="${escapeXml(group.title)}" style="swimlane;html=1;horizontal=1;startSize=34;rounded=1;fillColor=${colors.panel};swimlaneFillColor=${colors.panelHeader};strokeColor=${colors.border};fontColor=${colors.text};fontSize=16;fontStyle=1;spacingLeft=12;" vertex="1" parent="1"><mxGeometry x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" as="geometry"/></mxCell>`).join("\n");
  const nodeCells = model.nodes.map((node) => `        <mxCell id="${escapeXml(node.id)}" value="${drawioLabel(node)}" style="${nodeStyle(node)}" vertex="1" parent="1"><mxGeometry x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" as="geometry"/></mxCell>`).join("\n");
  const edgeCells = model.edges.map((edge, index) => {
    const points = edge.points?.length
      ? `<Array as="points">${edge.points.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join("")}</Array>`
      : "";
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;${edge.dashed ? "dashed=1;" : ""}strokeColor=${colors[edge.color] ?? colors.muted};fontColor=${colors.edgeText};fontSize=11;labelBackgroundColor=${colors.background};endArrow=block;endFill=1;`;
    return `        <mxCell id="edge-${index + 1}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1" source="${escapeXml(edge.from)}" target="${escapeXml(edge.to)}"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`;
  }).join("\n");

  return `<!-- Generated by scripts/generate-architecture-diagram.mjs from docs/architecture/hot-cross-buns-architecture.json. Do not edit directly. -->
<mxfile host="app.diagrams.net" modified="${escapeXml(model.lastReviewed)}T00:00:00.000Z" agent="Hot Cross Buns architecture generator" version="28.2.8" type="device">
  <diagram id="hcb-current-architecture" name="Current architecture">
    <mxGraphModel dx="1600" dy="1040" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0" background="${colors.background}">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="title" value="${escapeXml(model.title)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=26;fontStyle=1;fontColor=${colors.text};spacingLeft=4;" vertex="1" parent="1"><mxGeometry x="45" y="30" width="1120" height="38" as="geometry"/></mxCell>
        <mxCell id="subtitle" value="${escapeXml(model.subtitle)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=14;fontColor=${colors.subtext};spacingLeft=4;" vertex="1" parent="1"><mxGeometry x="45" y="68" width="1120" height="26" as="geometry"/></mxCell>
${groupCells}
${nodeCells}
${edgeCells}
        <mxCell id="note" value="${escapeXml(model.note)}" style="rounded=1;html=1;whiteSpace=wrap;fillColor=${colors.note};strokeColor=${colors.border};fontColor=${colors.edgeText};fontSize=13;align=left;spacingLeft=14;spacingRight=14;" vertex="1" parent="1"><mxGeometry x="45" y="880" width="1510" height="100" as="geometry"/></mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

function svgNode(node) {
  const accent = colors[node.accent] ?? colors.border;
  const x = node.x;
  const y = node.y;
  const width = node.width;
  const height = node.height;
  const centerX = x + width / 2;
  const labelY = node.detail ? y + height / 2 - 9 : y + height / 2 + 5;
  const dashed = node.kind === "boundary" || node.kind === "cloudOptional" ? ' stroke-dasharray="6 5"' : "";
  let shape;
  if (node.kind === "user") shape = `<ellipse cx="${centerX}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${colors.database}" stroke="${accent}" stroke-width="2"/>`;
  else if (node.kind === "database") shape = `<path d="M ${x} ${y + 13} C ${x} ${y - 4}, ${x + width} ${y - 4}, ${x + width} ${y + 13} L ${x + width} ${y + height - 13} C ${x + width} ${y + height + 4}, ${x} ${y + height + 4}, ${x} ${y + height - 13} Z" fill="${colors.database}" stroke="${accent}" stroke-width="2"/><ellipse cx="${centerX}" cy="${y + 13}" rx="${width / 2}" ry="17" fill="${colors.database}" stroke="${accent}" stroke-width="2"/>`;
  else if (node.kind === "cloud" || node.kind === "cloudOptional") shape = `<path d="M ${x + 42} ${y + height - 12} C ${x + 7} ${y + height - 12}, ${x + 8} ${y + 28}, ${x + 48} ${y + 28} C ${x + 57} ${y - 4}, ${x + 126} ${y - 7}, ${x + 145} ${y + 22} C ${x + 197} ${y + 3}, ${x + width - 2} ${y + 27}, ${x + width - 18} ${y + 57} C ${x + width + 4} ${y + height - 4}, ${x + 195} ${y + height}, ${x + 175} ${y + height - 12} Z" fill="${colors.node}" stroke="${accent}" stroke-width="2"${dashed}/>`;
  else shape = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${node.kind === "boundary" ? colors.note : colors.node}" stroke="${node.kind === "boundary" ? colors.boundary : accent}" stroke-width="2"${dashed}/>`;
  const detail = node.detail ? `<text x="${centerX}" y="${labelY + 24}" text-anchor="middle" class="detail">${escapeXml(node.detail)}</text>` : "";
  return `<g>${shape}<text x="${centerX}" y="${labelY}" text-anchor="middle" class="nodeLabel">${escapeXml(node.label)}</text>${detail}</g>`;
}

function svgEndpoint(node, target, point) {
  if (point) return point;
  const sourceX = node.x + node.width / 2;
  const sourceY = node.y + node.height / 2;
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;
  if (Math.abs(targetX - sourceX) > Math.abs(targetY - sourceY)) {
    return [targetX >= sourceX ? node.x + node.width : node.x, sourceY];
  }
  return [sourceX, targetY >= sourceY ? node.y + node.height : node.y];
}

function generateSvg(model) {
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const groups = model.groups.map((group) => `<g><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="14" fill="${colors.panel}" stroke="${colors.border}" stroke-width="2"/><path d="M ${group.x + 14} ${group.y} H ${group.x + group.width - 14} Q ${group.x + group.width} ${group.y} ${group.x + group.width} ${group.y + 14} V ${group.y + 34} H ${group.x} V ${group.y + 14} Q ${group.x} ${group.y} ${group.x + 14} ${group.y}" fill="${colors.panelHeader}"/><text x="${group.x + 15}" y="${group.y + 22}" class="groupLabel">${escapeXml(group.title)}</text></g>`).join("\n");
  const edges = model.edges.map((edge) => {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    const start = svgEndpoint(source, target);
    const end = svgEndpoint(target, source);
    const points = [start, ...(edge.points ?? []), end];
    const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
    const [labelX, labelY] = edge.points?.[0] ?? [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    return `<g><path d="${path}" fill="none" stroke="${colors[edge.color] ?? colors.muted}" stroke-width="2"${edge.dashed ? ' stroke-dasharray="7 5"' : ""} marker-end="url(#arrow-${edge.color})"/><rect x="${labelX + 6}" y="${labelY - 19}" width="${Math.min(245, Math.max(105, edge.label.length * 6.2))}" height="18" rx="3" fill="${colors.background}" opacity="0.94"/><text x="${labelX + 10}" y="${labelY - 6}" class="edgeLabel">${escapeXml(edge.label)}</text></g>`;
  }).join("\n");
  const markers = ["muted", "blue", "green", "brightGreen", "yellow", "orange"].map((name) => `<marker id="arrow-${name}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="${colors[name]}"/></marker>`).join("");
  const noteLines = wrapText(model.note, 150);
  return `<!-- Generated by scripts/generate-architecture-diagram.mjs from docs/architecture/hot-cross-buns-architecture.json. Reviewed ${escapeXml(model.lastReviewed)}. Do not edit directly. -->
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1020" viewBox="0 0 1600 1020" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(model.title)}</title>
  <desc id="description">${escapeXml(model.subtitle)}</desc>
  <defs><style><![CDATA[
    text { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .groupLabel { fill: ${colors.text}; font-size: 16px; font-weight: 700; }
    .nodeLabel { fill: ${colors.text}; font-size: 15px; font-weight: 700; }
    .detail { fill: ${colors.subtext}; font-size: 11px; }
    .edgeLabel { fill: ${colors.edgeText}; font-size: 10px; }
  ]]></style>${markers}</defs>
  <rect width="1600" height="1020" fill="${colors.background}"/>
  <text x="45" y="58" fill="${colors.text}" font-size="26" font-weight="700">${escapeXml(model.title)}</text>
  <text x="45" y="87" fill="${colors.subtext}" font-size="14">${escapeXml(model.subtitle)}</text>
  ${groups}
  ${edges}
  ${model.nodes.map(svgNode).join("\n  ")}
  <rect x="45" y="880" width="1510" height="100" rx="12" fill="${colors.note}" stroke="${colors.border}" stroke-width="2"/>
  <text x="62" y="912" fill="${colors.edgeText}" font-size="13">${noteLines.map((line, index) => `<tspan x="62" dy="${index === 0 ? 0 : 20}">${escapeXml(line)}</tspan>`).join("")}</text>
</svg>
`;
}

async function ensureOutput(path, content) {
  if (checkOnly) {
    const current = await readFile(path, "utf8").catch(() => null);
    if (current !== content) throw new Error(`${path.replace(`${repositoryRoot}/`, "")} is stale. Run: corepack pnpm architecture:generate`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const model = JSON.parse(await readFile(sourcePath, "utf8"));
assertArchitecture(model);
await ensureOutput(drawioPath, generateDrawio(model));
await ensureOutput(svgPath, generateSvg(model));
console.log(checkOnly ? "Architecture diagram is current." : "Generated Draw.io and SVG architecture diagrams.");
