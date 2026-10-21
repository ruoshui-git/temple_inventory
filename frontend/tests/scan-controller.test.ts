import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";
import { useScanController } from "../src/features/scanner/useScanController";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(
  call: InventoryServices["call"],
  captureContext?: () => unknown,
) {
  let controller!: ReturnType<typeof useScanController>;
  const items = vi.fn(),
    locations = vi.fn();
  const child = defineComponent({
    setup() {
      controller = useScanController(
        { autoUnique: true },
        items,
        locations,
        captureContext,
      );
      return () => h("div");
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        createReferenceData(),
      );
      return () => h(child);
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return { controller, items, locations };
}

describe("rapid scan lookup queue", () => {
  it("resolves rapid scans in order without aborting the lookup already in flight", async () => {
    const requests: Array<ReturnType<typeof deferred<unknown>>> = [];
    const signals: AbortSignal[] = [];
    const call = vi.fn<InventoryServices["call"]>(
      (_endpoint, _args, signal) => {
        const request = deferred<unknown>();
        requests.push(request);
        if (signal) signals.push(signal);
        return request.promise as never;
      },
    );
    const { controller, items } = setup(call);

    controller.scan("BARCODE-A");
    controller.scan("BARCODE-B");
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.[1]).toEqual({ value: "BARCODE-A" });

    requests[0]!.resolve({
      unknown: false,
      barcode: "BARCODE-A",
      matches: [{ item_code: "ITEM-A", has_batch_no: false }],
      batches: [],
    });
    await flushPromises();
    expect(items).toHaveBeenNthCalledWith(1, "ITEM-A", undefined, undefined);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]?.[1]).toEqual({ value: "BARCODE-B" });
    expect(signals[0]?.aborted).toBe(false);

    requests[1]!.resolve({
      unknown: false,
      barcode: "BARCODE-B",
      matches: [{ item_code: "ITEM-B", has_batch_no: false }],
      batches: [],
    });
    await flushPromises();
    expect(items).toHaveBeenNthCalledWith(2, "ITEM-B", undefined, undefined);
  });

  it("keeps a failed barcode at the queue head until explicit retry", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const third = deferred<unknown>();
    const call = vi
      .fn<InventoryServices["call"]>()
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never)
      .mockReturnValueOnce(third.promise as never);
    const { controller, items } = setup(call);
    controller.scan("BARCODE-A");
    controller.scan("BARCODE-B");
    first.reject(new Error("temporary lookup failure"));
    await flushPromises();
    expect(controller.error.value).toBe("temporary lookup failure");
    expect(call).toHaveBeenCalledTimes(1);

    controller.scan("BARCODE-A");
    expect(controller.pendingCount.value).toBe(2);
    expect(call).toHaveBeenCalledTimes(2);

    controller.retry();
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]?.[1]).toEqual({ value: "BARCODE-A" });
    second.resolve({
      unknown: false,
      barcode: "BARCODE-A",
      matches: [{ item_code: "ITEM-A", has_batch_no: false }],
      batches: [],
    });
    await flushPromises();
    expect(items).toHaveBeenCalledWith("ITEM-A", undefined, undefined);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[2]?.[1]).toEqual({ value: "BARCODE-B" });
  });

  it("keeps an ambiguous middle barcode in FIFO order and passes each captured context", async () => {
    const requests: Array<ReturnType<typeof deferred<unknown>>> = [];
    const call = vi.fn<InventoryServices["call"]>(() => {
      const request = deferred<unknown>();
      requests.push(request);
      return request.promise as never;
    });
    let warehouse = "ROOM-A";
    const { controller, items } = setup(call, () => ({ warehouse }));

    controller.scan("BARCODE-A");
    warehouse = "ROOM-B";
    controller.scan("BARCODE-B");
    warehouse = "ROOM-C";
    controller.scan("BARCODE-C");
    requests[0]!.resolve({
      unknown: false,
      barcode: "BARCODE-A",
      matches: [{ item_code: "ITEM-A" }],
      batches: [],
    });
    await flushPromises();
    expect(items).toHaveBeenNthCalledWith(1, "ITEM-A", undefined, {
      warehouse: "ROOM-A",
    });
    expect(call.mock.calls[1]?.[1]).toEqual({ value: "BARCODE-B" });

    requests[1]!.resolve({
      unknown: false,
      barcode: "BARCODE-B",
      matches: [{ item_code: "ITEM-B1" }, { item_code: "ITEM-B2" }],
      batches: [],
    });
    await flushPromises();
    expect(controller.result.value?.barcode).toBe("BARCODE-B");
    await controller.choose("ITEM-B2");
    await flushPromises();
    expect(items).toHaveBeenNthCalledWith(2, "ITEM-B2", undefined, {
      warehouse: "ROOM-B",
    });
    expect(call.mock.calls[2]?.[1]).toEqual({ value: "BARCODE-C" });

    requests[2]!.resolve({
      unknown: false,
      barcode: "BARCODE-C",
      matches: [{ item_code: "ITEM-C" }],
      batches: [],
    });
    await flushPromises();
    expect(items).toHaveBeenNthCalledWith(3, "ITEM-C", undefined, {
      warehouse: "ROOM-C",
    });
  });

  it("passes batch ambiguity to the operation resolver and honors single-scan mode", async () => {
    const requests: Array<ReturnType<typeof deferred<unknown>>> = [];
    const call = vi.fn<InventoryServices["call"]>(() => {
      const request = deferred<unknown>();
      requests.push(request);
      return request.promise as never;
    });
    const { controller, items } = setup(call);
    controller.continuous.value = false;
    controller.scan("BATCHED-ITEM");
    controller.scan("NEXT-ITEM");
    requests[0]!.resolve({
      unknown: false,
      barcode: "BATCHED-ITEM",
      matches: [{ item_code: "ITEM-BATCHED", has_batch_no: true }],
      batches: ["BATCH-1", "BATCH-2"],
    });
    await flushPromises();
    expect(items).toHaveBeenCalledWith("ITEM-BATCHED", undefined, undefined);
    expect(controller.result.value).toBeUndefined();
    expect(controller.stopped.value).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    controller.stopped.value = false;
    await flushPromises();
    expect(call.mock.calls[1]?.[1]).toEqual({ value: "NEXT-ITEM" });
  });

  it("cancels pending network lookups without applying stale barcode results", async () => {
    const request = deferred<unknown>();
    const call = vi.fn<InventoryServices["call"]>(
      () => request.promise as never,
    );
    const { controller, items } = setup(call);
    controller.scan("BARCODE-A");
    controller.scan("BARCODE-B");
    controller.cancelPending();
    expect(controller.pendingCount.value).toBe(0);
    request.resolve({
      unknown: false,
      barcode: "BARCODE-A",
      matches: [{ item_code: "ITEM-A" }],
      batches: [],
    });
    await flushPromises();
    expect(items).not.toHaveBeenCalled();
  });

  it("retries a failed ambiguous item acknowledgement without duplicating its queued barcode", async () => {
    const call = vi.fn<InventoryServices["call"]>(
      async () =>
        ({
          unknown: false,
          barcode: "AMBIGUOUS",
          matches: [{ item_code: "ITEM-A" }, { item_code: "ITEM-B" }],
          batches: [],
        }) as never,
    );
    const { controller, items } = setup(call);
    items
      .mockImplementationOnce(async () => {
        throw new Error("capacity changed");
      })
      .mockResolvedValue(undefined);
    controller.scan("AMBIGUOUS");
    await flushPromises();
    await controller.choose("ITEM-A");
    expect(controller.error.value).toBe("capacity changed");
    controller.scan("AMBIGUOUS");
    await flushPromises();
    expect(call).toHaveBeenCalledTimes(1);
    expect(items).toHaveBeenNthCalledWith(2, "ITEM-A", undefined, undefined);
    expect(controller.pendingCount.value).toBe(0);
  });
});
