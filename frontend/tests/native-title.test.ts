import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTemplate, parse as parseSfc } from "vue/compiler-sfc";
import { describe, expect, it } from "vitest";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "../src");

// These are component APIs, not DOM tooltips. Keep the reason beside each exception.
const componentTitleAllowlist: Record<string, string> = {
  BrowseToolbar: "Page heading forwarded to PageHeader.",
  DashboardSection: "Section heading displayed in the section header.",
  DisclosureSection: "Visible disclosure heading and accessible name.",
  HierarchyFilter: "Visible heading for the hierarchy picker.",
  IconButton: "Shared v-tip API for icon buttons.",
  LocationLabel:
    "Location identity used for its accessible name and location tip.",
  Overlay: "Accessible dialog heading.",
  PageHeader: "Visible page heading.",
  QuickExport: "Export scope label shown in the export dialog.",
  RowFieldsSheet: "Accessible dialog heading passed to Overlay.",
  UiButton: "Shared v-tip API for buttons, including disabled reasons.",
  UnitValues: "Optional full-text tooltip content for the unit summary.",
};

function vueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory()
      ? vueFiles(file)
      : file.endsWith(".vue")
        ? [file]
        : [];
  });
}

function isTitleAttribute(prop: {
  type: number;
  name?: string;
  arg?: { content?: string };
}) {
  return (
    (prop.type === 6 && prop.name === "title") ||
    (prop.type === 7 && prop.name === "bind" && prop.arg?.content === "title")
  );
}

describe("native browser tooltips", () => {
  it("uses v-tip for every HTML title and keeps component title props explicit", () => {
    const nativeTitles: string[] = [];
    const unlistedComponentTitles: string[] = [];

    for (const file of vueFiles(sourceRoot)) {
      const { descriptor, errors } = parseSfc(readFileSync(file, "utf8"), {
        filename: file,
      });
      expect(errors, relative(sourceRoot, file)).toEqual([]);
      if (!descriptor.template) continue;

      const result = compileTemplate({
        filename: file,
        id: relative(sourceRoot, file),
        source: descriptor.template.content,
        compilerOptions: {
          nodeTransforms: [
            (node) => {
              // <title> is SVG text; an iframe's title is its accessible name, never a hover tip.
              if (
                node.type !== 1 ||
                node.tag === "title" ||
                node.tag === "iframe"
              )
                return;
              if (!node.props.some(isTitleAttribute)) return;
              const location = `${relative(sourceRoot, file)}:${node.loc.start.line}`;
              if (node.tagType === 0) nativeTitles.push(location);
              else if (!componentTitleAllowlist[node.tag])
                unlistedComponentTitles.push(`${location} <${node.tag}>`);
            },
          ],
        },
      });
      expect(result.errors, relative(sourceRoot, file)).toEqual([]);
    }

    expect(nativeTitles).toEqual([]);
    expect(unlistedComponentTitles).toEqual([]);
  });
});
