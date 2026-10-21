<script setup lang="ts">
import { overlayStageKey } from "../../lib/overlayStage";
import {
	inject,
	provide,
	nextTick,
	onBeforeUnmount,
	onMounted,
	ref,
	useId,
	type CSSProperties,
} from "vue";
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
		initialFocus?: string;
		panelStyle?: CSSProperties;
		panelClass?: string | string[] | Record<string, boolean>;
		contentClass?: string | string[] | Record<string, boolean>;
	}>(),
	{
		drawer: false,
		dismissible: true,
	},
);
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
const titleId = useId();
const parentStage = inject(overlayStageKey, undefined);
const stageHost = ref<HTMLElement>();
const activeStage = ref<{ titleId: string; close(): void }>();
if (!parentStage) provide(overlayStageKey, { host: stageHost, active: activeStage });
function requestClose() {
	if (activeStage.value) activeStage.value.close();
	else if (props.dismissible) emit("close");
}
let invoker: HTMLElement | null = null;
let openingLocation = "";
function closeAfterNavigation() {
	if (window.location.href !== openingLocation) emit("close");
}
function focusInitial() {
	const target = props.initialFocus
		? panel.value?.querySelector<HTMLElement>(props.initialFocus)
		: undefined;
	if (target && !target.matches(":disabled")) target.focus({ preventScroll: true });
	else panel.value?.focus({ preventScroll: true });
}
let previousOverflow = "";
let previousPadding = "";
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
function documentKeydown(event: KeyboardEvent) {
	if (!event.defaultPrevented && !panel.value?.closest("[inert]")) keydown(event);
}
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
	if (first && !panel.value?.contains(document.activeElement)) {
		event.preventDefault();
		(event.shiftKey ? last : first)?.focus();
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
	invoker = document.activeElement as HTMLElement;
	if (parentStage) {
		parentStage.active.value = { titleId, close: requestClose };
		await nextTick();
		focusInitial();
		return;
	}
	openingLocation = window.location.href;
	document.dispatchEvent(
		new CustomEvent("preview-filter-panel-open", { detail: props.transientOwner || titleId }),
	);
	document.addEventListener("keydown", documentKeydown);
	window.addEventListener("hashchange", closeAfterNavigation);
	window.addEventListener("popstate", closeAfterNavigation);
	document.addEventListener("inventory-navigation", closeAfterNavigation);
	previousOverflow = document.body.style.overflow;
	previousPadding = document.body.style.paddingRight;
	const scrollbar = window.innerWidth - document.documentElement.clientWidth;
	if (scrollbar > 0)
		document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbar}px`;
	document.body.style.overflow = "hidden";
	app = document.querySelector<HTMLElement>("[data-inventory-app]");
	previousInert = app?.inert || false;
	if (app) app.inert = true;
	underlyingOverlays = Array.from(document.querySelectorAll<HTMLElement>(".preview-overlay"))
		.filter((element) => !element.contains(panel.value || null))
		.map((element) => ({ element, inert: Boolean(element.inert) }));
	underlyingOverlays.forEach(({ element }) => {
		element.inert = true;
	});
	await nextTick();
	focusInitial();
});
onBeforeUnmount(() => {
	if (parentStage) {
		if (parentStage.active.value?.titleId === titleId) parentStage.active.value = undefined;
		void nextTick(() => {
			if (invoker?.isConnected) invoker.focus({ preventScroll: true });
		});
		return;
	}
	document.removeEventListener("keydown", documentKeydown);
	window.removeEventListener("hashchange", closeAfterNavigation);
	window.removeEventListener("popstate", closeAfterNavigation);
	document.removeEventListener("inventory-navigation", closeAfterNavigation);
	document.body.style.overflow = previousOverflow;
	document.body.style.paddingRight = previousPadding;
	if (app) app.inert = previousInert;
	underlyingOverlays.forEach(({ element, inert }) => {
		element.inert = inert;
	});
	void nextTick(() => {
		if (invoker?.isConnected) invoker.focus({ preventScroll: true });
	});
});
</script>
<template>
	<Teleport
		v-if="!parentStage || parentStage.host.value"
		:to="parentStage?.host.value || 'body'"
	>
		<div
			:class="parentStage ? 'overlay-stage' : 'preview-overlay'"
			@click.self="requestClose"
			@keydown="keydown"
		>
			<section
				ref="panel"
				:style="panelStyle"
				:class="[
					parentStage ? 'overlay-stage-panel' : 'preview-dialog',
					panelClass,
					{
						'preview-drawer': drawer && !adaptiveCreation,
						'preview-adaptive-creation': adaptiveCreation,
						'preview-filter-sheet': filterSheet,
					},
				]"
				:role="parentStage ? 'region' : 'dialog'"
				:aria-modal="parentStage ? undefined : true"
				:aria-labelledby="activeStage?.titleId || titleId"
				tabindex="-1"
			>
				<header v-show="!activeStage" class="dialog-heading">
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
				<div v-show="!activeStage" class="dialog-content" :class="contentClass">
					<slot />
				</div>
				<div
					v-if="!parentStage"
					v-show="activeStage"
					ref="stageHost"
					class="dialog-content"
				/>
				<footer v-if="$slots.footer" v-show="!activeStage" class="dialog-footer">
					<slot name="footer" />
				</footer>
			</section>
		</div>
	</Teleport>
</template>
