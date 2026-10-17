<script setup lang="ts">
import { warehouseLabel } from "../../lib/warehouseLabel";
import QuickExport from "../../components/QuickExport.vue";
import type { ReportQuery } from "../../lib/reportContract";
import { computed, ref } from "vue";
import type { CountEditor } from "./useCountEditor";
import CountWorkspace from "./CountWorkspace.vue";
import CountSummary from "./CountSummary.vue";
import NativeCountAllocations from "./NativeCountAllocations.vue";
import TransactionContext from "../documents/TransactionContext.vue";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import Attachments from "../../components/Attachments.vue";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
const props = withDefaults(defineProps<{ controller: CountEditor; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{ back: []; newCount: []; openExport: [query: ReportQuery] }>();
const c = props.controller;
const {
	values,
	rows,
	state,
	activityLabel,
	loading,
	busy,
	writable,
	valid,
	files,
	deskOrigin,
	opening,
	finished,
	showError,
	reviewOpen,
	action,
	candidates,
	supportingDirty,
	reloadOpen,
	leaveRequested,
} = c;
const root = ref<HTMLElement>(),
	actions = ref<HTMLElement>();
useFocusVisibility(
	root,
	actions,
	() => true,
	() => props.active !== false,
);
const context = computed(() => ({
	kind: "Reconcile",
	get activity() {
		return values.value.ti_activity;
	},
	set activity(value: string) {
		values.value.ti_activity = value;
	},
	source: "",
	purpose: "",
	loanName: "",
}));
const status = computed(
	() =>
		({
			matching: "已核对，无需调整",
			local: "此浏览器未完成输入",
			saving: "正在保存原生草稿…",
			saved: "原生草稿已保存",
			error: "保存失败，输入已保留",
			conflict: "原生记录已更改，输入已保留",
			deleted: "原生记录已删除",
			forbidden: "无权访问原记录",
			submitted: "已提交",
			cancelled: "已取消",
		})[state.status],
);
async function back() {
	if (await c.requestLeave()) emit("back");
}
async function copy(value = c.recoveryText.value) {
	try {
		await navigator.clipboard.writeText(value);
	} catch {
		state.error = "请选中下方恢复文字并复制";
	}
}
</script>
<template>
	<section ref="root" class="preview-form-page">
		<div class="form-page-heading">
			<div>
				<h1>{{ opening ? "期初库存" : state.identity ? "盘点记录" : "新建盘点" }}</h1>
				<p class="muted">按库存单位核对；留空表示尚未核对，零表示实点为零。</p>
			</div>
			<div class="form-actions">
				<QuickExport
					v-if="!loading && c.savedExportQuery.value"
					:query="c.savedExportQuery.value"
					:active="active"
					@open-full="emit('openExport', $event)"
				/><UiButton @click="back">返回</UiButton>
			</div>
		</div>
		<div class="form-status">
			<span class="form-record-tag">{{
				state.identity
					? `${state.identity.doctype} · ${state.identity.name}`
					: "尚未创建原生记录"
			}}</span
			><span role="status">{{ status }}</span
			><UiButton
				v-if="state.identity"
				:disabled="busy"
				@click="c.dirty.value ? (reloadOpen = true) : c.load(true)"
				>重新读取</UiButton
			>
		</div>
		<p v-if="loading" role="status">正在读取盘点…</p>
		<p v-if="state.error" class="notice-bar danger" role="alert">{{ state.error }}</p>
		<p v-if="state.recoveryError" role="alert">{{ state.recoveryError }}</p>
		<section v-if="candidates.length" class="surface form-section">
			<h2>此浏览器的未完成盘点</h2>
			<p>仅在当前浏览器和账户可用，未改变库存。</p>
			<div v-for="candidate in candidates" :key="candidate.editorId">
				<p>{{ candidate.updatedAt }} · {{ candidate.identity?.name || "本地输入" }}</p>
				<UiButton @click="c.recover(candidate)">检查并恢复</UiButton
				><UiButton @click="copy(JSON.stringify(candidate.values, null, 2))"
					>复制恢复文字</UiButton
				>
			</div>
		</section>
		<section
			v-if="['conflict', 'deleted', 'forbidden'].includes(state.status)"
			class="notice-bar warning"
		>
			<p>原生记录不可继续保存，当前输入已保留。</p>
			<pre class="preview-long-text" tabindex="0">{{ c.recoveryText.value }}</pre>
			<UiButton @click="copy()">复制输入</UiButton>
		</section>
		<section v-if="state.status === 'matching'" class="notice-bar success">
			<h2>已核对的数量一致，无需库存调整</h2>
			<p>未创建新的原生记录；未核对的行仍是未完成输入。</p>
			<p v-if="state.identity">
				原有草稿 {{ state.identity.name }} 保持原样。请明确删除该草稿，或继续编辑。
			</p>
			<UiButton
				v-if="
					state.identity &&
					(state.server?.permissions as Record<string, boolean>)?.delete
				"
				@click="action = 'delete'"
				>删除原有原生草稿</UiButton
			>
			<p v-if="files.files.length">无需调整的盘点没有附件父记录，请移除附件后结束。</p>
			<UiButton
				v-if="!state.identity"
				:disabled="!!files.files.length || !valid"
				@click="c.finishMatching"
				>结束本次核对</UiButton
			>
		</section>
		<p v-if="finished" role="status">
			本次核对已结束。<UiButton @click="emit('newCount')">新建盘点</UiButton>
		</p>
		<div v-if="state.identity" class="form-actions">
			<a
				:href="`/app/stock-reconciliation/${encodeURIComponent(state.identity.name)}`"
				target="_blank"
				rel="noopener"
				>在 ERPNext 查看</a
			><UiButton
				v-if="
					state.server?.docstatus === 1 &&
					(state.server.permissions as Record<string, boolean>)?.cancel
				"
				@click="action = 'cancel'"
				>取消原生记录</UiButton
			><UiButton
				v-if="
					state.server?.docstatus === 2 &&
					!opening &&
					(state.server.permissions as Record<string, boolean>)?.amend
				"
				@click="action = 'amend'"
				>创建修订草稿</UiButton
			>
		</div>
		<div v-if="!loading" class="form-layout">
			<form class="form-main surface" novalidate @submit.prevent="c.review">
				<section class="form-section form-date-section">
					<label v-if="writable" class="preview-field"
						>操作日期<input
							type="date"
							v-model="values.posting_date"
							:disabled="busy" /></label
					><label v-if="writable" class="preview-field"
						>操作时间<input
							type="time"
							step="1"
							v-model="values.posting_time"
							:disabled="busy"
					/></label>
					<p v-else>{{ values.posting_date }} {{ values.posting_time }}</p>
					<p class="muted">账面基准使用这个明确时间点的原生库存记录。</p>
				</section>
				<CountWorkspace v-if="!deskOrigin" :controller="c" />
				<section v-else class="form-section">
					<h2>{{ opening ? "原生期初明细" : "ERPNext 原生盘点明细" }}</h2>
					<p>此记录没有完整库位的核对范围，以下显示其实际原生明细。</p>
					<article
						v-for="(row, index) in values.items"
						:key="String(row.name || index)"
						class="preview-count-row"
					>
						<strong>{{ c.names[String(row.item_code)] || row.item_code }}</strong
						><span
							>{{ warehouseLabel(row.warehouse, c.reference.warehouses)
							}}<template v-if="row.batch_no"> · {{ row.batch_no }}</template></span
						><span>原生账面 {{ row.current_qty ?? "未记录" }} {{ row.stock_uom }}</span
						><label v-if="writable" class="preview-field"
							>实点<input
								type="number"
								min="0"
								step="any"
								v-model.number="row.qty"
								:disabled="busy" /></label
						><span v-else>实点 {{ row.qty }} {{ row.stock_uom }}</span>
						<p v-if="row.serial_and_batch_bundle">
							原生批次组合：{{ row.serial_and_batch_bundle }}
						</p>
						<NativeCountAllocations :row="row" />
					</article>
				</section>
				<details class="form-section">
					<summary>补充记录（可选）</summary>
					<TransactionContext
						:draft="context"
						:activity-label="activityLabel"
						:mode="writable ? 'edit' : 'display'"
						:disabled="busy"
						@dirty-change="supportingDirty = $event"
					/><Attachments
						:controller="files"
						:mode="writable ? 'edit' : 'display'"
						:disabled="!writable || busy"
					/>
					<div v-if="writable" class="form-fields">
						<label class="preview-field"
							>记录人<input
								v-model="values.ti_recorder_name"
								:disabled="busy" /></label
						><label class="preview-field"
							>经手人<input
								v-model="values.ti_handler_name"
								:disabled="busy" /></label
						><label class="preview-field"
							>鉴证人<input
								v-model="values.ti_reviewer_name"
								:disabled="busy" /></label
						><label class="preview-field full-field"
							>备注<textarea v-model="values.remarks" rows="3" :disabled="busy" />
						</label>
					</div>
					<div v-else>
						<p>
							记录人：{{ values.ti_recorder_name || "未填写" }} · 经手人：{{
								values.ti_handler_name || "未填写"
							}}
							· 鉴证人：{{ values.ti_reviewer_name || "未填写" }}
						</p>
						<p class="preview-long-text">{{ values.remarks }}</p>
					</div>
				</details>
				<p v-if="showError && !valid" role="alert" class="form-error">
					请先读取当前账面基准，至少核对一行，并填写差异原因。输入已保留。
				</p>
				<div
					v-if="writable || state.confirmationVersion"
					ref="actions"
					class="form-actions preview-document-actions"
				>
					<span role="status">{{ status }}</span
					><UiButton
						v-if="!state.confirmationVersion"
						:disabled="busy || supportingDirty"
						@click="c.save(true)"
						>保存草稿</UiButton
					><UiButton
						v-if="!state.confirmationVersion"
						variant="primary"
						type="submit"
						:disabled="busy || supportingDirty"
						>核对并确认</UiButton
					><UiButton
						v-else
						variant="primary"
						:disabled="c.hasDifferences.value && !c.canSubmit.value"
						:loading="busy"
						@click="c.confirm"
						>检查上次确认结果</UiButton
					><UiButton
						v-if="
							state.identity &&
							(state.server?.permissions as Record<string, boolean>)?.delete
						"
						:disabled="busy"
						@click="action = 'delete'"
						>删除原生草稿</UiButton
					>
				</div>
			</form>
			<aside class="form-review surface">
				<span class="eyebrow">确认前检查</span>
				<h2>盘点汇总</h2>
				<CountSummary
					v-if="!deskOrigin"
					:rows="rows"
					:location="values.ti_count_warehouse"
				/>
				<p v-else>{{ values.items.length }} 行原生盘点明细；没有完整库位核对声明。</p>
				<p class="muted">仅已核对的差异会变更库存；数量一致时不创建调整记录。</p>
			</aside>
		</div>
		<Overlay v-if="reviewOpen" title="核对并确认盘点" @close="!busy && (reviewOpen = false)"
			><CountSummary v-if="!deskOrigin" :rows="rows" :location="values.ti_count_warehouse" />
			<p>{{ values.posting_date }} {{ values.posting_time }}</p>
			<p v-if="!deskOrigin" v-for="row in rows" :key="c.countKey(row)">
				{{ c.names[row.item_code] || row.item_code }} ·
				{{ warehouseLabel(row.warehouse, c.reference.warehouses) }} ·
				{{ row.batch_no || "无批次" }} · 账面 {{ row.baseline_qty }} · 实点
				{{ row.review_state === "Unreviewed" ? "尚未核对" : row.actual_qty }}
				{{ row.stock_uom }} · {{ row.reason }}
			</p>
			<div v-else v-for="(row, index) in values.items" :key="String(row.name || index)">
				<p>
					{{ row.item_code }} ·
					{{ warehouseLabel(row.warehouse, c.reference.warehouses) }} ·
					{{ row.batch_no || "原生明细" }} · 账面 {{ row.current_qty ?? "未记录" }} ·
					实点 {{ row.qty }} {{ row.stock_uom }}
				</p>
				<NativeCountAllocations :row="row" />
			</div>
			<TransactionContext :draft="context" :activity-label="activityLabel" mode="display" />
			<p>
				记录人：{{ values.ti_recorder_name || "未填写" }} · 经手人：{{
					values.ti_handler_name || "未填写"
				}}
				· 鉴证人：{{ values.ti_reviewer_name || "未填写" }}
			</p>
			<p class="preview-long-text">{{ values.remarks }}</p>
			<p v-if="state.error" role="alert">{{ state.error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="reviewOpen = false">返回检查</UiButton
				><UiButton
					variant="primary"
					:disabled="c.hasDifferences.value && !c.canSubmit.value"
					:loading="busy"
					@click="c.confirm"
					>确认提交</UiButton
				></template
			></Overlay
		>
		<Overlay v-if="reloadOpen" title="放弃输入并重新读取？" @close="reloadOpen = false">
			<pre class="preview-long-text">{{ c.recoveryText.value }}</pre>
			<template #footer
				><UiButton @click="copy()">复制输入</UiButton
				><UiButton @click="reloadOpen = false">继续编辑</UiButton
				><UiButton
					variant="danger"
					@click="
						reloadOpen = false;
						c.load(true);
					"
					>放弃并重新读取</UiButton
				></template
			></Overlay
		>
		<Overlay v-if="leaveRequested" title="离开当前盘点？" @close="c.finishLeave('stay')"
			><p>未完成输入仅能在此浏览器恢复，未上传文件需要重新选择。</p>
			<template #footer
				><UiButton @click="c.finishLeave('stay')">继续盘点</UiButton
				><UiButton @click="c.finishLeave('retain')">保留输入并离开</UiButton
				><UiButton variant="danger" @click="c.finishLeave('discard')"
					>放弃输入并离开</UiButton
				></template
			></Overlay
		>
		<Overlay
			v-if="action"
			:title="
				action === 'delete'
					? '删除原生草稿？'
					: action === 'cancel'
						? '取消原生盘点？'
						: '创建修订草稿？'
			"
			@close="!busy && (action = undefined)"
			><p>{{ state.identity?.name }}。将执行 ERPNext 原生流程，并重新校验版本与权限。</p>
			<p v-if="state.error" role="alert">{{ state.error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="action = undefined">返回</UiButton
				><UiButton variant="danger" :loading="busy" @click="c.lifecycle"
					>确认</UiButton
				></template
			></Overlay
		>
	</section>
</template>
