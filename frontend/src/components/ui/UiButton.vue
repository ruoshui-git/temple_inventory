<script lang="ts">
import { defineComponent, h, mergeProps, type PropType } from "vue";
import { buttonWithTip } from "../../directives/tip";
import InventoryIcon from "../InventoryIcon.vue";

export default defineComponent({
	name: "UiButton",
	inheritAttrs: false,
	props: {
		variant: {
			type: String as PropType<"primary" | "secondary" | "ghost" | "danger">,
			default: "secondary",
		},
		size: { type: String as PropType<"default" | "compact">, default: "default" },
		icon: String,
		iconOnly: Boolean,
		loading: Boolean,
		disabled: Boolean,
		type: { type: String as PropType<"button" | "submit" | "reset">, default: "button" },
		label: String,
		title: String,
		loadingLabel: { type: String, default: "正在处理…" },
	},
	setup(props, { attrs, slots }) {
		return () => {
			const disabled = props.disabled || props.loading;
			const tip = props.title || (props.iconOnly ? props.label : undefined);
			const content = props.loading
				? [
						h("span", { class: "ui-button-spinner", "aria-hidden": "true" }),
						props.iconOnly
							? null
							: h("span", { class: "ui-button-loading-label" }, props.loadingLabel),
					]
				: [
						props.icon ? h(InventoryIcon, { name: props.icon }) : null,
						props.iconOnly ? null : slots.default?.(),
					];
			const button = h(
				"button",
				mergeProps(
					{
						type: props.type,
						class: [
							"ui-button",
							`ui-button--${props.variant}`,
							`ui-button--${props.size}`,
							{
								"is-icon-only": props.iconOnly,
								primary: props.variant === "primary",
							},
						],
						disabled,
						"aria-busy": props.loading || undefined,
						"aria-label": props.iconOnly ? props.label : undefined,
					},
					attrs,
				),
				content,
			);
			return buttonWithTip(button, tip, disabled);
		};
	},
});
</script>
