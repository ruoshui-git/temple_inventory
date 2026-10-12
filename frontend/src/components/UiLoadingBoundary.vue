<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
defineOptions({ inheritAttrs: false });

type Mode = "initial" | "refresh";
const props = withDefaults(
	defineProps<{
		busy: boolean;
		mode?: Mode;
		message?: string;
		region?: HTMLElement | null;
		scrollElement?: HTMLElement | null;
		dimRegion?: boolean;
		blockInteractions?: boolean;
	}>(),
	{
		mode: "refresh",
		region: null,
		scrollElement: null,
		dimRegion: false,
		blockInteractions: true,
	},
);
const root = ref<HTMLElement>();
const indicator = ref<HTMLElement>();
let dimmedRegion: HTMLElement | null = null;
const displayMessage = computed(
	() => props.message || (props.mode === "initial" ? "正在加载…" : "正在更新…"),
);
const position = ref({ left: 0, top: 0, visible: false, availableWidth: 0 });
const style = computed(() => ({
	left: `${position.value.left}px`,
	top: `${position.value.top}px`,
	maxWidth: `${Math.max(0, position.value.availableWidth - 20)}px`,
}));
const portalTarget = computed(() => {
	const region = props.region || root.value;
	return region?.closest<HTMLElement>('[role="dialog"], dialog') || document.body;
});
let frame = 0;
let resizeObserver: ResizeObserver | undefined;
let observed: Element[] = [];
const scrollParents = new Set<EventTarget>();
let mounted = false;

function schedule() {
	if (!mounted || !props.busy || frame) return;
	frame = requestAnimationFrame(() => {
		frame = 0;
		if (!mounted || !props.busy) return;
		updatePosition();
	});
}
function updatePosition() {
	const region = props.region || root.value;
	if (!region?.isConnected) {
		position.value.visible = false;
		return;
	}
	const rect = region.getBoundingClientRect();
	let left = Math.max(0, rect.left);
	let top = Math.max(0, rect.top);
	let right = Math.min(document.documentElement.clientWidth, rect.right);
	let bottom = Math.min(document.documentElement.clientHeight, rect.bottom);
	const viewport = window.visualViewport;
	if (viewport && viewport.width > 0 && viewport.height > 0) {
		left = Math.max(left, viewport.offsetLeft);
		top = Math.max(top, viewport.offsetTop);
		right = Math.min(right, viewport.offsetLeft + viewport.width);
		bottom = Math.min(bottom, viewport.offsetTop + viewport.height);
	}
	if (props.scrollElement && props.scrollElement !== region) {
		const scrollRect = props.scrollElement.getBoundingClientRect();
		left = Math.max(left, scrollRect.left);
		top = Math.max(top, scrollRect.top);
		right = Math.min(right, scrollRect.right);
		bottom = Math.min(bottom, scrollRect.bottom);
	}
	let node: HTMLElement | null = region.parentElement;
	while (node) {
		const style = getComputedStyle(node);
		const nodeRect = node.getBoundingClientRect();
		if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
			if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
				left = Math.max(left, nodeRect.left);
				right = Math.min(right, nodeRect.right);
			}
			if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
				top = Math.max(top, nodeRect.top);
				bottom = Math.min(bottom, nodeRect.bottom);
			}
		}
		node = node.parentElement;
	}
	const indicatorWidth = indicator.value?.offsetWidth || 0;
	const indicatorHeight = indicator.value?.offsetHeight || 0;
	const visible =
		right > left &&
		bottom > top &&
		right - left >= indicatorWidth &&
		bottom - top >= indicatorHeight;
	const availableWidth = Math.max(0, right - left);
	const widthChanged = position.value.availableWidth !== availableWidth;
	position.value = {
		left: Math.max(
			left + indicatorWidth / 2,
			Math.min((left + right) / 2, right - indicatorWidth / 2),
		),
		top: Math.max(
			top + indicatorHeight / 2,
			Math.min((top + bottom) / 2, bottom - indicatorHeight / 2),
		),
		visible,
		availableWidth,
	};
	if (indicator.value && widthChanged) void nextTick(schedule);
}
function cleanup() {
	dimmedRegion?.classList.remove("ui-loading-boundary__dim-region");
	dimmedRegion = null;
	window.removeEventListener("scroll", schedule, true);
	window.removeEventListener("resize", schedule);
	window.visualViewport?.removeEventListener("scroll", schedule);
	window.visualViewport?.removeEventListener("resize", schedule);
	for (const target of scrollParents) target.removeEventListener("scroll", schedule);
	scrollParents.clear();
	resizeObserver?.disconnect();
	resizeObserver = undefined;
	observed = [];
	if (frame) cancelAnimationFrame(frame);
	frame = 0;
}
function observe() {
	cleanup();
	if (!props.busy || typeof window === "undefined") return;
	const region = props.region || root.value;
	if (!region) return;
	if (props.dimRegion) {
		region.classList.add("ui-loading-boundary__dim-region");
		dimmedRegion = region;
	}
	window.addEventListener("scroll", schedule, { passive: true, capture: true });
	window.addEventListener("resize", schedule, { passive: true });
	window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
	window.visualViewport?.addEventListener("resize", schedule, { passive: true });
	let node: HTMLElement | null = region as HTMLElement;
	while (node) {
		const style = getComputedStyle(node);
		if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
			scrollParents.add(node);
			observed.push(node);
		}
		node = node.parentElement;
	}
	observed.push(region);
	if (props.scrollElement) {
		scrollParents.add(props.scrollElement);
		observed.push(props.scrollElement);
	}
	if (typeof ResizeObserver !== "undefined") {
		resizeObserver = new ResizeObserver(schedule);
		observed.forEach((element) => resizeObserver?.observe(element));
		if (indicator.value) resizeObserver.observe(indicator.value);
	}
	schedule();
}
onMounted(() => {
	mounted = true;
	observe();
});
watch(() => [props.busy, props.region, props.scrollElement, props.dimRegion], observe);
watch(() => [props.mode, props.message], schedule);
onBeforeUnmount(() => {
	mounted = false;
	cleanup();
});
</script>

<template>
	<div
		ref="root"
		v-bind="$attrs"
		class="ui-loading-boundary"
		:class="{ 'ui-loading-boundary--busy': busy && mode === 'refresh' }"
		:aria-busy="busy || undefined"
		:inert="busy && blockInteractions ? true : undefined"
	>
		<div class="ui-loading-boundary__content"><slot /></div>
	</div>
	<Teleport :to="portalTarget">
		<div
			ref="indicator"
			v-if="busy"
			class="ui-loading-boundary__indicator"
			:class="{
				'ui-loading-boundary__indicator--hidden': !position.visible,
				'ui-loading-boundary__indicator--initial': mode === 'initial',
			}"
			:style="style"
			aria-hidden="true"
		>
			<span class="loading-spinner ui-loading-boundary__spinner" aria-hidden="true"></span
			>{{ displayMessage }}
		</div>
		<span
			v-if="busy"
			class="ui-loading-boundary__announcement"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			>{{ displayMessage }}</span
		>
	</Teleport>
</template>

<style>
.ui-loading-boundary {
	min-width: 0;
}
.ui-loading-boundary__dim-region {
	opacity: 0.55;
	transition: opacity 160ms ease;
}
.ui-loading-boundary--busy > .ui-loading-boundary__content {
	opacity: 0.55;
	transition: opacity 160ms ease;
}
.ui-loading-boundary__indicator {
	position: fixed;
	z-index: calc(var(--ti-layer-context) + 1);
	display: flex;
	align-items: center;
	gap: var(--ti-space-2);
	max-width: min(90vw, 420px);
	padding: var(--ti-space-2) var(--ti-space-4);
	border: 1px solid var(--ti-border-strong);
	border-radius: var(--ti-radius-card);
	background: var(--ti-info-bg);
	box-shadow: var(--ti-shadow-overlay);
	color: var(--ti-info);
	font-size: var(--ti-font-body);
	font-weight: 650;
	transform: translate(-50%, -50%);
	pointer-events: none;
}
.ui-loading-boundary__indicator--hidden {
	visibility: hidden;
}
.ui-loading-boundary__announcement {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
.ui-loading-boundary__indicator--initial {
	border-radius: var(--ti-radius-control);
}
@media (prefers-reduced-motion: reduce) {
	.ui-loading-boundary--busy > .ui-loading-boundary__content {
		transition: none;
	}
	.ui-loading-boundary__dim-region {
		transition: none;
	}
	.ui-loading-boundary__spinner {
		animation: none;
	}
}
</style>
