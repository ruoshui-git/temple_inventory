import {
  defaultDisplayPreferences,
  type DisplayPreferences,
} from "../../src/lib/displayPreferences";
let confirmed: DisplayPreferences = { ...defaultDisplayPreferences };
function seedFixtureDisplay(values: DisplayPreferences) {
  confirmed = {
    theme: values.theme,
    density: values.density,
    textScale: values.textScale,
  };
}
export function fixtureDisplayCall(
  endpoint: string,
  args: Record<string, unknown>,
) {
  if (endpoint === "session.info") {
    return { user: "gallery-reviewer", ui_preferences: { ...confirmed } };
  }
  seedFixtureDisplay(args as unknown as DisplayPreferences);
  return { ...confirmed };
}
