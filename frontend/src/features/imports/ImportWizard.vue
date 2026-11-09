<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useImportWizard, type ImportRow } from "./useImportWizard";
import {
	itemImportColumns,
	openingImportColumns,
	actionLabels,
	openingActionLabels,
} from "./itemConfig";
import DataTable from "../../components/ui/DataTable.vue";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import type { DataColumn, DataTableEntry } from "../../lib/dataTable";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/formatQuantity";
import { postingTime } from "../../lib/nativeTime";
const route = useRoute(),
	isOpening = computed(() => route.name === "imports-opening"),
	c = useImportWizard(isOpening.value ? "Opening Stock" : "Item"),
	confirmOpen = ref(false),
	fileInput = ref<HTMLInputElement>(),
	mobile = matchMedia("(max-width: 767px)");
const isPhone = ref(mobile.matches);
mobile.addEventListener("change", () => (isPhone.value = mobile.matches));
const columns = computed<DataColumn[]>(() =>
	isOpening.value
		? [
				{ id: "row", label: "源行", kind: "number" },
				{ id: "action", label: "处理结果", kind: "status" },
				...openingImportColumns.map((column) => ({
					id: column.key,
					label: column.label,
					kind:
						column.key === "qty" ||
						column.key === "valuation_rate" ||
						column.key === "line_value"
							? ("number" as const)
							: ("text" as const),
				})),
				{ id: "issues", label: "错误与提醒", kind: "text" },
			]
		: [
				{ id: "row", label: "源行", kind: "number" as const },
				{ id: "action", label: "处理结果", kind: "status" as const },
				{ id: "name", label: "物品名称", kind: "primary" as const },
				{ id: "code", label: "物品编号", kind: "code" as const },
				{ id: "issues", label: "错误与提醒", kind: "text" as const },
				{ id: "detail", label: "前后对比", kind: "text" as const },
			],
);
const rowCode = (row: ImportRow) =>
	row.item_code ||
	row.target ||
	String(row.values.item_code || "") ||
	(row.action === "REJECTED" ? "—" : "新编号待分配");
const hasChanges = (row: ImportRow) => row.action === "UPDATE";
// A row whose Item is unknown has no unit; show the number alone.
const qtyText = (row: ImportRow) => {
	const value = row as unknown as { qty?: number; stock_uom?: string };
	return value.stock_uom
		? formatQuantityWithUnit(Number(value.qty || 0), value.stock_uom)
		: formatQuantity(Number(value.qty || 0));
};
const openingMeta = (row: ImportRow) => {
	const value = row as unknown as {
		location_label?: string;
		line_value?: number;
		batch_no?: string;
		serials?: string[];
	};
	const serials = value.serials || [];
	return [
		value.location_label,
		qtyText(row),
		value.line_value ? `估值 ${value.line_value}` : "",
		value.batch_no ? `批次 ${value.batch_no}` : "",
		serials.length
			? `序列号 ${serials.slice(0, 3).join("、")}${serials.length > 3 ? ` +${serials.length - 3}` : ""}`
			: "",
	]
		.filter(Boolean)
		.join(" · ");
};
const tableRows = computed<DataTableEntry[]>(() =>
	c.visibleRows.value.map((row: ImportRow) => ({
		kind: "record" as const,
		id: String(row.row),
		value: {
			...row,
			name: (row as any).item_name || row.values.item_name || row.target || "",
			code: rowCode(row),
			issues: [...row.errors, ...row.warnings].join("；"),
			qty: qtyText(row),
			valuation_rate: (row as any).valuation_rate ?? "",
			line_value: (row as any).line_value ?? "",
			location_label: (row as any).location_label ?? "",
			batch_no: (row as any).batch_no || "—",
			serials:
				((row as any).serials || []).slice(0, 3).join("、") +
				(((row as any).serials || []).length > 3
					? ` +${(row as any).serials.length - 3}`
					: ""),
			detail: !hasChanges(row)
				? ""
				: c.expanded.value.includes(Number(row.row))
					? "收起"
					: "查看",
		},
	})),
);
const actionIcons: Record<string, string> = {
	NEW: "receive",
	UPDATE: "adjust",
	UNCHANGED: "select",
	REJECTED: "warning",
};
const actionKeys = computed(() =>
	isOpening.value
		? ["NEW", "UNCHANGED", "REJECTED"]
		: ["NEW", "UPDATE", "UNCHANGED", "REJECTED"],
);
const visibleActionLabels = computed(() => (isOpening.value ? openingActionLabels : actionLabels));
const statusClass = (action: string) =>
	({ NEW: "is-success", UPDATE: "is-warning", UNCHANGED: "is-neutral", REJECTED: "is-danger" })[
		action
	] || "is-neutral";
const labelFor = (action: unknown) => visibleActionLabels.value[String(action)] || "无法导入";
const rowFor = (row: Record<string, unknown>) => row as unknown as ImportRow;
const compare = (row: ImportRow) =>
	itemImportColumns
		.filter((column) => row.before[column.key] !== row.after[column.key])
		.map(
			(column) =>
				`${column.label}：${String(row.before[column.key] || "空")} → ${String(row.after[column.key] || "空")}`,
		)
		.join("；");
function toggle(row: number) {
	c.expanded.value = c.expanded.value.includes(row)
		? c.expanded.value.filter((x) => x !== row)
		: [...c.expanded.value, row];
}
const downloadReport = (kind = "all") =>
	c.download(`report?name=${encodeURIComponent(c.preview.value?.name || "")}&kind=${kind}`);
const resultCounts = computed(() => c.preview.value?.counts || {});
const canUpload = computed(
	() =>
		Boolean(c.file.value) &&
		(!isOpening.value || Boolean(c.postingDate.value && c.postingTime.value)),
);
const generatedCodes = computed(() =>
	(c.preview.value?.rows || [])
		.filter((row) => row.action === "NEW" && row.item_code)
		.map((row) => row.item_code),
);
const downloadRejected = () => downloadReport("rejected");
</script>
<template>
	<main class="import-wizard">
		<header class="import-heading">
			<div>
				<h1>{{ isOpening ? "期初库存导入" : "物品导入" }}</h1>
				<p>
					{{
						isOpening
							? "一次导入创建一张期初库存单据；预览不会写入库存。"
							: "下载模板，核对物品目录，预览变更后再提交。"
					}}
				</p>
			</div>
			<div class="import-downloads">
				<UiButton
					variant="secondary"
					@click="c.download(isOpening ? 'opening_template' : 'item_template')"
					>下载模板</UiButton
				><UiButton
					variant="secondary"
					@click="c.download(isOpening ? 'opening_catalog' : 'item_catalog')"
					>{{ isOpening ? "下载物品目录（获取物品编号）" : "下载物品目录" }}</UiButton
				>
			</div>
		</header>
		<ol class="import-steps" aria-label="导入步骤">
			<li :class="{ active: c.step.value === 'start' }">1 上传文件</li>
			<li :class="{ active: c.step.value === 'preview' }">2 检查预览</li>
			<li :class="{ active: ['running', 'result'].includes(c.step.value) }">3 确认与结果</li>
		</ol>
		<section v-if="c.step.value === 'start'" class="import-upload surface">
			<p class="import-upload-hint">
				填写好的{{ isOpening ? "期初库存" : "物品" }}模板（.xlsx，最多 5 MB、5,000 行）
			</p>
			<div v-if="isOpening" class="opening-posting-fields">
				<label>期初日期<input v-model="c.postingDate.value" type="date" required /></label>
				<label
					>时间<input v-model="c.postingTime.value" type="time" step="1" required
				/></label>
			</div>
			<input
				ref="fileInput"
				id="item-import-file"
				class="import-file-input"
				type="file"
				:aria-label="`选择${isOpening ? '期初库存' : '物品'}模板`"
				accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				@change="c.file.value = ($event.target as HTMLInputElement).files?.[0]"
			/>
			<div class="import-file-row">
				<UiButton variant="secondary" icon="document" @click="fileInput?.click()"
					>选择文件</UiButton
				><span>{{ c.file.value?.name || "尚未选择文件" }}</span>
			</div>
			<p v-if="c.error.value" role="alert">{{ c.error.value }}</p>
			<div class="import-actions">
				<span v-if="!canUpload" class="import-upload-hint">{{
					isOpening && !(c.postingDate.value && c.postingTime.value)
						? "请先填写期初日期和时间"
						: "请先选择文件"
				}}</span>
				<UiButton
					variant="primary"
					:disabled="!canUpload"
					:loading="c.busy.value"
					@click="c.upload"
					>上传并预览</UiButton
				>
			</div>
		</section>
		<section v-else-if="c.preview.value" class="import-preview">
			<div v-if="c.step.value === 'running'" class="surface import-running" role="status">
				<strong>正在处理导入任务</strong>
				<p>页面重新打开后会继续读取任务状态。</p>
				<progress
					v-if="c.preview.value.progress?.percent"
					:value="c.preview.value.progress.percent"
					max="100"
					:aria-label="`导入进度 ${c.preview.value.progress.percent}%`"
				/>
				<UiButton variant="secondary" @click="c.refresh">刷新状态</UiButton>
			</div>
			<section v-if="c.step.value === 'result'" class="surface import-result">
				<h2>
					{{
						c.preview.value.status === "Completed"
							? "导入完成"
							: c.preview.value.status === "Conflict"
								? "数据已变化，请重新预览"
								: "导入未完成"
					}}
				</h2>
				<p v-if="c.preview.value.error" role="alert">{{ c.preview.value.error }}</p>
				<template v-if="isOpening">
					<p>
						期初日期 {{ c.preview.value.posting_date }} ·
						{{ postingTime(String(c.preview.value.posting_time || "")) }} · 差额科目
						{{ c.preview.value.difference_account || "未设置" }}
					</p>
					<p>
						按单位数量：<span
							v-for="(quantity, unit) in c.preview.value.totals_by_unit"
							:key="unit"
							>{{ formatQuantity(quantity) }} {{ unit }} </span
						>· 总估值 {{ c.preview.value.total_value }}
					</p>
					<p v-if="c.preview.value.created_documents?.length">
						期初库存单据：<RouterLink
							v-for="name in c.preview.value.created_documents"
							:key="name"
							:to="{ name: 'count-detail', params: { name } }"
							>{{ name }}</RouterLink
						>
					</p>
				</template>
				<p v-else>
					新建 {{ resultCounts.new || 0 }} · 更新 {{ resultCounts.update || 0 }} · 无变化
					{{ resultCounts.unchanged || 0 }} · 无法导入 {{ resultCounts.rejected || 0 }}
				</p>
				<p v-if="!isOpening && generatedCodes.length" class="generated-codes">
					生成的物品编号：{{ generatedCodes.join("、") }}
				</p>
				<UiButton
					v-if="c.preview.value.status === 'Conflict'"
					:loading="c.busy.value"
					@click="c.repreview"
					>重新预览</UiButton
				><UiButton
					v-if="c.preview.value.status === 'Failed'"
					:loading="c.busy.value"
					@click="c.retry"
					>重新规划</UiButton
				><UiButton
					v-if="c.preview.value.status === 'Completed'"
					variant="secondary"
					@click="downloadReport"
					>下载结果</UiButton
				>
				<UiButton
					v-if="c.preview.value.status === 'Completed'"
					variant="ghost"
					@click="c.reset"
					>再次导入</UiButton
				>
			</section>
			<template v-if="c.step.value !== 'running'">
				<div
					v-if="isOpening && c.step.value !== 'result'"
					class="surface opening-preview-context"
				>
					<p>
						期初日期 {{ c.preview.value.posting_date }} ·
						{{ postingTime(String(c.preview.value.posting_time || "")) }} · 差额科目
						{{ c.preview.value.difference_account || "未设置" }}
					</p>
					<p>
						预计数量：<span
							v-for="(quantity, unit) in c.preview.value.totals_by_unit"
							:key="unit"
							>{{ formatQuantity(quantity) }} {{ unit }} </span
						>· 总估值 {{ c.preview.value.total_value }}
					</p>
					<p>导入期间这些位置的其他操作会等待，大批量导入请在空闲时进行。</p>
					<p>
						位置：{{
							[
								...new Set(
									c.preview.value.rows
										.map((row: any) => row.location_label)
										.filter(Boolean),
								),
							].join("、") || "—"
						}}
					</p>
				</div>
				<section class="import-summary" aria-label="预览数量">
					<button
						v-for="action in actionKeys"
						:key="action"
						type="button"
						class="import-tile surface"
						:class="statusClass(action)"
						@click="c.filter.value = c.filter.value === action ? 'all' : action"
					>
						<InventoryIcon :name="actionIcons[action] || 'info'" /><strong>{{
							c.preview.value.counts[action.toLowerCase()] || 0
						}}</strong
						><span>{{ visibleActionLabels[action] }}</span>
					</button>
				</section>
				<div class="import-tools">
					<input
						v-model="c.query.value"
						type="search"
						placeholder="搜索物品名称、编号或错误"
						aria-label="搜索预览"
					/><select v-model="c.filter.value" aria-label="按处理结果筛选">
						<option value="all">全部结果</option>
						<option v-for="action in actionKeys" :key="action" :value="action">
							{{ visibleActionLabels[action] }}
						</option>
					</select>
				</div>
				<div v-if="isPhone" class="import-cards">
					<article
						v-for="row in c.visibleRows.value"
						:key="row.row"
						class="surface import-card"
					>
						<div>
							<strong>{{
								(row as any).item_name ||
								row.values.item_name ||
								row.target ||
								"未填写名称"
							}}</strong
							><span class="browse-badge" :class="statusClass(String(row.action))">{{
								labelFor(row.action)
							}}</span>
						</div>
						<small>第 {{ row.row }} 行 · {{ rowCode(row) }}</small>
						<p v-if="isOpening">{{ openingMeta(row) }}</p>
						<p v-if="row.errors.length" class="is-danger">
							{{ row.errors.join("；") }}
						</p>
						<p v-if="row.warnings.length">{{ row.warnings.join("；") }}</p>
						<UiButton
							v-if="hasChanges(row)"
							variant="ghost"
							@click="toggle(Number(row.row))"
							>{{
								c.expanded.value.includes(Number(row.row))
									? "收起前后对比"
									: "查看前后对比"
							}}</UiButton
						>
						<p
							v-if="c.expanded.value.includes(Number(row.row))"
							class="import-compare"
						>
							{{ compare(row) }}
						</p>
					</article>
				</div>
				<DataTable
					v-else
					:ariaLabel="`${isOpening ? '期初库存' : '物品'}导入预览`"
					:columns="columns"
					:rows="tableRows"
					empty-text="没有符合条件的行"
					compact
				>
					<template #cell="{ column, row, value }"
						><template v-if="column.id === 'action'"
							><span class="browse-badge" :class="statusClass(String(row.action))">{{
								labelFor(row.action)
							}}</span></template
						><template v-else-if="column.id === 'name'"
							>{{ value }}
							<p
								v-if="c.expanded.value.includes(Number(row.row))"
								class="import-compare"
							>
								{{ compare(rowFor(row)) }}
							</p></template
						><template v-else-if="column.id === 'issues'"
							><span :class="rowFor(row).errors.length ? 'is-danger' : ''">{{
								value || "—"
							}}</span></template
						><template v-else-if="column.id === 'detail'"
							><button
								v-if="value"
								class="link-button"
								type="button"
								@click="toggle(Number(row.row))"
							>
								{{ value }}
							</button></template
						><template v-else>{{ value }}</template></template
					>
				</DataTable>
				<p v-if="c.error.value" role="alert">{{ c.error.value }}</p>
				<div v-if="c.step.value === 'preview'" class="import-actions">
					<UiButton variant="secondary" @click="c.reset">重新上传</UiButton
					><UiButton
						v-if="c.rejected.value"
						variant="secondary"
						@click="downloadRejected"
						>下载无法导入的行</UiButton
					><UiButton
						variant="primary"
						:disabled="c.busy.value"
						@click="confirmOpen = true"
						>确认导入</UiButton
					>
				</div>
			</template>
		</section>
		<Overlay
			v-if="confirmOpen"
			:title="isOpening ? '确认导入期初库存' : '确认导入物品'"
			@close="confirmOpen = false"
			><p>
				<template v-if="isOpening"
					>将导入 {{ c.preview?.value?.counts.new || 0 }} 行，涉及位置
					{{
						[
							...new Set(
								c.preview?.value?.rows
									.map((row: any) => row.location_label)
									.filter(Boolean) || [],
							),
						].join("、")
					}}；期初日期 {{ c.preview?.value?.posting_date }}
					{{ postingTime(String(c.preview?.value?.posting_time || "")) }}；差额科目
					{{
						c.preview?.value?.difference_account
					}}。确认后将写入库存和会计记录。</template
				>
				<template v-else
					>将新建 {{ c.preview?.value?.counts.new || 0 }} 行、更新
					{{ c.preview?.value?.counts.update || 0 }} 行、保持无变化
					{{ c.preview?.value?.counts.unchanged || 0 }} 行。</template
				>
			</p>
			<p v-if="isOpening">导入期间这些位置的其他操作会等待，大批量导入请在空闲时进行。</p>
			<label v-if="c.rejected.value" class="skip-rejected"
				><input v-model="c.skipRejected.value" type="checkbox" />跳过
				{{ c.rejected.value }} 行无法导入的行</label
			>
			<p v-if="c.error.value" role="alert">{{ c.error.value }}</p>
			<template #footer
				><UiButton variant="secondary" @click="confirmOpen = false">取消</UiButton
				><UiButton
					variant="primary"
					:disabled="c.rejected.value > 0 && !c.skipRejected.value"
					:loading="c.busy.value"
					@click="
						confirmOpen = false;
						c.commit();
					"
					>提交导入</UiButton
				></template
			></Overlay
		>
	</main>
</template>
<script lang="ts">
import InventoryIcon from "../../components/InventoryIcon.vue";
export default { components: { InventoryIcon } };
</script>
<style scoped>
.import-wizard {
	display: grid;
	gap: var(--p-gap);
}
.import-heading,
.import-downloads,
.import-steps,
.import-tools,
.import-actions,
.import-summary,
.import-card > div {
	display: flex;
	align-items: center;
	gap: var(--p-control-gap);
}
.import-heading {
	justify-content: space-between;
	flex-wrap: wrap;
}
h1 {
	margin: 0;
}
.import-heading p {
	color: var(--p-muted);
	margin: 4px 0 0;
}
.import-steps {
	list-style: none;
	padding: 0;
	color: var(--p-muted);
}
.import-steps li {
	padding: var(--p-control-pad-y) var(--p-control-gap);
	border-bottom: 2px solid var(--p-border);
}
.import-steps .active {
	color: var(--p-ink);
	border-color: var(--p-accent);
}
.import-upload,
.import-running,
.import-result {
	display: grid;
	gap: var(--p-control-gap);
	padding: var(--p-pad);
}
.import-result {
	justify-items: start;
}
.opening-preview-context {
	display: grid;
	gap: var(--p-field-gap);
	padding: var(--p-card-inner-pad);
}
.opening-preview-context p {
	margin: 0;
}
.import-upload-hint {
	margin: 0;
	color: var(--p-muted);
}
.import-file-input {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	opacity: 0;
}
.import-file-row {
	display: flex;
	align-items: center;
	gap: var(--p-control-gap);
	min-width: 0;
}
.import-file-row span {
	min-width: 0;
	overflow-wrap: anywhere;
}
.import-summary {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
}
.import-tile {
	display: grid;
	grid-template-columns: 28px 1fr;
	align-items: center;
	gap: var(--p-field-gap) var(--p-control-gap);
	padding: var(--p-card-inner-pad);
	text-align: left;
	border: 1px solid var(--p-border);
	color: var(--p-ink);
}
.import-tile strong {
	font-size: 1.4rem;
}
.import-tile.is-success {
	color: var(--p-success);
}
.import-tile.is-warning {
	color: var(--p-warning);
}
.import-tile span {
	grid-column: 2;
	color: var(--p-muted);
}
.import-tools {
	flex-wrap: wrap;
	margin-top: var(--p-field-gap);
}
.import-tools input {
	flex: 1 1 240px;
	min-height: 44px;
}
.import-tools select {
	flex: 0 0 200px;
	width: 200px;
	min-height: 44px;
}
.import-preview {
	display: grid;
	gap: var(--p-control-gap);
}
.import-actions {
	justify-content: flex-end;
	flex-wrap: wrap;
	margin-top: var(--p-gap);
}
.import-cards {
	display: grid;
	gap: var(--p-field-gap);
}
.import-card {
	padding: var(--p-card-inner-pad);
	display: grid;
	gap: var(--p-field-gap);
}
.import-card > div {
	justify-content: space-between;
}
.import-card p {
	margin: 0;
}
.is-danger {
	color: var(--p-danger);
}
.import-compare {
	margin: 4px 0 0;
	color: var(--p-muted);
	white-space: normal;
	overflow-wrap: anywhere;
}
.link-button {
	color: var(--p-accent);
	background: none;
	border: 0;
	text-decoration: underline;
	cursor: pointer;
}
.skip-rejected {
	display: flex;
	gap: var(--p-control-gap);
	min-height: 44px;
	align-items: center;
}
@media (max-width: 767px) {
	.import-heading {
		align-items: flex-start;
	}
	.import-downloads {
		width: 100%;
	}
	.import-downloads > * {
		flex: 1;
	}
	.import-summary {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.import-steps {
		font-size: 0.84rem;
		gap: var(--p-field-gap);
	}
	.import-actions > * {
		flex: 1;
	}
	.import-tools select {
		flex: 1 1 100%;
		width: 100%;
	}
}
</style>
