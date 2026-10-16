<script setup lang="ts">
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
import PreviewOverlay from "../PreviewOverlay.vue";
import PreviewUiButton from "./PreviewUiButton.vue";

const props = withDefaults(
	defineProps<{
		label: string;
		count?: number;
		context?: string;
		active?: boolean;
	}>(),
	{ count: 0, active: true },
);
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { isMobile } = useResponsiveLayout();
const open = ref(false);
const trigger = ref<InstanceType<typeof PreviewUiButton>>();
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
	const anchor = triggerElement()?.getBoundingClientRect();
	if (!anchor) return;
	const margin = 12;
	const width = Math.min(400, window.innerWidth - margin * 2);
	const height = Math.min(
		panel.value.getBoundingClientRect().height,
		window.innerHeight - margin * 2,
	);
	const below = anchor.bottom + 8;
	const top = below + height <= window.innerHeight - margin ? below : anchor.top - height - 8;
	const next = {
		left: `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`,
		top: `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`,
		width: `${width}px`,
	};
	// Observing size may schedule another placement; unchanged geometry does not write again.
	if (JSON.stringify(position.value) !== JSON.stringify(next)) position.value = next;
}
async function toggle() {
	if (open.value) return close(true);
	if (!props.active) return;
	document.dispatchEvent(new CustomEvent("preview-filter-panel-open", { detail: id }));
	position.value = { visibility: "hidden" };
	open.value = true;
	await nextTick();
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
	() => [props.context, props.active, isMobile.value],
	() => close(),
	{ flush: "sync" },
);
onDeactivated(() => close());
onMounted(() => {
	document.addEventListener("preview-filter-panel-open", otherPanel);
	document.addEventListener("pointerdown", outside);
	document.addEventListener("focusin", outside);
	window.addEventListener("resize", reposition);
	window.addEventListener("scroll", reposition, true);
	if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(reposition);
});
onBeforeUnmount(() => {
	observer?.disconnect();
	document.removeEventListener("preview-filter-panel-open", otherPanel);
	document.removeEventListener("pointerdown", outside);
	document.removeEventListener("focusin", outside);
	window.removeEventListener("resize", reposition);
	window.removeEventListener("scroll", reposition, true);
});
</script>
<template>
	<span class="preview-filter-control">
		<PreviewUiButton
			ref="trigger"
			:aria-expanded="open"
			:aria-controls="open ? panelId : undefined"
			aria-haspopup="dialog"
			@click="toggle"
		>
			{{ label }}<span v-if="count" class="count-dot">{{ count }}</span
			><span aria-hidden="true">▾</span>
		</PreviewUiButton>
		<PreviewOverlay
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
				><slot name="footer" /><PreviewUiButton variant="primary" @click="close()"
					>完成</PreviewUiButton
				></template
			>
		</PreviewOverlay>
		<Teleport to="body">
			<section
				v-if="open && !isMobile"
				:id="panelId"
				ref="panel"
				class="preview-filter-popover"
				:style="position"
				role="dialog"
				:aria-labelledby="`${id}-title`"
				tabindex="-1"
				@keydown="keydown"
			>
				<header>
					<strong :id="`${id}-title`">{{ label }}</strong
					><PreviewUiButton
						variant="ghost"
						:aria-label="`关闭${label}`"
						@click="close(true)"
						>关闭 ×</PreviewUiButton
					>
				</header>
				<div class="compact-filter-content"><slot /></div>
				<footer>
					<slot name="footer" /><PreviewUiButton @click="close(true)"
						>完成</PreviewUiButton
					>
				</footer>
			</section>
		</Teleport>
	</span>
</template>
