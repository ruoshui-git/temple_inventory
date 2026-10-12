<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import UiButton from "../components/UiButton.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import PreviewGallery from "./PreviewGallery.vue";
import PreviewInventory from "./PreviewInventory.vue";
import PreviewReceive from "./PreviewReceive.vue";
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
const activeDestination = ref("库存列表");
const section = ref("库存");
const toast = ref("");
const settingsOpen = ref(true);
const groups = computed(() =>
	preferences.navigation === "current"
		? [
				{ label: "首页", icon: "total", children: ["物资总览"] },
				{ label: "库存", icon: "box", children: ["库存列表", "效期批次"] },
				{ label: "货物流动", icon: "movement", children: ["流动明细", "流动记录"] },
				{ label: "借用", icon: "loan", children: ["借用明细", "借用记录"] },
				{ label: "仓库", icon: "warehouse", children: ["仓库管理"] },
				{
					label: "更多",
					icon: "more",
					children: ["待处理", "草稿", "报表与导出", "盘点调整"],
				},
			]
		: [
				{ label: "首页", icon: "total", children: ["物资总览"] },
				{ label: "库存", icon: "box", children: ["库存列表", "效期批次", "仓库管理"] },
				{
					label: "业务",
					icon: "movement",
					children: ["流动明细", "流动记录", "借用明细", "借用记录", "待处理", "草稿"],
				},
				{ label: "更多", icon: "more", children: ["报表与导出", "盘点调整"] },
			],
);
const currentGroup = computed(
	() => groups.value.find((group) => group.label === section.value) || groups.value[1],
);
function navigate(destination: string) {
	activeDestination.value = destination;
	page.value = destination === "库存列表" ? "inventory" : "placeholder";
}
function openGroup(label: string) {
	section.value = label;
	const group = groups.value.find((group) => group.label === label)!;
	navigate(group.children[0]);
}
function openInventory() {
	page.value = "inventory";
	section.value = "库存";
	activeDestination.value = "库存列表";
}
function notify(message: string) {
	toast.value = message;
}
watch(
	() => preferences.navigation,
	() => {
		section.value =
			groups.value.find((group) => group.children.includes(activeDestination.value))
				?.label || "库存";
	},
);
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
		Object.entries(tokens).forEach(([name, value]) =>
			element.style.setProperty(`--p-${name}`, value),
		);
	},
	{ immediate: true },
);
onBeforeUnmount(() => {
	delete document.documentElement.dataset.previewTheme;
	delete document.documentElement.dataset.previewDensity;
});
</script>
<template>
	<div class="preview-app">
		<header class="review-header">
			<a class="review-brand" href="#" @click.prevent="page = 'gallery'"
				><span class="brand-symbol"><InventoryIcon name="box" /></span
				><span>物资 <b>设计研究室</b></span></a
			>
			<div class="review-header-actions">
				<span class="review-status"><i />待评审 · 不影响正式应用</span
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
			<div class="theme-options" aria-label="视觉方向">
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
					>主导航<select v-model="preferences.navigation" aria-label="主导航方案">
						<option value="current">当前 · 六个入口</option>
						<option value="proposed">提案 · 四个入口</option>
					</select></label
				><label
					>入库表单<select v-model="preferences.form" aria-label="入库表单方案">
						<option value="current">对照 · 底部提交</option>
						<option value="proposed">首选 · 日期在前 + 侧栏汇总</option>
					</select></label
				><button class="text-button" @click="Object.assign(preferences, defaults)">
					恢复默认
				</button>
			</div>
		</section>
		<nav class="preview-page-tabs" aria-label="评审样本">
			<button
				:aria-current="page === 'gallery' ? 'page' : undefined"
				@click="page = 'gallery'"
			>
				<span>01</span>组件画廊</button
			><button
				:aria-current="page === 'inventory' ? 'page' : undefined"
				@click="openInventory"
			>
				<span>02</span>库存浏览</button
			><button
				:aria-current="page === 'receive' ? 'page' : undefined"
				@click="page = 'receive'"
			>
				<span>03</span>入库登记</button
			><span class="muted">真实组件 · 模拟数据 · 自适应布局</span>
		</nav>
		<div class="preview-workspace" :class="{ 'is-mobile': isMobile }">
			<aside v-if="!isMobile" class="sample-sidebar">
				<div class="sample-brand">
					<span class="brand-symbol"><InventoryIcon name="box" /></span>
					<div><strong>寺院物资</strong><small>每一份，都妥善安放</small></div>
				</div>
				<span class="sidebar-caption">{{
					preferences.navigation === "current"
						? "当前导航 · 六个入口"
						: "导航提案 · 四个入口"
				}}</span>
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
								: activeDestination
					}}</span
					><span class="sample-tag">交互样本</span>
				</div>
				<p v-if="preferences.navigation === 'proposed'" class="navigation-note">
					导航提案：库存合并仓库；业务集中流动、借用、待处理与草稿。此分组需要单独评审。
				</p>
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
					@notify="notify"
					@inventory="openInventory"
					@receive="page = 'receive'"
				/>
				<PreviewInventory
					v-show="page === 'inventory'"
					:pattern="preferences.actions"
					@notify="notify"
					@receive="page = 'receive'"
				/>
				<PreviewReceive
					v-show="page === 'receive'"
					:pattern="preferences.form"
					@notify="notify"
					@back="openInventory"
				/>
				<section v-if="page === 'placeholder'" class="surface placeholder-page">
					<span class="eyebrow">NAVIGATION STUDY</span
					><InventoryIcon :name="currentGroup.icon" />
					<h1>{{ activeDestination }}</h1>
					<p>这个入口保留在导航中，用来评审分组与查找路径。</p>
					<p class="muted">
						本轮完整交互示例为库存浏览与入库登记。此页是明确的占位示例。
					</p>
					<UiButton variant="primary" @click="openInventory">查看库存示例</UiButton>
				</section>
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
