// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EnvironmentBadge from "../src/components/EnvironmentBadge.vue";
import {
  applyEnvironmentDocument,
  readEnvironment,
} from "../src/lib/environment";

describe("runtime environment branding", () => {
  it("defaults to production without boot data and ignores unknown values", () => {
    expect(readEnvironment(undefined)).toMatchObject({
      environment: "production",
      label: "",
      title: "物资管理",
    });
    expect(readEnvironment({ environment: "unknown" })).toMatchObject({
      environment: "production",
      label: "",
    });
  });

  it("renders a named badge only for non-production environments", () => {
    const production = mount(EnvironmentBadge, {
      props: { environment: readEnvironment(undefined) },
    });
    expect(production.find(".environment-badge").exists()).toBe(false);
    const sample = mount(EnvironmentBadge, {
      props: {
        environment: readEnvironment({
          environment: "sample",
          label: "演示",
          title: "物资管理·演示",
          short_name: "物资·演示",
          theme_color: "#8a4b08",
        }),
      },
    });
    expect(sample.text()).toBe("演示");
    expect(sample.attributes("aria-label")).toBe("演示环境");
  });

  it("applies the runtime title and theme color", () => {
    document.head.innerHTML =
      '<title>old</title><meta name="theme-color" content="#000">';
    applyEnvironmentDocument(
      readEnvironment({
        environment: "sample",
        label: "演示",
        title: "物资管理·演示",
        short_name: "物资·演示",
        theme_color: "#8a4b08",
      }),
    );
    expect(document.title).toBe("物资管理·演示");
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#8a4b08");
  });
});
