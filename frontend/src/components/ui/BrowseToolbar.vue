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
import { useScrollSurface } from "../../composables/scrollSurface";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import PageHeader from "./PageHeader.vue";
import UiButton from "./UiButton.vue";
import FilterPanel from "./FilterPanel.vue";
import { browseHierarchyEditKey, filterPanelSessionKey } from "../../lib/filterPanelSession";
import { createDebouncedSearch } from "../../lib/debouncedSearch";
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
		embedded?: boolean;
	}>(),
	{
		active: true,
		sidebarOpen: false,
		sidebarAvailable: false,
		search: "",
		searchLabel: "搜索",
		embedded: false,
	},
);
const emit = defineEmits<{
	scan: [];
	sidebar: [];
	"update:search": [value: string];
}>();
const root = ref<HTMLElement>();
const heading = computed(() => props.title || props.summary.split(" · ")[0]);
const { isMobile } = useResponsiveLayout();
const searchInput = ref(props.search);
function focusSearchShortcut(event: KeyboardEvent) {
	if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
	const target = event.target;
	if (
		target instanceof HTMLElement &&
		(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
	) return;
	event.preventDefault();
	root.value?.querySelector<HTMLInputElement>("[data-browse-search]")?.focus({ preventScroll: true });
}
const debouncer = createDebouncedSearch((value) => {
	if (value !== props.search) emit("update:search", value);
});
function inputSearch(event: Event) {
	searchInput.value = (event.target as HTMLInputElement).value;
	debouncer.input(event);
}
function finishComposition(event: CompositionEvent) {
	searchInput.value = (event.target as HTMLInputElement).value;
	debouncer.compositionEnd(event);
}
watch(
	() => props.search,
	(value) => {
		searchInput.value = value;
		debouncer.cancel();
	},
);
onDeactivated(() => {
	debouncer.cancel();
});
onBeforeUnmount(() => {
	debouncer.cancel();
});
const controlsId = useId();
const filterSessionId = useId();
provide(filterPanelSessionKey, filterSessionId);
const filterPanel = ref<{ show: (field?: string) => Promise<void>; hide: () => void }>();
function openFilters(field?: string) {
	void filterPanel.value?.show(field);
}
async function editFilter(field?: string) {
	if (field === "search") {
		const input = root.value?.querySelector<HTMLInputElement>("[data-browse-search]");
		input?.focus({ preventScroll: true });
		input?.scrollIntoView({ block: "nearest" });
		return;
	}
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
const { top } = useScrollSurface(root, () => props.active);
let headerObserver: ResizeObserver | undefined;
let measuredParent: HTMLElement | undefined;
function measureHeader() {
	const element = root.value;
	const parent = element?.parentElement;
	if (!element || !parent) return;
	element.classList.toggle("is-stuck", top.value > 0);
	measuredParent = parent;
	parent.style.setProperty(
		"--browse-toolbar-height",
		`${element.getBoundingClientRect().height}px`,
	);
}
onMounted(() => {
	measureHeader();
	document.addEventListener("keydown", focusSearchShortcut);
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
	document.removeEventListener("keydown", focusSearchShortcut);
	headerObserver?.disconnect();
	if (measuredParent?.style.getPropertyValue("--browse-toolbar-height"))
		measuredParent.style.removeProperty("--browse-toolbar-height");
});
watch(top, (value) => root.value?.classList.toggle("is-stuck", value > 0));
defineExpose({ editFilter });
</script>
<template>
	<div
		ref="root"
		class="preview-browse-controls refined-toolbar browse-chrome"
		:class="{ 'is-embedded': embedded }"
	>
		<PageHeader v-if="!embedded" :title="heading">
			<template #title-tools><slot name="persistent" /></template>
			<template #subtitle><slot name="subtitle" /></template>
		</PageHeader>
		<div class="browse-persistent-bar" :aria-label="`${heading}搜索与筛选`">
			<div class="browse-search-container" :class="{ 'has-chips': $slots.chips }">
				<div v-if="$slots.chips" class="browse-persistent-chips" aria-label="已应用筛选">
					<slot name="chips" :open-filters="openFilters" :edit-filter="editFilter" />
				</div>
				<label class="browse-persistent-search">
					<span class="sr-only">{{ searchLabel }}</span>
					<input
						data-browse-search
						:value="searchInput"
						type="search"
						:aria-label="searchLabel"
						:placeholder="searchLabel"
						@input="inputSearch"
						@compositionstart="debouncer.compositionStart"
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
				icon="filter"
				icon-only
				title="显示/隐藏筛选侧栏"
				label="显示/隐藏筛选侧栏"
				:aria-label="sidebarOpen ? '关闭筛选侧栏' : '打开筛选侧栏'"
				:aria-expanded="sidebarOpen"
				@click="emit('sidebar')"
				/>
			<span v-if="sidebarSaveError" class="browse-preference-error" role="status">
				{{ sidebarSaveError }}
				<UiButton variant="ghost" @click="retrySidebarSave?.()">重试同步</UiButton>
			</span>
			<div v-if="$slots.actions" class="browse-header-actions"><slot name="actions" /></div>
		</div>
		<div :id="controlsId" class="browse-inline-tools">
			<slot />
			<div v-if="$slots['result-tools']" class="browse-result-toolbar">
				<slot name="result-tools" />
			</div>
		</div>
		<slot name="selection" />
	</div>
</template>
