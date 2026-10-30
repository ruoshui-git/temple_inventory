import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";

export const auditCjkFont = [
  process.env.TEMPLE_UI_CJK_FONT,
  process.env.NATIVE_UI_REVIEW_FONT,
  "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
].find((candidate) => Boolean(candidate && existsSync(candidate)));

export function auditCjkFontType(font = auditCjkFont) {
  return font?.endsWith(".ttc") ? "font/collection" : "font/otf";
}

export function requiredAuditCjkFont() {
  if (!auditCjkFont) throw new Error("No readable CJK audit font is available");
  return auditCjkFont;
}

function place(
  name: string,
  label: string,
  local_label: string,
  path: string,
  kind: "area" | "room" | "shelf" | "system",
  parent: string,
  lft: number,
  rgt: number,
  is_group: boolean,
  direct = false,
  owner = "",
) {
  return {
    name,
    label,
    local_label,
    short_label: "",
    full_label: local_label,
    path,
    search_text: `${path} ${local_label} ${name}`,
    kind,
    owner,
    direct,
    storable:
      direct || !is_group || name.endsWith("ROOM-A") || name.endsWith("ROOM-B"),
    missing_direct: false,
    parent,
    is_group,
    disabled: false,
    lft,
    rgt,
    version: "test-v1",
    protected: kind === "system",
    can_edit: kind !== "system" && !direct,
  };
}
export const sampleWarehouses = [
  place("PHYSICAL", "实体库房", "实体库房", "", "system", "", 1, 30, true),
  place("T2", "T2", "T2", "T2", "area", "PHYSICAL", 2, 9, true),
  place("ROOM-A", "A02", "A02", "T2 / A02", "room", "T2", 3, 6, true),
  place(
    "A02-DIRECT",
    "A02",
    "A02",
    "T2 / A02",
    "room",
    "ROOM-A",
    4,
    5,
    false,
    true,
    "ROOM-A",
  ),
  place(
    "DEMO-AREA",
    "演示区",
    "演示区",
    "演示区",
    "area",
    "PHYSICAL",
    10,
    29,
    true,
  ),
  place(
    "DEMO-ROOM-A",
    "演示室甲",
    "演示室甲",
    "演示区 / 演示室甲",
    "room",
    "DEMO-AREA",
    11,
    20,
    true,
  ),
  place(
    "SHELF-1",
    "演示室甲 / 演示架1",
    "演示架1",
    "演示区 / 演示室甲 / 演示架1",
    "shelf",
    "DEMO-ROOM-A",
    12,
    13,
    false,
  ),
  place(
    "DEMO-A-DIRECT",
    "演示室甲",
    "演示室甲",
    "演示区 / 演示室甲",
    "room",
    "DEMO-ROOM-A",
    14,
    15,
    false,
    true,
    "DEMO-ROOM-A",
  ),
  place(
    "DEMO-ROOM-B",
    "演示室乙",
    "演示室乙",
    "演示区 / 演示室乙",
    "room",
    "DEMO-AREA",
    21,
    28,
    true,
  ),
  place(
    "ROOM-B-DIRECT",
    "演示室乙",
    "演示室乙",
    "演示区 / 演示室乙",
    "room",
    "DEMO-ROOM-B",
    22,
    23,
    false,
    true,
    "DEMO-ROOM-B",
  ),
];

/** Controlled HTTP contracts for production-UI tests, never native DB acceptance. */
export async function nativeUiSession(
  page: Page,
  textScale = 100,
  bootstrap: Record<string, unknown> = {},
) {
  const replies = {
    "session.info": {
      user: "manager",
      csrf_token: "native-ui-test",
      ui_preferences: {
        theme: "jade",
        density: "balanced",
        textScale,
        default_periods: {
          dashboard: "this_month",
          movements: "this_month",
          loans: "this_month",
          counts: "this_month",
        },
      },
    },
    "configuration.status": {
      setup_required: false,
      blockers: [],
      warnings: [],
    },
    "browse.bootstrap": {
      user: "manager",
      site: "native-ui-test",
      site_date: "2026-10-16",
      site_time: "2026-10-16 12:00:00",
      settings: { company: "TEST" },
      physical_leaves: [
        "A02-DIRECT",
        "SHELF-1",
        "DEMO-A-DIRECT",
        "ROOM-B-DIRECT",
      ],
      leased_leaves: [],
      damaged_leaves: [],
      categories: [],
      warehouses: sampleWarehouses,
      uoms: [
        { name: "Nos", must_be_whole_number: true },
        { name: "箱", must_be_whole_number: true },
      ],
      activity_types: [],
      capabilities: {},
      operations: {},
      ...bootstrap,
    },
  };
  for (const [method, message] of Object.entries(replies))
    await page.route("**/api/method/temple_inventory." + method, (route) =>
      route.fulfill({ json: { message } }),
    );
}
