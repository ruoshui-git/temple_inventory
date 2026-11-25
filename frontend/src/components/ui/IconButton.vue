<script lang="ts">
import { defineComponent, h, mergeProps, type PropType } from "vue";
import { buttonWithTip } from "../../directives/tip";

export default defineComponent({
	name: "IconButton",
	inheritAttrs: false,
	props: {
		label: { type: String, required: true },
		title: String,
		variant: {
			type: String as PropType<"primary" | "secondary" | "ghost" | "danger">,
			default: "ghost",
		},
		disabled: Boolean,
		loading: Boolean,
	},
	setup(props, { attrs, slots }) {
		return () => {
			const disabled = props.disabled || props.loading;
			const button = h(
				"button",
				mergeProps(
					{
						type: "button",
						class: ["icon-button", `icon-button--${props.variant}`],
						disabled,
						"aria-busy": props.loading || undefined,
						"aria-label": props.label,
					},
					attrs,
				),
				props.loading
					? [h("span", { class: "ui-button-spinner", "aria-hidden": "true" })]
					: slots.default?.(),
			);
			return buttonWithTip(button, props.title || props.label, disabled);
		};
	},
});
</script>
