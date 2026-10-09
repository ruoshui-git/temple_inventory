<script setup lang="ts">
import type { LocationQueryRaw } from "vue-router";
import InventoryIcon from "../../components/InventoryIcon.vue";
import UiButton from "../../components/UiButton.vue";

export interface ShellDestination {
	key: "inventory" | "movements" | "loans" | "warehouses" | "more";
	label: string;
	path: string;
}
export interface ShellContextItem {
	key: string;
	label: string;
	path: string;
	query: LocationQueryRaw;
}
const props = defineProps<{
	destinations: ShellDestination[];
	activeDestination: string;
	expandedSection?: string;
	navigationContexts?: Record<string, ShellContextItem[]>;
	inventoryContextItems?: ShellContextItem[];
	contextItems?: ShellContextItem[];
	contextKey?: string;
	pending: number;
	expiryCount: number;
	user: string;
}>();
const expanded = () => props.expandedSection ?? "";
const contexts = (key: string) =>
	props.navigationContexts?.[key] ||
	(key === "inventory" ? props.inventoryContextItems || [] : props.contextItems || []);
const emit = defineEmits<{ toggleSection: [key: string]; closeContext: []; logout: [] }>();
const iconPaths: Record<string, string> = {
	inventory: "m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10",
	movements: "M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3 3m-3-3 3-3",
	loans: "M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3",
	more: "M5 12h.01M12 12h.01M19 12h.01",
	warehouses: "m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10",
};
</script>
<template>
	<aside class="desktop-nav">
		<RouterLink class="shell-brand" to="/" aria-label="寺院物资首页"
			><span aria-hidden="true"><InventoryIcon name="box" /></span
			><b>寺院物资</b></RouterLink
		>
		<nav aria-label="主导航" class="desktop-module-navigation">
			<template v-for="item in props.destinations" :key="item.path">
				<RouterLink
					v-if="item.key === 'warehouses'"
					:to="item.path"
					:aria-current="props.activeDestination === item.path ? 'page' : undefined"
					@click="emit('closeContext')"
					><svg class="desktop-nav-icon" aria-hidden="true" viewBox="0 0 24 24">
						<path :d="iconPaths[item.key]" /></svg
					><span>{{ item.label }}</span></RouterLink
				>
				<button
					v-else
					type="button"
					class="module-parent"
					:class="{
						active: props.activeDestination === item.path,
						'inventory-parent': item.key === 'inventory',
					}"
					:aria-expanded="expanded() === item.key"
					@click="emit('toggleSection', item.key)"
				>
					<svg class="desktop-nav-icon" aria-hidden="true" viewBox="0 0 24 24">
						<path :d="iconPaths[item.key]" /></svg
					><span>{{ item.label }}</span
					><b v-if="item.key === 'more' && props.pending" class="nav-badge">{{
						props.pending
					}}</b
					><i
						class="module-chevron"
						:class="{ collapsed: expanded() !== item.key }"
						aria-hidden="true"
					></i>
				</button>
				<div
					v-if="expanded() === item.key"
					class="desktop-inventory-context"
					role="navigation"
					aria-label="当前视图"
				>
					<RouterLink
						v-for="contextItem in contexts(item.key)"
						:key="contextItem.key"
						:to="{ path: contextItem.path, query: contextItem.query }"
						:aria-current="props.contextKey === contextItem.key ? 'page' : undefined"
						><span>{{
							contextItem.key === "current" ? "库存列表" : contextItem.label
						}}</span
						><b
							v-if="contextItem.key === 'expiry' && props.expiryCount"
							class="nav-badge"
							>{{ props.expiryCount }}</b
						></RouterLink
					>
				</div>
			</template>
		</nav>
		<div class="shell-actions">
			<span class="user-avatar" aria-hidden="true">{{ props.user.slice(0, 1) }}</span>
			<div>
				<b>{{ props.user || "当前用户" }}</b
				><small>物资管理</small>
			</div>
			<UiButton variant="ghost" size="compact" @click="emit('logout')">退出</UiButton>
		</div>
	</aside>
</template>
<style scoped>
@media (min-width: 1024px) {
	.desktop-nav {
		display: flex;
		align-items: stretch;
		box-sizing: border-box;
		height: 100%;
		min-height: 0;
		min-width: 0;
		flex-direction: column;
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
	.shell-brand,
	.shell-brand:hover,
	.shell-brand:focus-visible,
	.shell-brand[aria-current="page"] {
		background: transparent;
		color: #343c46;
		font-weight: 800;
	}
	.shell-brand:focus-visible {
		outline: 2px solid #946c3f;
		outline-offset: 2px;
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
	}
	.desktop-module-navigation {
		display: grid;
		flex: 1;
		min-height: 0;
		gap: 6px;
		align-content: start;
		overflow-x: hidden;
		overflow-y: auto;
		scrollbar-width: thin;
	}
	.desktop-module-navigation > a,
	.desktop-module-navigation > button {
		position: relative;
		display: flex;
		align-items: center;
		min-height: 42px;
		padding: 8px 12px;
		border: 0;
		border-radius: 7px;
		color: #5f5b55;
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
		display: flex;
		align-items: stretch;
		flex-direction: column;
		gap: 3px;
		padding: 0 0 4px 23px;
		min-width: 0;
	}
	.desktop-inventory-context a {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		width: 100%;
		min-height: 34px;
		padding: 6px 9px;
		border-radius: 6px;
		color: #756f67;
		font-size: 13px;
		gap: 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
}
</style>
