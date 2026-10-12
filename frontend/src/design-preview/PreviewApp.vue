<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import PreviewGallery from "./PreviewGallery.vue";
import PreviewInventory from "./PreviewInventory.vue";
import PreviewReceive from "./PreviewReceive.vue";
import PreviewBrowsePages from "./PreviewBrowsePages.vue";
import PreviewFormPages from "./PreviewFormPages.vue";
import PreviewUtilityPages from "./PreviewUtilityPages.vue";
import {
	getPreviewPage,
	pageFromHash,
	pageHash,
	previewPages,
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
const page = ref("gallery");
const routeKey = ref<PreviewPageKey>("dashboard/overview");
const activeRoute = computed(() => getPreviewPage(routeKey.value)!);
const activeDestination = ref("库存列表");
const section = ref("库存");
const toast = ref("");
const settingsOpen = ref(true);
const indexOpen = ref(false);
const indexSearch = ref("");
const indexedPages = computed(() =>
	previewPages.filter((entry) =>
		`${entry.label} ${entry.path}`.toLowerCase().includes(indexSearch.value.toLowerCase()),
	),
);
const groups = computed(() => [
	{ label: "首页", icon: "total", children: ["物资总览"] },
	{ label: "库存", icon: "box", children: ["库存列表", "效期批次"] },
	{ label: "货物流动", icon: "movement", children: ["流动明细", "流动记录"] },
	{ label: "借用", icon: "loan", children: ["借用明细", "借用记录"] },
	{ label: "仓库", icon: "warehouse", children: ["仓库管理"] },
	{
		label: "更多",
		icon: "more",
		children: [
			"更多总览",
			"待处理",
			"草稿",
			"报表与导出",
			"显示设置",
			"仓库设置示例",
			"会话恢复示例",
		],
	},
]);
const currentGroup = computed(
	() => groups.value.find((group) => group.label === section.value) || groups.value[1],
);
function navigate(destination: string) {
	const routeAliases: Record<string, PreviewPageKey> = {
		库存列表: "inventory/list",
		效期批次: "expiry/all",
		物资总览: "dashboard/overview",
		流动记录: "movement-records/draft",
		借用明细: "loan-items/outstanding",
		借用记录: "loan-records/open",
		仓库管理: "warehouses/tree",
		盘点调整: "reconciliation-form/new",
		更多总览: "more/index",
		显示设置: "settings/density",
		仓库设置示例: "setup/warehouse",
		会话恢复示例: "recovery/session",
	};
	const route =
		previewPages.find((candidate) => candidate.label === destination) ||
		getPreviewPage(routeAliases[destination] || "dashboard/overview");
	if (route) selectRoute(route.page, route.variant);
}
function selectRoute(routePage: string, variant: string) {
	const route = previewPages.find(
		(candidate) => candidate.page === routePage && candidate.variant === variant,
	);
	if (!route) return;
	routeKey.value = route.key;
	activeDestination.value = route.label;
	section.value = groups.value.some((group) => group.label === route.group)
		? route.group
		: "更多";
	page.value = "route";
	window.location.hash = pageHash(route.key);
}
function selectLocalPage(view: "gallery" | "inventory" | "receive") {
	page.value = view;
	if (view === "inventory") {
		section.value = "库存";
		activeDestination.value = "库存列表";
	}
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
		activeDestination.value = route.label;
		section.value = groups.value.some((group) => group.label === route.group)
			? route.group
			: "更多";
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
function openGroup(label: string) {
	section.value = label;
	const group = groups.value.find((group) => group.label === label)!;
	navigate(group.children[0]);
}
function openInventory() {
	selectLocalPage("inventory");
}
function notify(message: string) {
	toast.value = message;
}
watch(preferences, () => writePreferences(storage, preferences), { deep: true });
watch(
	[theme, () => preferences.density],
	() => {
		const element = document.documentElement;
		element.dataset.previewTheme = preferences.theme;
		element.dataset.previewDensity = preferences.density;
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
onBeforeUnmount(() => {
	window.removeEventListener("hashchange", syncLocationHash);
	delete document.documentElement.dataset.previewTheme;
	delete document.documentElement.dataset.previewDensity;
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
				<label
					>显示密度<select v-model="preferences.density" aria-label="显示密度">
						<option value="compact">紧凑 · 更多信息</option>
						<option value="balanced">均衡 · 默认</option>
						<option value="spacious">宽松 · 更大文字</option>
					</select></label
				><label
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
				<span class="sidebar-caption">当前主导航 · 六个入口</span>
				<nav aria-label="示例应用主导航">
					<div v-for="group in groups" :key="group.label" class="nav-group">
						<button
							:class="{ active: section === group.label }"
							:aria-expanded="section === group.label"
							@click="
								group.children.length === 1
									? openGroup(group.label)
									: (section = section === group.label ? '' : group.label)
							"
						>
							<InventoryIcon :name="group.icon" />{{ group.label
							}}<InventoryIcon name="chevron-down" />
						</button>
						<div v-if="section === group.label" class="nav-children">
							<button
								v-for="child in group.children"
								:key="child"
								:aria-current="
									activeDestination === child &&
									page !== 'gallery' &&
									page !== 'receive'
										? 'page'
										: undefined
								"
								@click="navigate(child)"
							>
								{{ child }}
							</button>
						</div>
					</div>
				</nav>
				<div class="sidebar-bottom">
					<span class="avatar">义</span>
					<div><strong>义工工作台</strong><small>本地设计预览</small></div>
					<span class="status-dot" />
				</div>
			</aside>
			<main id="sample-content" class="sample-content">
				<div class="sample-breadcrumb">
					<span>寺院物资</span><span>/</span
					><span>{{
						page === "gallery"
							? "组件画廊"
							: page === "receive"
								? "入库登记"
								: page === "inventory"
									? "库存浏览样本"
									: activeDestination
					}}</span
					><span class="sample-tag">交互样本</span>
				</div>
				<nav
					v-if="isMobile && page !== 'gallery' && page !== 'receive'"
					class="mobile-context"
					aria-label="示例应用子导航"
				>
					<button
						v-for="child in currentGroup.children"
						:key="child"
						:aria-current="activeDestination === child ? 'page' : undefined"
						@click="navigate(child)"
					>
						{{ child }}
					</button>
				</nav>
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
				/>
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
						@navigate="selectRoute"
						@notify="notify"
						@update-density="preferences.density = $event"
					/>
				</KeepAlive>
				<footer class="sample-footer">
					<span>物资设计研究室 / 2026</span><span>风格、密度、导航与流程分别评审</span>
				</footer>
			</main>
			<nav
				v-if="isMobile"
				class="sample-mobile-nav"
				aria-label="示例应用主导航"
				:style="{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }"
			>
				<button
					v-for="group in groups"
					:key="group.label"
					:aria-current="
						section === group.label && page !== 'gallery' && page !== 'receive'
							? 'page'
							: undefined
					"
					@click="openGroup(group.label)"
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
