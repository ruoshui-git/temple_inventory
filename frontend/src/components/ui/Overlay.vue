<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, type CSSProperties } from "vue";
import UiButton from "./UiButton.vue";
const props = withDefaults(
	defineProps<{
		title: string;
		dismissible?: boolean;
		subtitle?: string;
		drawer?: boolean;
		adaptiveCreation?: boolean;
		filterSheet?: boolean;
		transientOwner?: string;
		panelStyle?: CSSProperties;
	}>(),
	{
		drawer: false,
		dismissible: true,
	},
);
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
const titleId = useId();
function requestClose() {
	if (props.dismissible) emit("close");
}
let invoker: HTMLElement | null = null;
let openingLocation = "";
function closeAfterNavigation() {
	if (window.location.href !== openingLocation) emit("close");
}
let previousOverflow = "";
let app: HTMLElement | null = null;
let previousInert = false;
function isTabbable(element: HTMLElement) {
	if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[inert]"))
		return false;
	for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
		const style = getComputedStyle(ancestor);
		if (ancestor.hidden || style.display === "none" || style.visibility === "hidden")
			return false;
		if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
			const summary = ancestor.querySelector(":scope > summary");
			if (!summary?.contains(element)) return false;
		}
		if (ancestor === panel.value) break;
	}
	return true;
}
let underlyingOverlays: Array<{ element: HTMLElement; inert: boolean }> = [];
function keydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		requestClose();
	}
	if (event.key !== "Tab") return;
	const controls = Array.from(
		panel.value?.querySelectorAll<HTMLElement>(
			'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
		) || [],
	).filter(isTabbable);
	const first = controls[0];
	const last = controls.at(-1);
	if (!first) {
		event.preventDefault();
		panel.value?.focus({ preventScroll: true });
		return;
	}
	if (
		event.shiftKey &&
		(document.activeElement === first || document.activeElement === panel.value)
	) {
		event.preventDefault();
		last?.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}
onMounted(async () => {
	openingLocation = window.location.href;
	document.dispatchEvent(
		new CustomEvent("preview-filter-panel-open", { detail: props.transientOwner || titleId }),
	);
	window.addEventListener("hashchange", closeAfterNavigation);
	window.addEventListener("popstate", closeAfterNavigation);
	document.addEventListener("inventory-navigation", closeAfterNavigation);
	invoker = document.activeElement as HTMLElement;
	previousOverflow = document.body.style.overflow;
	document.body.style.overflow = "hidden";
	app =
		document.querySelector<HTMLElement>("[data-inventory-app]") ||
		document.getElementById("design-preview");
	previousInert = app?.inert || false;
	if (app) app.inert = true;
	underlyingOverlays = Array.from(document.querySelectorAll<HTMLElement>(".preview-overlay"))
		.filter((element) => !element.contains(panel.value || null))
		.map((element) => ({ element, inert: Boolean(element.inert) }));
	underlyingOverlays.forEach(({ element }) => {
		element.inert = true;
	});
	await nextTick();
	panel.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
	window.removeEventListener("hashchange", closeAfterNavigation);
	window.removeEventListener("popstate", closeAfterNavigation);
	document.removeEventListener("inventory-navigation", closeAfterNavigation);
	document.body.style.overflow = previousOverflow;
	if (app) app.inert = previousInert;
	underlyingOverlays.forEach(({ element, inert }) => {
		element.inert = inert;
	});
	if (invoker?.isConnected) invoker.focus({ preventScroll: true });
});
</script>
<template>
	<Teleport to="body">
		<div class="preview-overlay" @click.self="requestClose" @keydown="keydown">
			<section
				ref="panel"
				class="preview-dialog"
				:style="panelStyle"
				:class="{
					'preview-drawer': drawer && !adaptiveCreation,
					'preview-adaptive-creation': adaptiveCreation,
					'preview-filter-sheet': filterSheet,
				}"
				role="dialog"
				aria-modal="true"
				:aria-labelledby="titleId"
				tabindex="-1"
			>
				<header class="dialog-heading">
					<div>
						<h2 :id="titleId">{{ title }}</h2>
						<p v-if="subtitle">{{ subtitle }}</p>
					</div>
					<UiButton
						v-if="dismissible"
						variant="ghost"
						aria-label="关闭对话框"
						@click="requestClose"
						>关闭 ×</UiButton
					>
				</header>
				<div class="dialog-content"><slot /></div>
				<footer v-if="$slots.footer" class="dialog-footer"><slot name="footer" /></footer>
			</section>
		</div>
	</Teleport>
</template>
