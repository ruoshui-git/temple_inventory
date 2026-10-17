import { reactive } from "vue";
import {
  defaultDisplayPreferences,
  type DisplayPreferences,
} from "../lib/displayPreferences";
export const fixtureDisplayScenario = reactive({
  failRead: false,
  failSave: false,
});
let confirmed: DisplayPreferences = { ...defaultDisplayPreferences };
export function seedFixtureDisplay(values: DisplayPreferences) {
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
    if (fixtureDisplayScenario.failRead)
      throw new Error("图库账户设置读取失败");
    return { user: "gallery-reviewer", ui_preferences: { ...confirmed } };
  }
  if (fixtureDisplayScenario.failSave) {
    fixtureDisplayScenario.failSave = false;
    throw new Error("图库账户设置保存失败");
  }
  seedFixtureDisplay(args as unknown as DisplayPreferences);
  return { ...confirmed };
}
