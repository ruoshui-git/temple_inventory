// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import RemoteSelect from "../src/components/ui/RemoteSelect.vue";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("loads immediately on open and debounces remote queries while aborting stale work", async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => ({ rows: [], total: 0, next: null }));
  const wrapper = mount(RemoteSelect, {
    attachTo: document.body,
    props: { label: "活动", load },
  });
  const input = wrapper.get<HTMLInputElement>('input[role="combobox"]');
  input.element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 240,
      height: 40,
      right: 240,
      bottom: 40,
    }) as DOMRect;
  await input.trigger("focus");
  await flushPromises();
  expect(load).toHaveBeenCalledTimes(1);
  await input.setValue("秋");
  await input.setValue("秋季");
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(249);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await flushPromises();
  expect(load).toHaveBeenCalledTimes(2);
  expect(load.mock.calls[1]?.[0]).toBe("秋季");
  expect(load.mock.calls[0]?.[2].aborted).toBe(true);
  wrapper.unmount();
});
