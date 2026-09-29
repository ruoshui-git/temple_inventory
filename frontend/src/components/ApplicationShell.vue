<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, type LocationQueryRaw } from "vue-router";
import { api, request } from "../lib/api";
import InventoryIcon from "./InventoryIcon.vue";

type Destination = {
	key: "inventory" | "movements" | "adjustments" | "loans" | "warehouses" | "more";
	label: string;
	path: string;
};
type ContextItem = { key: string; label: string; path: string; query: LocationQueryRaw };

const route = useRoute();
const boot = ref<any>();
const inventoryExpanded = ref(route.path === "/" || route.path === "/expiry");
const destinations: Destination[] = [
	{ key: "inventory", label: "库存", path: "/" },
	{ key: "movements", label: "货物流动", path: "/movements" },
	{ key: "adjustments", label: "盘点调整", path: "/adjustments" },
	{ key: "loans", label: "借用", path: "/loans" },
	{ key: "warehouses", label: "仓库", path: "/warehouses" },
	{ key: "more", label: "更多", path: "/more" },
];

const activeDestination = computed(() => {
	if (
		route.path === "/movements" ||
		route.path === "/history" ||
		["Receive", "Issue", "Transfer"].includes(String(route.params.kind || ""))
	)
		return "/movements";
	if (route.path === "/adjustments" || route.path.startsWith("/reconcile"))
		return "/adjustments";
	if (route.path.startsWith("/loans") || route.path === "/new/Loan") return "/loans";
	if (route.path.startsWith("/warehouses") || route.path === "/settings") return "/warehouses";
	if (
		route.path === "/more" ||
		route.path === "/reports" ||
		route.path === "/drafts" ||
		route.path === "/pending"
	)
		return "/more";
	return "/";
});

const inventorySharedQuery = computed<LocationQueryRaw>(() => ({
	search: route.query.search,
	warehouses: route.query.warehouses,
	item_groups: route.query.item_groups,
}));
const movementSharedQuery = computed<LocationQueryRaw>(() => ({
	search: route.query.search,
	period: route.query.period,
	date_from: route.query.date_from,
	date_to: route.query.date_to,
	item_groups: route.query.item_groups,
	sort_by: route.query.sort_by,
	sort_order: route.query.sort_order,
}));
const loanSharedQuery = computed<LocationQueryRaw>(() => ({
	search: route.query.search,
	loan_date: route.query.loan_date,
	item_groups: route.query.item_groups,
	warehouses: route.query.warehouses,
	activity: route.query.activity,
	sort_by: route.query.sort_by,
	sort_order: route.query.sort_order,
}));

const inventoryContextItems = computed<ContextItem[]>(() => [
	{ key: "current", label: "当前库存", path: "/", query: inventorySharedQuery.value },
	{
		key: "expiry",
		label: "效期批次",
		path: "/expiry",
		query: inventorySharedQuery.value,
	},
]);
const contextItems = computed<ContextItem[]>(() => {
	if (route.path === "/" || route.path === "/expiry") return inventoryContextItems.value;
	if (route.path === "/movements" || route.path === "/history")
		return [
			{
				key: "overview",
				label: "概览",
				path: "/movements",
				query: movementSharedQuery.value,
			},
			{
				key: "Receive",
				label: "入库",
				path: "/movements",
				query: { ...movementSharedQuery.value, kind: "Receive" },
			},
			{
				key: "Issue",
				label: "出库",
				path: "/movements",
				query: { ...movementSharedQuery.value, kind: "Issue" },
			},
			{
				key: "Transfer",
				label: "转移",
				path: "/movements",
				query: { ...movementSharedQuery.value, kind: "Transfer" },
			},
		];
	if (route.path === "/loans")
		return [
			{
				key: "outstanding",
				label: "未结借用",
				path: "/loans",
				query: loanSharedQuery.value,
			},
			{
				key: "settled",
				label: "已结借用",
				path: "/loans",
				query: { ...loanSharedQuery.value, status: "settled" },
			},
		];
	return [];
});

const contextKey = computed(() => {
	if (route.path === "/") return "current";
	if (route.path === "/expiry") return "expiry";
	if (route.path === "/movements" || route.path === "/history") {
		const requested = String(route.query.kind || route.query.movement_kind || "");
		return ["Receive", "Issue", "Transfer"].includes(requested) ? requested : "overview";
	}
	if (route.path === "/loans")
		return route.query.status === "settled" ? "settled" : "outstanding";
	return "";
});

const pending = computed(() => Number(boot.value?.pending_count || 0));
const expiryCount = computed(() => Number(boot.value?.expiry_batch_count || 0));
const mobileNav = ref<HTMLElement>();
const mobileContextNav = ref<HTMLElement>();
let mobileNavObserver: ResizeObserver | undefined;
let mobileContextObserver: ResizeObserver | undefined;

function updateLayoutHeights() {
	document.documentElement.style.setProperty("--shell-header-height", "0px");
	document.documentElement.style.setProperty(
		"--mobile-nav-height",
		`${mobileNav.value?.offsetHeight || 0}px`,
	);
	document.documentElement.style.setProperty(
		"--mobile-context-nav-height",
		`${mobileContextNav.value?.offsetHeight || 0}px`,
	);
}
async function observeContextNav() {
	await nextTick();
	mobileContextObserver?.disconnect();
	if (mobileContextNav.value) mobileContextObserver?.observe(mobileContextNav.value);
	updateLayoutHeights();
}
async function refresh() {
	try {
		boot.value = await api("bootstrap");
	} catch {
		/* page-level API renders errors */
	}
}
async function logout() {
	await request("logout");
	window.location.href = "/login?redirect-to=%2Finventory";
}

watch(contextItems, () => {
	void observeContextNav();
});
watch(
	() => route.path,
	(path) => {
		inventoryExpanded.value = path === "/" || path === "/expiry";
	},
);
onMounted(() => {
	void refresh();
	window.addEventListener("ti:refresh-shell", refresh);
	mobileNavObserver = new ResizeObserver(updateLayoutHeights);
	mobileContextObserver = new ResizeObserver(updateLayoutHeights);
	if (mobileNav.value) mobileNavObserver.observe(mobileNav.value);
	void observeContextNav();
});
onBeforeUnmount(() => {
	window.removeEventListener("ti:refresh-shell", refresh);
	mobileNavObserver?.disconnect();
	mobileContextObserver?.disconnect();
	document.documentElement.style.removeProperty("--shell-header-height");
	document.documentElement.style.removeProperty("--mobile-nav-height");
	document.documentElement.style.removeProperty("--mobile-context-nav-height");
});
</script>

<template>
	<div class="application-shell">
		<aside class="desktop-nav">
			<RouterLink class="shell-brand" to="/" aria-label="寺院物资首页">
				<span aria-hidden="true"><InventoryIcon name="box" /></span><b>寺院物资</b>
			</RouterLink>
			<nav aria-label="主导航" class="desktop-module-navigation">
				<template v-for="item in destinations" :key="item.path">
					<button
						v-if="item.key === 'inventory'"
						type="button"
						class="inventory-parent"
						:class="{ active: activeDestination === '/' }"
						:aria-expanded="inventoryExpanded"
						@click="inventoryExpanded = !inventoryExpanded"
					>
						<svg class="desktop-nav-icon" aria-hidden="true" viewBox="0 0 24 24">
							<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10" />
						</svg>
						<span>库存</span
						><i
							class="module-chevron"
							:class="{ collapsed: !inventoryExpanded }"
							aria-hidden="true"
						></i>
					</button>
					<RouterLink
						v-else
						:to="item.path"
						:aria-current="activeDestination === item.path ? 'page' : undefined"
						><svg class="desktop-nav-icon" aria-hidden="true" viewBox="0 0 24 24">
							<path
								v-if="item.key === 'movements'"
								d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3 3m-3-3 3-3"
							/>
							<path
								v-else-if="item.key === 'adjustments'"
								d="M4 6h10m4 0h2M4 12h2m4 0h10M4 18h7m4 0h5M14 4v4M6 10v4m5 2v4"
							/>
							<path
								v-else-if="item.key === 'loans'"
								d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3"
							/>
							<path
								v-else-if="item.key === 'warehouses'"
								d="m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10"
							/>
							<path v-else d="M5 12h.01M12 12h.01M19 12h.01" />
						</svg>
						<span>{{ item.label }}</span
						><b v-if="item.key === 'more' && pending" class="nav-badge">{{
							pending
						}}</b></RouterLink
					>
					<div
						v-if="
							item.key === 'inventory'
								? inventoryExpanded
								: contextItems.length && activeDestination === item.path
						"
						class="desktop-inventory-context"
						role="navigation"
						aria-label="当前视图"
					>
						<RouterLink
							v-for="contextItem in item.key === 'inventory'
								? inventoryContextItems
								: contextItems"
							:key="contextItem.key"
							:to="{ path: contextItem.path, query: contextItem.query }"
							:aria-current="contextKey === contextItem.key ? 'page' : undefined"
							><span>{{
								contextItem.key === "current" ? "库存列表" : contextItem.label
							}}</span
							><b
								v-if="contextItem.key === 'expiry' && expiryCount"
								class="nav-badge"
								>{{ expiryCount }}</b
							></RouterLink
						>
					</div>
				</template>
			</nav>
			<div class="shell-actions">
				<span class="user-avatar" aria-hidden="true">{{
					String(boot?.user || "用").slice(0, 1)
				}}</span>
				<div>
					<b>{{ boot?.user || "当前用户" }}</b
					><small>物资管理</small>
				</div>
				<button type="button" @click="logout">退出</button>
			</div>
		</aside>
		<main class="shell-content"><slot /></main>
		<nav
			v-if="contextItems.length"
			ref="mobileContextNav"
			class="mobile-context-nav"
			aria-label="当前视图"
		>
			<RouterLink
				v-for="item in contextItems"
				:key="item.key"
				:to="{ path: item.path, query: item.query }"
				:aria-current="contextKey === item.key ? 'page' : undefined"
				>{{ item.label }}</RouterLink
			>
		</nav>
		<nav ref="mobileNav" class="mobile-nav" aria-label="主导航">
			<RouterLink
				v-for="item in destinations"
				:key="item.path"
				:to="item.path"
				:aria-current="activeDestination === item.path ? 'page' : undefined"
			>
				<svg aria-hidden="true" viewBox="0 0 24 24">
					<path
						v-if="item.key === 'inventory'"
						d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10"
					/>
					<path
						v-else-if="item.key === 'movements'"
						d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3 3m-3-3 3-3"
					/>
					<path
						v-else-if="item.key === 'adjustments'"
						d="M4 6h10m4 0h2M4 12h2m4 0h10M4 18h7m4 0h5M14 4v4M6 10v4m5 2v4"
					/>
					<path
						v-else-if="item.key === 'loans'"
						d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3"
					/>
					<path
						v-else-if="item.key === 'warehouses'"
						d="m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10"
					/>
					<path v-else d="M5 12h.01M12 12h.01M19 12h.01" />
				</svg>
				<span>{{ item.label }}</span>
			</RouterLink>
		</nav>
	</div>
</template>

<style scoped>
@media (min-width: 1024px) {
	.application-shell {
		display: grid;
		grid-template-columns: 156px minmax(0, 1fr);
		height: 100dvh;
		overflow: hidden;
		background: #f8f7f4;
	}
	.desktop-nav {
		position: static;
		display: flex;
		min-width: 0;
		max-width: none;
		flex-direction: column;
		gap: 0;
		margin: 0;
		padding: 17px 10px;
		border-right: 1px solid #ebe6de;
		background: #f7f5f1;
	}
	.shell-brand {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 0 5px 25px;
		color: #343c46;
		font-size: 17px;
		line-height: 1.4;
	}
	.shell-brand > span {
		display: grid;
		width: 30px;
		height: 32px;
		place-items: center;
		border-radius: 9px;
		border: 1px solid #d8d0c5;
		background: transparent;
		color: #68727d;
		font-size: 14px;
	}
	.shell-brand:hover > span,
	.shell-brand:focus-visible > span {
		background: #f3ece2;
		color: #80572f;
		border-color: #cdbda8;
	}
	.desktop-module-navigation {
		display: grid;
		flex: none;
		gap: 6px;
	}
	.desktop-module-navigation > a,
	.desktop-module-navigation > button {
		display: flex;
		align-items: center;
		min-height: 42px;
		padding: 8px 12px;
		border-radius: 7px;
		color: #5f5b55;
		border: 0;
		background: transparent;
		font: inherit;
		text-align: left;
	}
	.desktop-module-navigation > a[aria-current="page"],
	.desktop-module-navigation > button.active {
		background: #f3ece2;
		color: #80572f;
		font-weight: 650;
	}
	.desktop-nav-icon {
		width: 20px;
		height: 20px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}
	.module-chevron {
		width: 0;
		height: 0;
		margin-left: auto;
		border-top: 4px solid transparent;
		border-bottom: 4px solid transparent;
		border-left: 6px solid currentColor;
		transform: rotate(90deg);
	}
	.module-chevron.collapsed {
		transform: rotate(0deg);
	}
	.nav-badge {
		margin-left: auto;
		padding: 0 6px;
		border-radius: 10px;
		background: #f2dfc9;
		color: #8b5b2f;
		font-size: 11px;
	}
	.desktop-inventory-context {
		display: grid !important;
		gap: 3px !important;
		padding: 0 0 4px 23px;
		border: 0;
	}
	.desktop-inventory-context a {
		min-height: 34px;
		padding: 6px 9px;
		border-radius: 6px;
		color: #756f67;
		font-size: 13px;
	}
	.desktop-inventory-context a[aria-current="page"] {
		background: #e8ded0;
		color: #81552c;
		font-weight: 700;
	}
	.shell-actions {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		gap: 9px;
		align-items: center;
		margin-top: auto;
		padding: 12px 4px 0;
	}
	.user-avatar {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border-radius: 50%;
		background: #e5e0d7;
	}
	.shell-actions div {
		min-width: 0;
		overflow: hidden;
		font-size: 12px;
	}
	.shell-actions b,
	.shell-actions small {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shell-actions small {
		color: #817a70;
		font-size: 10px;
	}
	.shell-actions button {
		grid-column: 1 / -1;
		min-height: 30px;
		padding: 3px 8px;
		border-color: transparent;
		background: transparent;
		color: #756f67;
		font-size: 12px;
	}
	.shell-content {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
}
</style>
