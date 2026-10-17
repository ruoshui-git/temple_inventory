<script setup lang="ts">
import { ref } from "vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import UiButton from "../../components/ui/UiButton.vue";
import ItemPicker from "../items/ItemPicker.vue";
import type { CountEditor } from "./useCountEditor";
const props = defineProps<{ controller: CountEditor }>();
const c = props.controller;
const {
	values,
	rows,
	names,
	reference,
	writable,
	busy,
	baselineBusy,
	baselineError,
	summary,
	removed,
	removalAcknowledged,
	currentBaseline,
	issues,
	showError,
} = c;
const pendingLocation = ref(""),
	changeOpen = ref(false),
	pickerOpen = ref(false);
function useLocation(value: string) {
	if (value === values.value.ti_count_warehouse) return;
	if (rows.value.some((row) => row.actual_qty !== null)) {
		pendingLocation.value = value;
		changeOpen.value = true;
	} else void applyLocation(value);
}
async function applyLocation(value: string) {
	values.value.ti_count_warehouse = value;
	values.value.ti_count_review = [];
	values.value.ti_baseline_fingerprint = "";
	removed.value = [];
	removalAcknowledged.value = true;
	changeOpen.value = false;
	if (values.value.ti_count_scope === "Full Location" || values.value.ti_count_items.length)
		await c.refresh();
}
</script>
<template>
	<section class="form-section">
		<h2>盘点范围</h2>
		<template v-if="writable"
			><SearchSelect
				label="盘点库位"
				:model-value="values.ti_count_warehouse"
				:options="reference.physicalLeaves"
				:disabled="busy || baselineBusy"
				@update:model-value="useLocation"
			/>
			<div v-if="changeOpen" role="alert">
				更换库位将清除本次盘点输入。<UiButton @click="changeOpen = false"
					>保留当前盘点</UiButton
				><UiButton @click="applyLocation(pendingLocation)">更换并清除</UiButton>
			</div>
			<label class="preview-field"
				>盘点方式<select v-model="values.ti_count_scope" :disabled="busy || baselineBusy">
					<option value="Selected">选定物品</option>
					<option value="Full Location">整个库位</option>
				</select></label
			><UiButton
				v-if="values.ti_count_scope === 'Selected'"
				:disabled="busy || baselineBusy || !values.ti_count_warehouse"
				@click="pickerOpen = true"
				>添加盘点物品</UiButton
			><UiButton :disabled="busy || baselineBusy" :loading="baselineBusy" @click="c.refresh"
				>刷新账面基准</UiButton
			></template
		>
		<UiButton v-if="!writable && c.canRefresh.value" :loading="baselineBusy" @click="c.refresh"
			>刷新账面基准并检查原生版本</UiButton
		>
		<dl v-if="!writable" class="preview-info-grid">
			<div>
				<dt>盘点库位</dt>
				<dd>{{ values.ti_count_warehouse }}</dd>
			</div>
			<div>
				<dt>盘点方式</dt>
				<dd>{{ values.ti_count_scope === "Selected" ? "选定物品" : "整个库位" }}</dd>
			</div>
		</dl>
		<p role="status">已核对 {{ summary.reviewed }} / {{ rows.length }} 行 · 留空不调整库存</p>
		<p class="muted">账面基准：{{ values.ti_baseline_timestamp || "尚未读取" }}</p>
		<p v-if="writable && !currentBaseline" role="status">
			盘点范围或时间已更改，请刷新账面基准后核对。
		</p>
		<p v-if="baselineError" role="alert">{{ baselineError }}</p>
		<section v-if="removed.length" class="notice-bar warning">
			<h3>已移出账面范围的原输入</h3>
			<p>以下输入保留供核对，不再纳入本次调整。</p>
			<p v-for="(row, index) in removed" :key="index">
				{{ row.item_code }} · {{ row.warehouse }} · {{ row.batch_no || "无批次" }} · 原账面
				{{ row.baseline_qty }} · 实点
				{{ row.actual_qty === null ? "未核对" : row.actual_qty }} {{ row.stock_uom }} ·
				{{ row.reason }}
			</p>
			<label v-if="writable" class="preview-choice-label"
				><input type="checkbox" v-model="removalAcknowledged" />已核对移出的输入</label
			>
		</section>
		<article
			v-for="row in rows"
			:key="c.countKey(row)"
			class="preview-count-row"
			:data-count-key="c.countKey(row)"
		>
			<strong
				>{{ names[row.item_code] || row.item_code
				}}<small>{{ row.item_code }} · {{ row.batch_no || "无批次" }}</small></strong
			><span>账面 {{ row.baseline_qty }} {{ row.stock_uom }}</span
			><label v-if="writable" class="preview-field"
				>实点<input
					type="number"
					min="0"
					:step="
						reference.units.find((unit) => unit.name === row.stock_uom)?.whole
							? 1
							: 'any'
					"
					:value="row.actual_qty"
					:disabled="busy || baselineBusy"
					:aria-label="`${names[row.item_code] || row.item_code}实点数量`"
					:aria-invalid="
						showError && issues.some((issue) => issue.key === c.countKey(row))
					"
					@input="c.input(row, ($event.target as HTMLInputElement).value)" /></label
			><span v-else
				>实点 {{ row.review_state === "Unreviewed" ? "未核对" : row.actual_qty }}
				{{ row.stock_uom }}</span
			><span
				>差异
				{{
					row.review_state === "Unreviewed" || row.actual_qty === null
						? "待核对"
						: row.actual_qty - row.baseline_qty
				}}<span v-if="row.review_state === 'Not Found'"> · 未找到</span></span
			><UiButton v-if="writable" :disabled="busy || baselineBusy" @click="c.notFound(row)"
				>未找到</UiButton
			><label
				v-if="writable && row.actual_qty !== null && row.actual_qty !== row.baseline_qty"
				class="preview-field"
				>差异原因<input v-model="row.reason" :disabled="busy || baselineBusy"
			/></label>
			<p v-else-if="row.reason">原因：{{ row.reason }}</p>
			<div v-if="row.needs_review && row.actual_qty !== null && writable" role="alert">
				账面基准已更改，请核对保留的实点数量。<UiButton @click="c.rereview(row)"
					>已重新核对此行</UiButton
				>
			</div>
			<p
				v-if="showError && issues.some((issue) => issue.key === c.countKey(row))"
				role="alert"
			>
				{{ issues.find((issue) => issue.key === c.countKey(row))?.message }}
			</p>
		</article>
		<p v-if="!rows.length" class="muted">选择库位和需要盘点的物品。</p>
		<ItemPicker
			v-if="pickerOpen"
			mode="add-multiple"
			@close="pickerOpen = false"
			@select-multiple="
				(codes) => {
					pickerOpen = false;
					c.chooseItems(codes);
				}
			"
		/>
	</section>
</template>
<style scoped>
.preview-count-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px;
	padding: 12px 0;
	border-bottom: 1px solid var(--p-border);
}
.preview-count-row strong {
	flex: 1 1 180px;
}
.preview-count-row label {
	display: grid;
	max-width: 160px;
}
small {
	display: block;
	font-weight: normal;
}
</style>
