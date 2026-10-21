<script setup lang="ts">
import {
	computed,
	nextTick,
	ref,
	useId,
	provide,
	watch,
	onActivated,
	onDeactivated,
	onMounted,
	onBeforeUnmount,
} from "vue";
import { scrollBy, useScrollSurface } from "../../composables/scrollSurface";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import PageHeader from "./PageHeader.vue";
import UiButton from "./UiButton.vue";
import FilterPanel from "./FilterPanel.vue";
import { browseHierarchyEditKey, filterPanelSessionKey } from "../../lib/filterPanelSession";
const props = withDefaults(
	defineProps<{
		title?: string;
		summary: string;
		filterCount?: number;
		sidebarOpen?: boolean;
		sidebarAvailable?: boolean;
		sidebarSaveError?: string;
		retrySidebarSave?: () => void;
		active?: boolean;
		scannable?: boolean;
		search?: string;
		searchLabel?: string;
	}>(),
	{ active: true, sidebarOpen: false, sidebarAvailable: false, search: "", searchLabel: "搜索" },
);
const emit = defineEmits<{
	scan: [];
	sidebar: [];
	"update:search": [value: string];
	"update:compact": [value: boolean];
}>();
const root = ref<HTMLElement>();
const automatic = ref(false),
	choice = ref<boolean>();
const compact = computed(() => choice.value ?? automatic.value);
const heading = computed(() => props.title || props.summary.split(" · ")[0]);
const { isMobile } = useResponsiveLayout();
const searchInput = ref(props.search);
const composing = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSearch(value: string) {
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		if (value !== props.search) emit("update:search", value);
	}, 220);
}
function inputSearch(event: Event) {
	searchInput.value = (event.target as HTMLInputElement).value;
	if (!composing.value) scheduleSearch(searchInput.value);
}
function beginComposition() {
	composing.value = true;
	if (searchTimer) clearTimeout(searchTimer);
	searchTimer = undefined;
}
function finishComposition(event: CompositionEvent) {
	composing.value = false;
	searchInput.value = (event.target as HTMLInputElement).value;
	scheduleSearch(searchInput.value);
}
watch(
	() => props.search,
	(value) => {
		searchInput.value = value;
		if (searchTimer) clearTimeout(searchTimer);
	},
);
onDeactivated(() => {
	if (searchTimer) clearTimeout(searchTimer);
});
onBeforeUnmount(() => {
	if (searchTimer) clearTimeout(searchTimer);
});
const controlsId = useId();
const filterSessionId = useId();
provide(filterPanelSessionKey, filterSessionId);
const filterPanel = ref<{ show: (field?: string) => Promise<void>; hide: () => void }>();
function openFilters(field?: string) {
	void filterPanel.value?.show(field);
}
async function editFilter(field?: string) {
	if (
		field &&
		["categories", "warehouses"].includes(field) &&
		props.sidebarAvailable &&
		props.sidebarOpen &&
		!isMobile.value
	) {
		filterPanel.value?.hide();
		await nextTick();
		const tree = root.value?.parentElement?.querySelector<HTMLElement>(
			`.browse-filter-rail [data-filter-field="${field}"]`,
		);
		const control = tree?.querySelector<HTMLElement>(
			'input:not([type="hidden"]),select,button,[tabindex="0"]',
		);
		(control || tree)?.focus({ preventScroll: true });
		(tree || control)?.scrollIntoView({ block: "nearest" });
		return;
	}
	openFilters(field);
}
provide(browseHierarchyEditKey, (field) => void editFilter(field));
function filterPanelChanged(open: boolean) {
	if (!open)
		document.dispatchEvent(
			new CustomEvent("preview-filter-panel-close", { detail: filterSessionId }),
		);
}
const { top, owner } = useScrollSurface(root, () => props.active);
let headerObserver: ResizeObserver | undefined;
let measuredParent: HTMLElement | undefined;
function measureHeader() {
	const element = root.value;
	const parent = element?.parentElement;
	if (!element || !parent) return;
	measuredParent = parent;
	parent.style.setProperty(
		"--browse-toolbar-height",
		`${element.getBoundingClientRect().height}px`,
	);
}
onMounted(() => {
	measureHeader();
	if (typeof ResizeObserver !== "undefined" && root.value) {
		headerObserver = new ResizeObserver(measureHeader);
		headerObserver.observe(root.value);
	}
});
onActivated(() => {
	void nextTick(() => {
		measureHeader();
		if (root.value) headerObserver?.observe(root.value);
	});
});
onDeactivated(() => headerObserver?.disconnect());
onBeforeUnmount(() => {
	headerObserver?.disconnect();
	if (measuredParent?.style.getPropertyValue("--browse-toolbar-height"))
		measuredParent.style.removeProperty("--browse-toolbar-height");
});
watch(top, (value) => {
	if (value > 160) automatic.value = true;
});
let transition = 0;
watch(compact, async (value) => {
	const generation = ++transition;
	const header = root.value;
	const focused = document.activeElement;
	const hiddenFocus =
		(value &&
			!!focused &&
			!!header?.contains(focused) &&
			!!header.querySelector(".expanded-browse-tools")?.contains(focused)) ||
		(value &&
			!!focused &&
			!!header?.querySelector(".browse-header-actions")?.contains(focused)) ||
		(value && !!focused && !!header?.querySelector(".app-page-subtitle")?.contains(focused));
	const bottom = header?.getBoundingClientRect().bottom || 0;
	const candidates = Array.from(
		header?.parentElement?.querySelectorAll<HTMLElement>("[data-browse-row]") || [],
	).filter(
		(row) => !header?.contains(row) && row.getBoundingClientRect().top < window.innerHeight,
	);
	const anchor =
		top.value > 0
			? candidates.find((row) => row.getBoundingClientRect().top >= bottom) ||
				candidates.find((row) => row.getBoundingClientRect().bottom > bottom)
			: undefined;
	const offset = anchor ? anchor.getBoundingClientRect().top - bottom : 0;
	emit("update:compact", value);
	await nextTick();
	if (generation !== transition || !header?.isConnected) return;
	if (anchor?.isConnected && owner.value) {
		const headerBottom = header.getBoundingClientRect().bottom;
		const navTop =
			document.querySelector(".sample-mobile-nav")?.getBoundingClientRect().top ??
			window.innerHeight;
		const viewportBottom = Math.min(window.innerHeight, navTop);
		const visibleOffset = Math.min(
			Math.max(0, offset),
			Math.max(0, viewportBottom - headerBottom - 44),
		);
		const delta = anchor.getBoundingClientRect().top - headerBottom - visibleOffset;
		if (Math.abs(delta) > 1) scrollBy(owner.value, delta);
	}
	if (hiddenFocus)
		header.querySelector<HTMLElement>(".browse-tools-toggle")?.focus({ preventScroll: true });
});
defineExpose({ compact, editFilter });
</script>
<template>
	<div
		ref="root"
		class="preview-browse-controls refined-toolbar browse-chrome"
		:class="{ 'is-compact': compact }"
	>
		<PageHeader :title="heading" :compact="compact">
			<template #title-tools><slot name="persistent" /></template>
			<template #subtitle><slot v-if="!compact" name="subtitle" /></template>
			<template #actions>
				<div v-if="!compact" class="browse-header-actions"><slot name="actions" /></div>
			</template>
		</PageHeader>
		<div class="browse-persistent-bar" :aria-label="`${heading}搜索与筛选`">
			<div class="browse-search-container" :class="{ 'has-chips': $slots.chips }">
				<div v-if="$slots.chips" class="browse-persistent-chips" aria-label="已应用筛选">
					<slot name="chips" :open-filters="openFilters" :edit-filter="editFilter" />
				</div>
				<label class="browse-persistent-search">
					<span class="sr-only">{{ searchLabel }}</span>
					<input
						:value="searchInput"
						type="search"
						:aria-label="searchLabel"
						:placeholder="searchLabel"
						@input="inputSearch"
						@compositionstart="beginComposition"
						@compositionend="finishComposition"
					/>
				</label>
				<div class="browse-search-actions">
					<UiButton
						v-if="scannable"
						icon="scan"
						icon-only
						label="扫码"
						variant="ghost"
						@click="emit('scan')"
					/>
					<FilterPanel
						ref="filterPanel"
						label="筛选"
						icon-only
						:count="filterCount || 0"
						:context="heading"
						:active="active"
						@update:open="filterPanelChanged"
					>
						<slot name="filters" />
					</FilterPanel>
				</div>
			</div>
			<UiButton
				v-if="sidebarAvailable && !isMobile"
				class="browse-sidebar-toggle"
				variant="ghost"
				:aria-label="sidebarOpen ? '关闭筛选侧栏' : '打开筛选侧栏'"
				:aria-expanded="sidebarOpen"
				@click="emit('sidebar')"
				>侧栏</UiButton
			>
			<span v-if="sidebarSaveError" class="browse-preference-error" role="status">
				{{ sidebarSaveError }}
				<UiButton variant="ghost" @click="retrySidebarSave?.()">重试同步</UiButton>
			</span>
			<UiButton
				class="browse-tools-toggle"
				variant="ghost"
				icon="chevron-down"
				:aria-expanded="!compact"
				:aria-controls="controlsId"
				@click="choice = !compact"
			>
				{{ compact ? "展开工具" : "收起工具" }}
			</UiButton>
		</div>
		<div v-show="!compact" :id="controlsId" class="expanded-browse-tools">
			<slot />
			<div v-if="$slots['result-tools']" class="browse-result-toolbar">
				<slot name="result-tools" />
			</div>
		</div>
		<slot name="selection" />
	</div>
</template>
