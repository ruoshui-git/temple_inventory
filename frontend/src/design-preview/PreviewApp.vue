<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { emptyScope } from "./browseModel";
import InventoryIcon from "../components/InventoryIcon.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import PreviewGallery from "./PreviewGallery.vue";
import PreviewInventory from "./PreviewInventory.vue";
import PreviewReceive from "./PreviewReceive.vue";
import PreviewBrowsePages from "./PreviewBrowsePages.vue";
import PreviewFormPages from "./PreviewFormPages.vue";
import PreviewUtilityPages from "./PreviewUtilityPages.vue";
import {
	primaryNavigation,
	inventoryNavigation,
	destinationFor,
	inventorySectionFor,
} from "./navigation";
import {
	getPreviewPage,
	pageFromHash,
	pageHash,
	previewPages,
	reviewSession,
	type PreviewPageKey,
} from "./reviewModel";
import {
	defaults,
	readPreferences,
	themes,
	writePreferences,
	type PreviewPreferences,
} from "./model";
let storage: Storage | undefined;
try {
	storage = window.localStorage;
} catch {
	/* Continue with in-memory preferences. */
}
const preferences = reactive<PreviewPreferences>(readPreferences(storage));
const theme = computed(() => themes.find((theme) => theme.id === preferences.theme)!);
const { isMobile } = useResponsiveLayout();
const mobileNavigation = ref<HTMLElement>();
let navigationObserver: ResizeObserver | undefined;
function measureNavigation() {
	document.documentElement.style.setProperty(
		"--preview-nav-height",
		`${mobileNavigation.value?.getBoundingClientRect().height || 0}px`,
	);
}
watch(
	mobileNavigation,
	() => {
		navigationObserver?.disconnect();
		if (typeof ResizeObserver !== "undefined" && mobileNavigation.value) {
			navigationObserver = new ResizeObserver(measureNavigation);
			navigationObserver.observe(mobileNavigation.value);
		}
		measureNavigation();
	},
	{ flush: "post" },
);
const page = ref("gallery");
const routeKey = ref<PreviewPageKey>("dashboard/overview");
const activeRoute = computed(() => getPreviewPage(routeKey.value)!);
const formContexts = reactive<Partial<Record<PreviewPageKey, { loanName?: string }>>>({});
const section = computed(() =>
	page.value === "inventory"
		? "inventory"
		: page.value === "route"
			? destinationFor(activeRoute.value, formContexts[routeKey.value])
			: undefined,
);
const inventoryExpanded = ref(true);
const inventorySection = computed(() =>
	page.value === "inventory" ? "stock" : inventorySectionFor(activeRoute.value.page),
);
const showInventoryNavigation = computed(
	() =>
		page.value === "inventory" ||
		(page.value === "route" &&
			["inventory", "expiry", "warehouses", "pending"].includes(activeRoute.value.page)),
);
const ownerLabel = computed(
	() => primaryNavigation.find((group) => group.key === section.value)?.label,
);
const toast = ref("");
const settingsOpen = ref(true);
const indexOpen = ref(false);
const indexSearch = ref("");
const indexedPages = computed(() =>
	previewPages.filter((entry) =>
		`${entry.label} ${entry.path}`.toLowerCase().includes(indexSearch.value.toLowerCase()),
	),
);
type ReturnKey = PreviewPageKey | `local/${"gallery" | "inventory" | "receive"}`;
const returnRoutes = reactive<Partial<Record<PreviewPageKey, ReturnKey>>>({});
const scrollPositions = new Map<
	ReturnKey,
	{
		windowTop: number;
		windowLeft: number;
		top: number;
		left: number;
		results: { top: number; left: number }[];
	}
>();
const visibleKey = computed<ReturnKey>(() =>
	page.value === "route"
		? routeKey.value
		: `local/${page.value as "gallery" | "inventory" | "receive"}`,
);
const scrollSelector =
	".results-region, .table-scroll, .preview-browse-results, .browse-table-wrap, .report-table-wrap";
function scrollSurfaces(main: HTMLElement) {
	return Array.from(main.querySelectorAll<HTMLElement>(scrollSelector)).filter((element) => {
		for (
			let node: HTMLElement | null = element;
			node && node !== main;
			node = node.parentElement
		)
			if (node.style.display === "none") return false;
		return true;
	});
}
let restorationFrame = 0;
let resetScroll = false;
function restoreScroll(key: ReturnKey) {
	const main = document.getElementById("sample-content");
	if (!main || visibleKey.value !== key) return;
	const saved = scrollPositions.get(key);
	main.scrollTop = saved?.top || 0;
	main.scrollLeft = saved?.left || 0;
	scrollSurfaces(main).forEach((element, index) => {
		element.scrollTop = saved?.results[index]?.top || 0;
		element.scrollLeft = saved?.results[index]?.left || 0;
	});
	if (window.scrollX !== (saved?.windowLeft || 0) || window.scrollY !== (saved?.windowTop || 0))
		window.scrollTo({
			top: saved?.windowTop || 0,
			left: saved?.windowLeft || 0,
			behavior: "instant",
		});
}
watch(
	visibleKey,
	async (key, previous, onCleanup) => {
		cancelAnimationFrame(restorationFrame);
		let cancelled = false;
		onCleanup(() => {
			cancelled = true;
			cancelAnimationFrame(restorationFrame);
		});
		const main = document.getElementById("sample-content");
		if (!main) return;
		scrollPositions.set(previous, {
			windowTop: window.scrollY,
			windowLeft: window.scrollX,
			top: main.scrollTop,
			left: main.scrollLeft,
			results: scrollSurfaces(main).map((element) => ({
				top: element.scrollTop,
				left: element.scrollLeft,
			})),
		});
		if (resetScroll) scrollPositions.delete(key);
		resetScroll = false;
		await nextTick();
		if (cancelled) return;
		restoreScroll(key);
		restorationFrame = requestAnimationFrame(() => restoreScroll(key));
	},
	{ flush: "pre" },
);
function resetDestinationScroll(key: ReturnKey) {
	scrollPositions.delete(key);
	resetScroll = visibleKey.value !== key;
	if (!resetScroll) nextTick(() => restoreScroll(key));
}
function isContextualRoute(route: typeof activeRoute.value) {
	return (
		route.page.endsWith("-form") ||
		route.page.endsWith("-detail") ||
		(route.page === "movement-records" &&
			["detail", "selected", "opening", "workspace-detail", "entry-detail"].includes(
				route.variant,
			))
	);
}
const backRoute = computed<ReturnKey | undefined>(() => {
	if (page.value !== "route") return undefined;
	const current = activeRoute.value;
	if (section.value === "more" && current.page !== "more") return "more/index";
	if (!isContextualRoute(current)) return undefined;
	if (returnRoutes[current.key]) return returnRoutes[current.key];
	if (current.page === "movement-records")
		return `movement-records/${reviewSession.filters.movementRecords.status}`;
	if (section.value === "reports") return "reports/overview";
	if (current.page === "warehouse-detail") return "warehouses/tree";
	if (section.value === "inventory") return "inventory/list";
	if (section.value === "loans") return "loan-items/outstanding";
	return "movement-items/list";
});
const backLabel = computed(() => (backRoute.value === "more/index" ? "返回工具" : "返回上一页"));
const groups = primaryNavigation;
function navigatePrimary(key: PreviewPageKey) {
	resetDestinationScroll(key);
	if (key.startsWith("movement")) {
		reviewSession.filters.movementScope = emptyScope();
		reviewSession.filters.movementItems.search = "";
	}
	if (key.startsWith("loan")) {
		reviewSession.filters.loanScope = emptyScope();
		reviewSession.filters.loanItems.search = "";
	}
	if (key.startsWith("inventory")) {
		reviewSession.filters.inventory.scope = emptyScope();
		reviewSession.filters.inventory.search = "";
	}
	navigate(key);
}
function navigateInventory(key: PreviewPageKey) {
	resetDestinationScroll(key);
	if (key.startsWith("inventory")) reviewSession.filters.inventory.scope = emptyScope();
	if (key.startsWith("expiry")) {
		reviewSession.filters.expiry.scope = emptyScope();
		reviewSession.filters.expiry.bucket = "";
		reviewSession.filters.expiry.inStock = false;
	}
	if (key.startsWith("pending")) reviewSession.filters.pending.scope = emptyScope();
	navigate(key);
}
function navigate(key: ReturnKey, rememberReturn = true) {
	if (key.startsWith("local/")) {
		selectLocalPage(key.slice(6) as "gallery" | "inventory" | "receive");
		return;
	}
	const route = getPreviewPage(key);
	if (route) selectRoute(route.page, route.variant, rememberReturn);
}
function selectRoute(routePage: string, variant: string, rememberReturn = true) {
	const route = previewPages.find(
		(candidate) => candidate.page === routePage && candidate.variant === variant,
	);
	if (!route) return;
	if (route.page === "movement-form" && rememberReturn) {
		const selected = reviewSession.drafts.find(
			(draft) => draft.name === reviewSession.selectedDraftName,
		);
		formContexts[route.key] = { loanName: selected?.loanName };
	}
	if (rememberReturn && isContextualRoute(route) && route.key !== routeKey.value) {
		const origin = page.value === "route" ? activeRoute.value : undefined;
		const sameDetail = origin && origin.page === route.page && isContextualRoute(origin);
		const itemSave = origin?.page === "item-form" && route.page === "item-detail";
		if (itemSave && origin && returnRoutes[origin.key] === route.key) {
			// Saving an item returns to its detail without replacing the browse origin.
		} else if ((sameDetail || itemSave) && origin && returnRoutes[origin.key])
			returnRoutes[route.key] = returnRoutes[origin.key];
		else if (!sameDetail) returnRoutes[route.key] = visibleKey.value;
	}
	routeKey.value = route.key;
	if (destinationFor(route) === "inventory") inventoryExpanded.value = true;
	page.value = "route";
	window.location.hash = pageHash(route.key);
}
function selectLocalPage(view: "gallery" | "inventory" | "receive") {
	page.value = view;
	if (view === "inventory") inventoryExpanded.value = true;
	window.location.hash = `#review/local/${view}`;
}
function syncLocationHash() {
	const localView = window.location.hash.match(
		/^#review\/local\/(gallery|inventory|receive)$/,
	)?.[1];
	if (localView) {
		page.value = localView;
		return;
	}
	const route = pageFromHash(window.location.hash);
	if (route) {
		routeKey.value = route.key;
		if (destinationFor(route) === "inventory") inventoryExpanded.value = true;
		page.value = "route";
	}
}
const routeArea = computed(() => {
	if (activeRoute.value.page === "inventory") return "inventory";
	if (["item-form", "movement-form", "reconciliation-form"].includes(activeRoute.value.page)) {
		return "form";
	}
	if (
		[
			"reports",
			"report-export",
			"more",
			"settings",
			"setup",
			"auth-complete",
			"recovery",
		].includes(activeRoute.value.page)
	) {
		return "utility";
	}
	return "browse";
});
const routeComponent = computed(() =>
	routeArea.value === "browse"
		? PreviewBrowsePages
		: routeArea.value === "form"
			? PreviewFormPages
			: PreviewUtilityPages,
);
const routeComponentProps = computed(() =>
	routeArea.value === "browse"
		? { route: routeKey.value }
		: { page: activeRoute.value.page, variant: activeRoute.value.variant },
);
function openInventory() {
	selectLocalPage("inventory");
}
function notify(message: string) {
	toast.value = message;
}
watch(preferences, () => writePreferences(storage, preferences), { deep: true });
watch(
	[theme, () => preferences.density, () => preferences.textScale],
	() => {
		const element = document.documentElement;
		element.dataset.previewTheme = preferences.theme;
		element.dataset.previewDensity = preferences.density;
		element.dataset.previewTextScale = String(preferences.textScale);
		element.style.setProperty("--p-text-scale", String(preferences.textScale / 100));
		window.dispatchEvent(new Event("preview-text-scale"));
		const value = theme.value;
		const tokens: Record<string, string> = {
			canvas: value.canvas,
			ink: value.ink,
			accent: value.accent,
			muted: value.muted,
			"control-border": value.border,
			soft: value.soft,
			"accent-strong": value.strong,
			"radius-control": value.radius,
			"radius-card": value.cardRadius,
		};
		Object.entries(tokens).forEach(([name, tokenValue]) =>
			element.style.setProperty(`--p-${name}`, tokenValue),
		);
	},
	{ immediate: true },
);
let previousScrollRestoration: ScrollRestoration;
onBeforeUnmount(() => {
	cancelAnimationFrame(restorationFrame);
	navigationObserver?.disconnect();
	document.documentElement.style.removeProperty("--preview-nav-height");
	window.history.scrollRestoration = previousScrollRestoration;
	window.removeEventListener("hashchange", syncLocationHash);
	delete document.documentElement.dataset.previewTheme;
	delete document.documentElement.dataset.previewDensity;
	delete document.documentElement.dataset.previewTextScale;
	document.documentElement.style.removeProperty("--p-text-scale");
	[
		"--p-canvas",
		"--p-ink",
		"--p-accent",
		"--p-muted",
		"--p-control-border",
		"--p-soft",
		"--p-accent-strong",
		"--p-radius-control",
		"--p-radius-card",
	].forEach((name) => document.documentElement.style.removeProperty(name));
});
onMounted(() => {
	previousScrollRestoration = window.history.scrollRestoration;
	window.history.scrollRestoration = "manual";
	window.addEventListener("hashchange", syncLocationHash);
	if (window.location.hash) syncLocationHash();
	else window.history.replaceState(null, "", "#review/local/gallery");
});
</script>
<template>
	<div class="preview-app">
		<header class="review-header">
			<a class="review-brand" href="#" @click.prevent="selectLocalPage('gallery')"
				><span class="brand-symbol"><InventoryIcon name="box" /></span
				><span>物资 <b>设计研究室</b></span></a
			>
			<div class="review-header-actions">
				<span class="review-status"><i />实验样本 · 不影响正式应用</span
				><button
					class="text-button"
					:aria-expanded="settingsOpen"
					@click="settingsOpen = !settingsOpen"
				>
					{{ settingsOpen ? "收起" : "展开" }}评审选项
					<InventoryIcon name="chevron-down" />
				</button>
			</div>
		</header>
		<section v-show="settingsOpen" class="review-controls" aria-label="设计评审选项">
			<div class="review-intro">
				<span class="eyebrow">DESIGN EXPLORATION · 01</span>
				<h2>选择一种感觉。<span class="muted">再打磨每一次使用。</span></h2>
				<p class="muted">先看风格，再看密度与流程。每一项都可以独立选择、独立修改。</p>
			</div>
			<div class="theme-options" aria-label="视觉方向实验选项">
				<button
					v-for="option in themes"
					:key="option.id"
					:data-theme-option="option.id"
					:aria-pressed="preferences.theme === option.id"
					class="theme-option"
					@click="preferences.theme = option.id"
				>
					<span
						class="theme-miniature"
						:style="{ background: option.canvas, '--mini-accent': option.accent }"
						><i /><span><b /><b /><b /></span></span
					><span
						><strong>{{ option.name }}</strong
						><small>{{ option.en }}</small></span
					><span class="theme-check">{{
						preferences.theme === option.id ? "✓" : "○"
					}}</span>
				</button>
			</div>
			<div class="review-settings">
				<label class="preview-field"
					>显示密度<select v-model="preferences.density" aria-label="显示密度">
						<option value="compact">紧凑 · 更多信息</option>
						<option value="balanced">均衡 · 默认</option>
						<option value="spacious">宽松 · 更大文字</option>
					</select></label
				><label class="preview-field"
					>文字大小<select v-model="preferences.textScale" aria-label="文字大小">
						<option
							v-for="scale in [100, 125, 150, 175, 200]"
							:key="scale"
							:value="scale"
						>
							{{ scale }}%
						</option>
					</select></label
				>
				<p>文字示例：核对物品、数量和库位后确认。</p>
				<button class="text-button" @click="preferences.textScale = 100">
					恢复默认文字大小</button
				><label class="preview-field"
					>入库表单<select v-model="preferences.form" aria-label="入库表单实验方案">
						<option value="current">对照 · 底部提交</option>
						<option value="proposed">实验提案 · 日期在前 + 侧栏汇总</option>
					</select></label
				><button class="text-button" @click="Object.assign(preferences, defaults)">
					恢复默认
				</button>
			</div>
		</section>
		<nav class="preview-page-tabs" aria-label="评审样本">
			<button
				:aria-current="page === 'gallery' ? 'page' : undefined"
				@click="selectLocalPage('gallery')"
			>
				<span>01</span>组件画廊</button
			><button
				:aria-current="page === 'inventory' ? 'page' : undefined"
				@click="selectLocalPage('inventory')"
			>
				<span>02</span>库存浏览</button
			><button
				:aria-current="page === 'receive' ? 'page' : undefined"
				@click="selectLocalPage('receive')"
			>
				<span>03</span>入库登记</button
			><span class="muted">真实组件 · 模拟数据 · 自适应布局</span>
		</nav>
		<section class="review-page-index" aria-label="完整页面与状态索引">
			<button class="text-button" :aria-expanded="indexOpen" @click="indexOpen = !indexOpen">
				{{ indexOpen ? "收起" : "展开" }}完整页面与状态 · {{ previewPages.length }} 个样本
			</button>
			<p class="muted">
				视觉基础已确认；以下页面布局与流程仍待评审。选择配色不代表接受流程。
			</p>
			<div v-if="indexOpen">
				<input
					v-model="indexSearch"
					type="search"
					aria-label="查找页面样本"
					placeholder="搜索页面名称或路径"
				/>
				<div class="review-index-links">
					<a
						v-for="entry in indexedPages"
						:key="entry.key"
						:href="pageHash(entry.key)"
						:aria-current="
							page === 'route' && routeKey === entry.key ? 'page' : undefined
						"
						@click.prevent="selectRoute(entry.page, entry.variant)"
						><strong>{{ entry.label }}</strong
						><small>{{ entry.group }} · {{ entry.path }}</small></a
					>
				</div>
			</div>
		</section>
		<div class="preview-workspace" :class="{ 'is-mobile': isMobile }">
			<aside v-if="!isMobile" class="sample-sidebar">
				<div class="sample-brand">
					<span class="brand-symbol"><InventoryIcon name="box" /></span>
					<div><strong>寺院物资</strong><small>每一份，都妥善安放</small></div>
				</div>
				<span class="sidebar-caption">导航提案 · 五个入口</span>
				<nav aria-label="示例应用主导航">
					<div v-for="group in groups" :key="group.key" class="nav-group">
						<button
							:class="{ active: section === group.key }"
							:aria-current="
								group.key !== 'inventory' && section === group.key
									? 'page'
									: undefined
							"
							:aria-expanded="
								group.key === 'inventory' ? inventoryExpanded : undefined
							"
							@click="
								group.key === 'inventory'
									? (inventoryExpanded = !inventoryExpanded)
									: navigatePrimary(group.route)
							"
						>
							<InventoryIcon class="nav-leading-icon" :name="group.icon" /><span
								class="nav-label"
								>{{ group.label }}</span
							>
							<InventoryIcon
								v-if="group.key === 'inventory'"
								class="nav-chevron"
								name="chevron-down"
							/>
						</button>
						<div
							v-if="group.key === 'inventory' && inventoryExpanded"
							class="nav-children"
						>
							<button
								v-for="child in inventoryNavigation"
								:key="child.key"
								:aria-current="
									section === 'inventory' && inventorySection === child.key
										? 'page'
										: undefined
								"
								@click="navigateInventory(child.route)"
							>
								{{ child.label }}
							</button>
						</div>
					</div>
				</nav>
				<button
					class="preview-tools-link"
					:aria-current="section === 'more' ? 'page' : undefined"
					@click="navigate('more/index')"
				>
					<InventoryIcon name="more" />工具
				</button>
				<div class="sidebar-bottom">
					<span class="avatar">义</span>
					<div><strong>义工工作台</strong><small>本地设计预览</small></div>
					<span class="status-dot" />
				</div>
			</aside>
			<main id="sample-content" class="sample-content">
				<div class="sample-breadcrumb">
					<button
						v-if="isMobile"
						class="preview-tools-link"
						:aria-current="section === 'more' ? 'page' : undefined"
						@click="navigate('more/index')"
					>
						工具
					</button>
					<span>寺院物资</span
					><template v-if="ownerLabel && ownerLabel !== activeRoute.label"
						><span>/</span><span>{{ ownerLabel }}</span></template
					><span>/</span
					><span>{{
						page === "gallery"
							? "组件画廊"
							: page === "receive"
								? "入库登记"
								: page === "inventory"
									? "库存浏览样本"
									: activeRoute.label
					}}</span
					><span class="sample-tag">交互样本</span>
				</div>
				<nav
					v-if="
						isMobile &&
						showInventoryNavigation &&
						!(page === 'inventory' || routeArea === 'inventory')
					"
					class="mobile-context"
					aria-label="库存页面"
				>
					<button
						v-for="child in inventoryNavigation"
						:key="child.key"
						:aria-current="inventorySection === child.key ? 'page' : undefined"
						@click="navigateInventory(child.route)"
					>
						{{ child.label }}
					</button>
				</nav>
				<button
					v-if="backRoute"
					class="text-button preview-back"
					@click="navigate(backRoute, false)"
				>
					← {{ backLabel }}
				</button>
				<PreviewGallery
					v-show="page === 'gallery'"
					:theme="preferences.theme"
					:active="page === 'gallery'"
					@notify="notify"
					@inventory="openInventory"
					@receive="selectLocalPage('receive')"
					@navigate="selectRoute"
				/>
				<PreviewInventory
					v-show="
						page === 'inventory' || (page === 'route' && routeArea === 'inventory')
					"
					:pattern="preferences.actions"
					:variant="page === 'route' ? activeRoute.variant : undefined"
					:active="
						page === 'inventory' || (page === 'route' && routeArea === 'inventory')
					"
					@notify="notify"
					@receive="selectLocalPage('receive')"
					@navigate="selectRoute"
				>
					<template #context>
						<nav
							v-if="
								isMobile &&
								(page === 'inventory' ||
									(page === 'route' && routeArea === 'inventory'))
							"
							class="mobile-context"
							aria-label="库存页面"
						>
							<button
								v-for="child in inventoryNavigation"
								:key="child.key"
								:aria-current="inventorySection === child.key ? 'page' : undefined"
								@click="navigateInventory(child.route)"
							>
								{{ child.label }}
							</button>
						</nav>
					</template>
				</PreviewInventory>
				<PreviewReceive
					v-show="page === 'receive'"
					:pattern="preferences.form"
					:active="page === 'receive'"
					@notify="notify"
					@back="openInventory"
				/>
				<KeepAlive>
					<component
						v-if="page === 'route' && routeArea !== 'inventory'"
						:is="routeComponent"
						:key="routeKey"
						v-bind="routeComponentProps"
						:active="page === 'route'"
						:density="preferences.density"
						:text-scale="preferences.textScale"
						@navigate="selectRoute"
						@notify="notify"
						@update-density="preferences.density = $event"
						@update-text-scale="preferences.textScale = $event"
					/>
				</KeepAlive>
				<footer class="sample-footer">
					<span>物资设计研究室 / 2026</span><span>风格、密度、导航与流程分别评审</span>
				</footer>
			</main>
			<nav
				v-if="isMobile"
				ref="mobileNavigation"
				class="sample-mobile-nav"
				aria-label="示例应用主导航"
				:style="{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }"
			>
				<button
					v-for="group in groups"
					:key="group.label"
					:aria-current="section === group.key ? 'page' : undefined"
					@click="navigatePrimary(group.route)"
				>
					<InventoryIcon :name="group.icon" /><span>{{ group.label }}</span>
				</button>
			</nav>
		</div>
		<Teleport to="body"
			><div v-if="toast" class="preview-toast">
				<InventoryIcon name="notice" /><span role="status">{{ toast }}</span
				><button aria-label="关闭通知" @click="toast = ''">×</button>
			</div></Teleport
		>
	</div>
</template>
