import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NativeStatusBadge from "../src/components/ui/NativeStatusBadge.vue";

it.each([
  [0, "草稿", "is-warning"],
  [1, "已提交", "is-success"],
  [2, "已取消", "is-danger"],
  [undefined, "状态未知", "is-neutral"],
])("labels native status %s", (status, label, tone) => {
  const wrapper = mount(NativeStatusBadge, { props: { status } });
  expect(wrapper.text()).toBe(label);
  expect(wrapper.classes()).toContain(tone);
});
