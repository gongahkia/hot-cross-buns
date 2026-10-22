import { Extension, type JSONContent } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { DOMParser as SchemaParser, DOMSerializer, type Schema } from "@tiptap/pm/model";
import { htmlTableEnd } from "./htmlTables";

function needsHtml(node: JSONContent): boolean {
  const rows = node.content ?? [];
  const width = rows[0]?.content?.length;
  return rows.some((row, index) => row.content?.length !== width || row.content?.some((cell) =>
    cell.type !== (index === 0 ? "tableHeader" : "tableCell") ||
    cell.attrs?.colspan !== 1 || cell.attrs?.rowspan !== 1 || cell.attrs?.colwidth ||
    cell.content?.length !== 1 || cell.content[0].type !== "paragraph"));
}

/** GFM for simple tables; safe schema-generated HTML for richer table shapes. */
export function markdownTableExtensions() {
  let schema: Schema;
  return [
    Extension.create({ name: "markdownTableSchema", priority: 1100, onBeforeCreate() { schema = this.editor.schema; } }),
    Table.extend({
      renderMarkdown(node, helpers, context) {
        if (!needsHtml(node)) return this.parent!(node, helpers, context);
        const container = document.createElement("div");
        container.append(DOMSerializer.fromSchema(schema).serializeNode(schema.nodeFromJSON(node)));
        container.firstElementChild?.setAttribute("data-hcb-table", "true");
        return container.innerHTML;
      }
    }),
    Extension.create({
      name: "htmlTable", priority: 110,
      markdownTokenizer: {
        name: "htmlTable", level: "block", start: (source) => source.search(/^<table\b[^>]*\bdata-hcb-table="true"/im),
        tokenize: (source) => {
          if (!/^<table\b[^>]*\bdata-hcb-table="true"/i.test(source)) return undefined;
          const end = htmlTableEnd(source); return end < 0 ? undefined : { type: "htmlTable", raw: source.slice(0, end) };
        }
      },
      parseMarkdown(token) {
        const document = new DOMParser().parseFromString(token.raw ?? "", "text/html");
        return SchemaParser.fromSchema(schema).parse(document.body).toJSON().content ?? [];
      }
    })
  ];
}
