// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ForbiddenState from "../src/components/ui/ForbiddenState.vue";

it("explains how to request permission and emits the back action", async () => {
  const wrapper = mount(ForbiddenState);
  expect(wrapper.get('[data-testid="forbidden-state"]').text()).toContain(
    "需要其他权限时请联系管理员",
  );
  await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("back")).toHaveLength(1);
});
