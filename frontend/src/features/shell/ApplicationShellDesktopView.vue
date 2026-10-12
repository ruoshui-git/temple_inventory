<script setup lang="ts">
import type { LocationQueryRaw } from "vue-router";
import InventoryIcon from "../../components/InventoryIcon.vue";
import UiButton from "../../components/UiButton.vue";

export interface ShellDestination {
	key: "dashboard" | "inventory" | "movements" | "loans" | "warehouses" | "more";
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
	dashboard: "M4 5h16v14H4zM8 9h8M8 13h5",
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
					v-if="item.key === 'warehouses' || item.key === 'dashboard'"
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
					v-if="
						expanded() === item.key &&
						item.key !== 'dashboard' &&
						item.key !== 'warehouses'
					"
					class="desktop-inventory-context"
					role="navigation"
					aria-label="当前视图"
				>
					<RouterLink
						v-for="contextItem in contexts(item.key)"
						:key="contextItem.key"
						:to="{ path: contextItem.path, query: contextItem.query }"
						:aria-current="
							props.activeDestination === item.path &&
							props.contextKey === contextItem.key
								? 'page'
								: undefined
						"
						><span>{{
							contextItem.key === "current" ? "库存列表" : contextItem.label
						}}</span></RouterLink
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
		padding: var(--ti-space-4) var(--ti-space-2);
		border-right: 1px solid var(--ti-border);
		background: var(--ti-canvas);
	}
	.shell-brand {
		display: flex;
		align-items: center;
		gap: var(--ti-space-2);
		padding: 0 var(--ti-space-1) var(--ti-space-6);
		color: var(--ti-ink);
		font-size: var(--ti-font-section);
		line-height: 1.4;
	}
	.shell-brand,
	.shell-brand:hover,
	.shell-brand:focus-visible,
	.shell-brand[aria-current="page"] {
		background: transparent;
		color: var(--ti-ink);
		font-weight: 800;
	}
	.shell-brand:focus-visible {
		outline: 2px solid var(--ti-accent);
		outline-offset: 2px;
	}
	.shell-brand > span {
		display: grid;
		width: 30px;
		height: 32px;
		place-items: center;
		border-radius: var(--ti-radius-small);
		border: 1px solid var(--ti-border);
		background: transparent;
		color: var(--ti-muted);
	}
	.desktop-module-navigation {
		display: grid;
		flex: 1;
		min-height: 0;
		gap: var(--ti-space-1);
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
		min-height: var(--ti-density-control);
		padding: var(--ti-space-2) var(--ti-space-3);
		border: 0;
		border-radius: var(--ti-radius-small);
		color: var(--ti-muted);
		background: transparent;
		font: inherit;
		text-align: left;
	}
	.desktop-module-navigation > a[aria-current="page"],
	.desktop-module-navigation > button.active {
		background: var(--ti-accent-soft);
		color: var(--ti-accent-strong);
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
		padding: 0 var(--ti-space-1);
		border-radius: var(--ti-radius-small);
		background: var(--ti-accent-soft);
		color: var(--ti-accent-strong);
		font-size: max(12px, var(--ti-font-small));
	}
	.desktop-inventory-context {
		display: flex;
		align-items: stretch;
		flex-direction: column;
		gap: var(--ti-space-1);
		padding: 0 0 var(--ti-space-1) var(--ti-space-6);
		min-width: 0;
	}
	.desktop-inventory-context a {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		width: 100%;
		min-height: var(--ti-density-control);
		padding: var(--ti-space-1) var(--ti-space-2);
		border-radius: var(--ti-radius-small);
		color: var(--ti-muted);
		font-size: var(--ti-font-body);
		gap: var(--ti-space-1);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.desktop-inventory-context a[aria-current="page"] {
		background: var(--ti-accent-soft);
		color: var(--ti-accent-strong);
		font-weight: 700;
	}
	.shell-actions {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		gap: var(--ti-space-2);
		align-items: center;
		margin-top: auto;
		padding: var(--ti-space-3) var(--ti-space-1) 0;
	}
	.user-avatar {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border-radius: var(--ti-radius-pill);
		background: var(--ti-border);
	}
	.shell-actions div {
		min-width: 0;
		overflow: hidden;
		font-size: max(12px, var(--ti-font-small));
	}
	.shell-actions b,
	.shell-actions small {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shell-actions small {
		color: var(--ti-muted);
		font-size: max(12px, var(--ti-font-small));
	}
	.shell-actions button {
		grid-column: 1 / -1;
		min-height: 30px;
		padding: var(--ti-space-1) var(--ti-space-2);
		border-color: transparent;
		background: transparent;
		color: var(--ti-muted);
		font-size: max(12px, var(--ti-font-small));
	}
}
</style>
