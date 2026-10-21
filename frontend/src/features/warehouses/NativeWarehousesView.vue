<script setup lang="ts">
import PageHeader from "../../components/ui/PageHeader.vue";
import type { NativeWarehouses } from "./useNativeWarehouses";
import type { ReportQuery } from "../../lib/reportContract";
import UiButton from "../../components/ui/UiButton.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import Overlay from "../../components/ui/Overlay.vue";
import QuantitySummary from "../../components/ui/QuantitySummary.vue";
import QuickExport from "../../components/QuickExport.vue";
import ReportTable from "../../components/ui/ReportTable.vue";
import MovementHistoryTable from "../../components/ui/MovementHistoryTable.vue";
import RecoverySummary from "../../components/ui/RecoverySummary.vue";
const props = withDefaults(
	defineProps<{ controller: NativeWarehouses; detail?: boolean; active?: boolean }>(),
	{ active: true },
);
const emit = defineEmits<{
	warehouse: [name: string];
	item: [code: string];
	back: [];
	browse: [query: ReportQuery];
	openDocument: [doctype: string, name: string];
	openLoan: [name: string];
	openExport: [query: ReportQuery];
	newCount: [warehouse: string];
	newOperation: [kind: string, warehouse: string];
}>();
const c = props.controller;
const {
	tree,
	selected,
	visibleRows,
	expanded,
	loading,
	error,
	search,
	dialogOpen,
	busy,
	formError,
	form,
	recoveryError,
	candidates,
	leaveOpen,
	editing,
} = c;
const stockTable = c.stock.mainTable;
function physicalType(value: string) {
	return (
		({ Room: "房间", Location: "位置" } as Record<string, string>)[value] ||
		value ||
		"未设置类型"
	);
}
function toggle(name: string) {
	const next = new Set(expanded.value);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	expanded.value = next;
}
</script>
<template>
	<section class="browse-page">
		<PageHeader
			><div>
				<h1 tabindex="-1">{{ detail ? selected?.label || "仓库详情" : "仓库" }}</h1>
				<p v-if="detail && selected" class="muted">ERPNext 名称：{{ selected.name }}</p>
			</div>
			<template #back
				><UiButton v-if="detail" @click="emit('back')">返回仓库</UiButton></template
			><template #actions
				><UiButton :disabled="loading || busy" @click="c.load">刷新</UiButton>
				<QuickExport
					v-if="c.canUseSelection.value"
					:query="c.stockQuery.value"
					:active="active"
					@open-full="emit('openExport', $event)"
				/>
				<UiButton v-if="tree?.can_create" variant="primary" @click="c.openEditor()"
					>新建仓库 / 位置</UiButton
				></template
			></PageHeader
		>
		<p v-if="loading" role="status">正在读取仓库与权限…</p>
		<p v-if="error" class="utility-error" role="alert">{{ error }}</p>
		<p v-if="recoveryError" class="utility-error" role="alert">{{ recoveryError }}</p>
		<details v-if="candidates.length" open class="surface form-section">
			<summary>此浏览器的未完成仓库输入</summary>
			<p>仅在当前浏览器与账户可用。恢复前会重新读取并核对原仓库版本。</p>
			<article v-for="entry in candidates" :key="entry.editorId">
				<RecoverySummary
					kind="Warehouse"
					:values="entry.values"
					:copy-text="JSON.stringify(entry.values, null, 2)"
				>
					<UiButton @click="c.recover(entry)">核对后恢复</UiButton>
				</RecoverySummary>
			</article>
		</details>
		<template v-if="tree && !error">
			<div v-if="!detail" class="browse-toolbar">
				<label class="browse-search"
					><InventoryIcon name="search" /><input
						v-model="search"
						type="search"
						placeholder="搜索仓库、房间或位置"
						aria-label="搜索仓库" /></label
				><span class="browse-result-count">{{ visibleRows.length }} 个节点</span>
			</div>
			<div :class="{ 'browse-warehouse-layout': !detail }">
				<div v-if="!detail" class="browse-warehouse-tree">
					<div class="browse-card-heading">
						<div>
							<h2>仓库结构</h2>
						</div>
					</div>
					<div
						v-for="row in visibleRows"
						:key="row.name"
						:data-browse-row="'warehouse:' + row.name"
						class="browse-tree-row"
						:class="{ 'is-selected': selected?.name === row.name }"
						:style="{ '--tree-depth': Math.min(row.depth, 4) }"
						role="group"
						:aria-label="row.label"
					>
						<button
							v-if="row.is_group"
							class="browse-link warehouse-toggle"
							:aria-label="(expanded.has(row.name) ? '收起' : '展开') + row.label"
							:aria-expanded="expanded.has(row.name)"
							@click="toggle(row.name)"
						>
							<InventoryIcon
								:name="expanded.has(row.name) ? 'chevron-down' : 'chevron-right'"
							/></button
						><span v-else class="browse-tree-type"
							><InventoryIcon name="location"
						/></span>
						<button
							class="browse-grow browse-link"
							:aria-pressed="selected?.name === row.name"
							@click="c.select(row.name)"
						>
							<strong>{{ row.label }}</strong
							><small
								>{{ physicalType(row.type) }} ·
								{{ row.is_group ? "分组" : "可存放库存"
								}}{{ row.disabled ? " · 已停用" : ""
								}}{{ row.protected ? " · 系统节点" : "" }}</small
							>
						</button>
						<div class="warehouse-node-actions">
							<button class="browse-link" @click="emit('warehouse', row.name)">
								详情</button
							><button
								v-if="row.can_edit"
								class="browse-link"
								@click="c.openEditor(row)"
							>
								编辑
							</button>
						</div>
					</div>
					<p v-if="!visibleRows.length" class="browse-empty compact">
						没有符合搜索的仓库。
					</p>
				</div>
				<article v-if="selected" :class="detail ? 'browse-detail-card' : 'browse-card'">
					<div class="browse-card-heading">
						<div>
							<h2>{{ selected.label }}</h2>
							<p>
								{{
									selected.is_group
										? "分组仓库只汇总下级叶子库位，不直接存放库存。"
										: "叶子库位 · 实际存放库存"
								}}
							</p>
						</div>
						<UiButton v-if="selected.can_edit" @click="c.openEditor(selected)"
							>编辑仓库</UiButton
						>
					</div>
					<dl class="browse-detail-grid">
						<div>
							<dt>物理类型</dt>
							<dd>{{ physicalType(selected.type) }}</dd>
						</div>
						<div>
							<dt>上级</dt>
							<dd>
								{{
									tree.rows.find((row) => row.name === selected?.parent)
										?.label ||
									selected.parent ||
									"根节点"
								}}
							</dd>
						</div>
						<div>
							<dt>状态</dt>
							<dd>{{ selected.disabled ? "停用" : "启用" }}</dd>
						</div>
						<div>
							<dt>结构</dt>
							<dd>{{ selected.is_group ? "分组" : "叶子" }}</dd>
						</div>
					</dl>
					<p v-if="c.stock.result.loading" role="status">
						{{
							c.stock.result.stale
								? "正在更新；以下是上次读取的库存。"
								: "正在读取此范围的库存…"
						}}
					</p>
					<p v-if="c.stock.result.error" role="alert">
						{{ c.stock.result.error }}
						<UiButton @click="c.stock.refresh">重试库存</UiButton>
					</p>
					<QuantitySummary
						v-if="stockTable?.initialized"
						:metrics="[
							{
								key: 'stock',
								label: '当前范围库存',
								quantities: c.stock.result.summary.map((row) => ({
									uom: String(row.stock_uom),
									qty: Number(row.stock_qty),
								})),
							},
						]"
					/>
					<div v-if="stockTable?.rows.length" class="browse-rank-list">
						<button
							v-for="row in stockTable.rows"
							:key="String(row.id)"
							:data-browse-row="'stock:' + String(row.id)"
							class="browse-rank-row"
							@click="emit('item', String(row.item_code))"
						>
							<span class="browse-grow"
								><strong>{{ row.item_name }}</strong
								><small
									>{{ row.item_code }} ·
									{{ row.warehouse_label || "位置暂不可用"
									}}{{ row.batch_no ? " · 批次 " + row.batch_no : "" }}</small
								></span
							><b
								>{{ row.stock_qty }} <small>{{ row.stock_uom }}</small></b
							>
						</button>
					</div>
					<p
						v-else-if="
							stockTable?.initialized &&
							!c.stock.result.loading &&
							!c.stock.result.error
						"
						class="browse-empty compact"
					>
						此范围暂无库存。
					</p>
					<p v-if="stockTable?.error" role="alert">{{ stockTable.error }}</p>
					<UiButton
						v-if="stockTable?.next !== null && stockTable?.next !== undefined"
						:disabled="stockTable.loading || c.stock.result.stale"
						@click="c.stock.loadTable(stockTable, true)"
						>加载更多库存</UiButton
					>
					<div class="browse-actions">
						<UiButton
							v-for="action in c.operationActions.value"
							:key="action.kind"
							@click="emit('newOperation', action.kind, selected.name)"
							>{{ action.label }}</UiButton
						>
						<UiButton
							:disabled="!c.canUseSelection.value"
							@click="emit('browse', c.stockQuery.value)"
							>查看完整库存范围</UiButton
						><UiButton v-if="c.canCount.value" @click="emit('newCount', selected.name)"
							>盘点此库位</UiButton
						>
					</div>
					<template v-if="detail"
						><h2>最近流动</h2>
						<MovementHistoryTable
							:show-status="false"
							:rows="c.history.result.rows"
							:total="c.history.result.total"
							:next="c.history.result.next"
							:loading="c.history.result.loading"
							:initialized="c.history.result.initialized"
							:error="c.history.result.error"
							:stale="c.history.result.stale"
							:sort-by="c.history.sortBy.value"
							:sort-direction="c.history.sortDirection.value"
							include-item
							@load-more="c.history.loadMore"
							@retry="c.history.refresh"
							@sort="c.history.setSort"
							@open-document="(doctype, name) => emit('openDocument', doctype, name)"
							@open-loan="emit('openLoan', $event)"
							@open-item="emit('item', $event)"
					/></template>
				</article>
			</div>
		</template>
		<Overlay
			v-if="dialogOpen && active"
			:title="editing ? '编辑仓库 / 位置' : '新建仓库 / 位置'"
			:dismissible="!busy"
			@close="c.close"
			><p v-if="formError" class="utility-error" role="alert">{{ formError }}</p>
			<p v-if="recoveryError" role="alert">{{ recoveryError }}</p>
			<template v-if="leaveOpen"
				><p>离开前可将当前输入保留在此浏览器，或明确放弃。</p>
				<RecoverySummary
					kind="Warehouse"
					:values="form"
					:copy-text="JSON.stringify(form, null, 2)"
				/>
			</template>
			<form v-else id="native-warehouse-form" class="browse-dialog" @submit.prevent="c.save">
				<label class="preview-field"
					>名称<input v-model="form.label" required autocomplete="off" /></label
				><SearchSelect
					v-model="form.parent"
					label="上级节点"
					:options="c.parentOptions.value"
				/><label class="preview-field"
					>物理类型<select v-model="form.warehouse_type">
						<option value="Room">房间</option>
						<option value="Location">位置</option>
						<option
							v-if="!['Room', 'Location'].includes(form.warehouse_type)"
							:value="form.warehouse_type"
						>
							{{ form.warehouse_type || "请选择类型" }}
						</option>
					</select></label
				><label class="preview-choice-label"
					><input
						v-model="form.is_group"
						type="checkbox"
					/>分组节点（组织下级，不直接存放库存）</label
				><label
					v-if="
						!form.is_group &&
						c.tree.value?.rows.find((row) => row.name === form.parent)?.type === 'Room'
					"
					class="preview-choice-label"
					><input
						v-model="form.room_default"
						type="checkbox"
					/>作为此房间的默认存放位置</label
				><label class="preview-choice-label"
					><input v-model="form.disabled" type="checkbox" />停用此仓库</label
				>
				<p>
					房间 / 位置表示物理意义，分组 / 叶子单独记录。新建房间
					默认是可用叶子。已有库存或原生单据的节点保留现有层级。
				</p>
				<p v-if="editing" class="muted">
					原生标识：{{ editing.name }} · 仅更新此表单中的资料。
				</p>
			</form>
			<template #footer
				><template v-if="leaveOpen"
					><UiButton @click="c.finishLeave('stay')">继续编辑</UiButton
					><UiButton @click="c.finishLeave('retain')">保留输入并离开</UiButton
					><UiButton variant="danger" @click="c.finishLeave('discard')"
						>放弃输入并离开</UiButton
					></template
				><template v-else
					><UiButton :disabled="busy" @click="c.close">取消</UiButton
					><UiButton
						variant="primary"
						type="submit"
						form="native-warehouse-form"
						:disabled="busy"
						>{{ busy ? "正在保存…" : "保存仓库资料" }}</UiButton
					></template
				></template
			>
		</Overlay>
	</section>
</template>
<style scoped>
.warehouse-toggle {
	flex: 0 0 44px;
	min-height: 44px;
}
.browse-grow {
	min-width: 0;
	overflow-wrap: anywhere;
}
.browse-tree-row .browse-grow {
	display: block;
	text-align: left;
}
.browse-grow strong,
.browse-grow small {
	display: block;
}
.warehouse-node-actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--p-space-3);
}
@media (max-width: 1023px) {
	.browse-card-heading {
		flex-direction: column;
		align-items: flex-start;
	}
	.browse-tree-row {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr);
		gap: var(--p-space-2);
		padding-left: calc(min(var(--tree-depth, 0), 4) * 8px);
	}
	.warehouse-node-actions {
		grid-column: 2;
	}
	.warehouse-node-actions button,
	.browse-tree-row > button {
		min-height: 44px;
		min-width: 44px;
	}
}
</style>
