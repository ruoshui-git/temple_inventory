<script setup lang="ts">
import DisclosureIcon from "./DisclosureIcon.vue";
import {
	computed,
	nextTick,
	onBeforeUnmount,
	onDeactivated,
	onMounted,
	ref,
	useId,
	watch,
} from "vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import Overlay from "./Overlay.vue";
import UiButton from "./UiButton.vue";
import { chooseFilterPopoverPlacement } from "../../lib/filterPopoverPlacement";
import { scrollBy, scrollOwner } from "../../composables/scrollSurface";

const props = withDefaults(
	defineProps<{
		label: string;
		count?: number;
		context?: string;
		active?: boolean;
		iconOnly?: boolean;
	}>(),
	{ count: 0, active: true, iconOnly: false },
);
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { isMobile } = useResponsiveLayout();
const open = ref(false);
const trigger = ref<InstanceType<typeof UiButton>>();
const panel = ref<HTMLElement>();
const id = useId();
const position = ref<Record<string, string>>({ visibility: "hidden" });
const panelId = computed(() => `${id}-panel`);
let observer: ResizeObserver | undefined;
const triggerElement = () => trigger.value?.$el as HTMLButtonElement | undefined;

function close(restore = false) {
	if (!open.value) return;
	open.value = false;
	if (restore && !isMobile.value && triggerElement()?.isConnected)
		triggerElement()?.focus({ preventScroll: true });
}
function reposition() {
	if (!open.value || isMobile.value || !panel.value) return;
	const button = triggerElement();
	let anchor = button?.getBoundingClientRect();
	if (!anchor) return;
	const margin = 12;
	const wide = Boolean(panel.value?.querySelector(".browse-filter-mega"));
	const width = Math.min(wide ? 760 : 400, window.innerWidth - margin * 2);
	const naturalHeight = Math.max(
		panel.value.scrollHeight,
		panel.value.getBoundingClientRect().height,
	);
	const minimum = Math.min(naturalHeight, 360);
	const belowSpace = window.innerHeight - margin - anchor.bottom - 8;
	if (belowSpace < minimum && button) {
		const owner = scrollOwner(button);
		const rootStyle = getComputedStyle(document.documentElement);
		const measuredShellTop =
			Number.parseFloat(rootStyle.getPropertyValue("--app-desktop-nav-height")) || 0;
		const ownerTop = owner instanceof HTMLElement ? owner.getBoundingClientRect().top : 0;
		const topInset = owner instanceof HTMLElement ? 0 : measuredShellTop;
		const targetTop = ownerTop + topInset + 16;
		const delta = anchor.top - targetTop;
		if (Math.abs(delta) > 1) {
			scrollBy(owner, delta);
			anchor = button.getBoundingClientRect();
		}
	}
	const placement = chooseFilterPopoverPlacement({
		triggerTop: anchor.top,
		triggerBottom: anchor.bottom,
		viewportHeight: window.innerHeight,
		naturalHeight,
		margin,
	});
	const next = {
		left: `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`,
		top: `${placement.top}px`,
		width: `${width}px`,
		maxHeight: `${placement.maxHeight}px`,
		minHeight: `${placement.minHeight}px`,
	};
	// Observing size may schedule another placement; unchanged geometry does not write again.
	if (JSON.stringify(position.value) !== JSON.stringify(next)) position.value = next;
}
async function toggle() {
	if (open.value) return close(true);
	if (!props.active) return;
	document.dispatchEvent(new CustomEvent("browse-filter-panel-open", { detail: id }));
	position.value = { visibility: "hidden" };
	open.value = true;
	await nextTick();
	// A filter panel starts with its individual editors closed on each opening.
	panel.value?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((item) => {
		item.open = false;
	});
	if (!isMobile.value && open.value) {
		reposition();
		// Vue must remove the initial visibility:hidden before the browser can focus it.
		await nextTick();
		if (isMobile.value || !open.value) return;
		panel.value?.focus({ preventScroll: true });
		if (panel.value) observer?.observe(panel.value);
	}
}
function otherPanel(event: Event) {
	if ((event as CustomEvent).detail !== id) close();
}
function outside(event: Event) {
	if (isMobile.value || !open.value) return;
	const target = event.target as Node;
	if (!panel.value?.contains(target) && !triggerElement()?.contains(target)) close();
}
function keydown(event: KeyboardEvent) {
	// Search selectors and tree searches consume their first Escape themselves.
	if (event.defaultPrevented) return;
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		close(true);
	}
	if (event.key !== "Tab") return;
	const controls = Array.from(
		panel.value?.querySelectorAll<HTMLElement>(
			'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]',
		) || [],
	).filter((element) => {
		for (
			let parent: HTMLElement | null = element;
			parent && parent !== panel.value;
			parent = parent.parentElement
		) {
			const style = getComputedStyle(parent);
			if (
				parent.hidden ||
				parent.inert ||
				style.display === "none" ||
				style.visibility === "hidden"
			)
				return false;
			if (
				parent instanceof HTMLDetailsElement &&
				!parent.open &&
				!parent.querySelector("summary")?.contains(element)
			)
				return false;
		}
		return element.tabIndex >= 0;
	});
	// A desktop dialog is non-modal: Tab at its boundary returns to its trigger.
	if (
		(!event.shiftKey && document.activeElement === controls.at(-1)) ||
		(event.shiftKey &&
			[panel.value, controls[0]].includes(document.activeElement as HTMLElement))
	) {
		event.preventDefault();
		close(true);
	}
}
watch(open, (value) => {
	emit("update:open", value);
	if (!value) observer?.disconnect();
});
watch(
	() => [props.context, props.active],
	() => close(),
	{ flush: "sync" },
);
watch(isMobile, async () => {
	if (!open.value) return;
	observer?.disconnect();
	await nextTick();
	if (!isMobile.value && open.value) {
		reposition();
		await nextTick();
		panel.value?.focus({ preventScroll: true });
		if (panel.value) observer?.observe(panel.value);
	}
});
onDeactivated(() => close());
onMounted(() => {
	document.addEventListener("browse-filter-panel-open", otherPanel);
	document.addEventListener("pointerdown", outside);
	document.addEventListener("focusin", outside);
	window.addEventListener("resize", reposition);
	window.addEventListener("scroll", reposition, true);
	if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(reposition);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	document.removeEventListener("browse-filter-panel-open", otherPanel);
	document.removeEventListener("pointerdown", outside);
	document.removeEventListener("focusin", outside);
	window.removeEventListener("resize", reposition);
	window.removeEventListener("scroll", reposition, true);
});
defineExpose({
	show: async (field?: string) => {
		if (!open.value) await toggle();
		if (!field) return;
		await nextTick();
		const content = document.getElementById(panelId.value);
		const section = Array.from(
			content?.querySelectorAll<HTMLElement>("[data-filter-field]") || [],
		).find((item) => item.dataset.filterField === field);
		const disclosure = section?.closest<HTMLDetailsElement>("details");
		for (
			let parent = section?.parentElement;
			parent && parent !== content;
			parent = parent.parentElement
		) {
			if (parent instanceof HTMLDetailsElement) parent.open = true;
		}
		if (disclosure) disclosure.open = true;
		const control = section?.querySelector<HTMLElement>(
			'input:not([type="hidden"]),select,button,[tabindex="0"]',
		);
		(control || section)?.focus({ preventScroll: true });
		(section || control)?.scrollIntoView({ block: "nearest" });
	},
	hide: () => close(true),
});
</script>
<template>
	<span class="browse-filter-control">
		<UiButton
			ref="trigger"
			:icon="iconOnly ? 'filter' : undefined"
			:icon-only="iconOnly"
			:label="`${label}${count ? `，${count}项已应用` : ''}`"
			:aria-expanded="open"
			:aria-controls="open ? panelId : undefined"
			aria-haspopup="dialog"
			@click="toggle"
		>
			<span v-if="!iconOnly">{{ label }}</span
			><span v-if="count" class="count-dot">{{ count }}</span
			><DisclosureIcon v-if="!iconOnly" variant="popup" />
		</UiButton>
		<Overlay
			v-if="open && isMobile"
			:title="label"
			:transient-owner="id"
			filter-sheet
			drawer
			:panel-style="{ width: '100%', maxWidth: '100%' }"
			@close="close()"
		>
			<div :id="panelId" class="compact-filter-content"><slot /></div>
			<template #footer
				><slot name="footer" /><UiButton variant="primary" @click="close()"
					>完成</UiButton
				></template
			>
		</Overlay>
		<Teleport to="body">
			<section
				v-if="open && !isMobile"
				:id="panelId"
				ref="panel"
				class="browse-filter-popover"
				:style="position"
				role="dialog"
				:aria-labelledby="`${id}-title`"
				tabindex="-1"
				@keydown="keydown"
			>
				<header>
					<strong :id="`${id}-title`">{{ label }}</strong
					><UiButton variant="ghost" :aria-label="`关闭${label}`" @click="close(true)"
						>关闭 ×</UiButton
					>
				</header>
				<div class="compact-filter-content"><slot /></div>
				<footer>
					<slot name="footer" /><UiButton @click="close(true)">完成</UiButton>
				</footer>
			</section>
		</Teleport>
	</span>
</template>
