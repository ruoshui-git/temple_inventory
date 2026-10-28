import { defineComponent, h } from "vue";

export const RouterLinkStub = defineComponent({
  name: "RouterLink",
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots }) {
    return () => {
      const target = props.to as {
        name?: string;
        params?: Record<string, string>;
      };
      const href =
        typeof props.to === "string"
          ? props.to
          : target.name === "item-detail"
            ? `/stock/items/${encodeURIComponent(target.params?.code || "")}`
            : target.name === "movements"
              ? `/movements${target.query ? `?${new URLSearchParams(target.query as Record<string, string>)}` : ""}`
              : "#";
      return h("a", { href }, slots.default?.());
    };
  },
});
