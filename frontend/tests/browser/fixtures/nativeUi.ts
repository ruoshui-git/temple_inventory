import type { Page } from "@playwright/test";

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
      ui_preferences: { theme: "jade", density: "balanced", textScale },
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
      physical_leaves: ["ROOM-A"],
      leased_leaves: [],
      damaged_leaves: [],
      categories: [],
      warehouses: [
        {
          name: "ROOM-A",
          local_label: "库房甲",
          breadcrumb: "库房甲",
          is_group: false,
        },
      ],
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
