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
            : "#";
      return h("a", { href }, slots.default?.());
    };
  },
});
