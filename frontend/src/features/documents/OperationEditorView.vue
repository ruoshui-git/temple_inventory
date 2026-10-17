<script setup lang="ts">
import { computed, ref } from "vue";
import type { OperationEditor } from "./useOperationEditor";
import { operationLabels } from "./operationCodec";
import OperationLines from "./OperationLines.vue";
import AllocationSummary from "./AllocationSummary.vue";
import TransactionContext from "./TransactionContext.vue";
import Attachments from "../../components/Attachments.vue";
import UiButton from "../../components/ui/UiButton.vue";
import Overlay from "../../components/ui/Overlay.vue";
import SearchSelect from "../../components/ui/SearchSelect.vue";
import RemoteSelect from "../../components/ui/RemoteSelect.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import { useExpandedEditor } from "../../composables/useExpandedEditor";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import { useFocusVisibility } from "../../composables/useFocusVisibility";
import { useInventoryServices } from "../../services/contracts";
import { newReportQuery } from "../../lib/reportContract";
const props = withDefaults(defineProps<{ controller: OperationEditor; active?: boolean }>(), {
	active: true,
});
const emit = defineEmits<{ back: []; notify: [message: string]; leave: [] }>();
const c = props.controller;
const {
	draft,
	state,
	reference,
	loading,
	busy,
	writable,
	dirty,
	files,
	issues,
	showError,
	reviewOpen,
	action,
	candidates,
} = c;
const formRoot = ref<HTMLElement>(),
	reviewBar = ref<HTMLElement>(),
	lineEditor = ref<InstanceType<typeof OperationLines>>();
const { expanded, toggle } = useExpandedEditor(formRoot, () => props.active !== false);
const { isMobile } = useResponsiveLayout();
useFocusVisibility(
	formRoot,
	reviewBar,
	() => isMobile.value || expanded.value,
	() => props.active !== false,
);
const receive = computed(() => draft.value.kind === "Receive"),
	title = computed(
		() => operationLabels[draft.value.kind] || String(state.server?.purpose || "库存记录"),
	);
const { supportingDirty, leaveRequested: leaveOpen } = c;
const detailsOpen = ref(false),
	reloadOpen = ref(false),
	loanChoice = ref("");
const services = useInventoryServices();
const itemCount = computed(() => new Set(draft.value.items.map((line) => line.code)).size);
const totals = computed(() => {
	const values = new Map<string, number>();
	for (const line of draft.value.items)
		values.set(line.uom, (values.get(line.uom) || 0) + Number(line.qty || 0));
	return [...values].map(([unit, qty]) => `${qty} ${unit}`).join(" · ");
});
const statusLabels = {
	matching: "已核对，无需调整",
	local: "此浏览器未完成输入",
	saving: "正在保存原生草稿…",
	saved: "原生草稿已保存",
	error: "保存失败，输入已保留",
	conflict: "记录已更改，输入已保留",
	deleted: "记录已删除",
	forbidden: "无权访问原记录",
	submitted: "已确认",
	cancelled: "已取消",
};
async function review() {
	await c.review();
	if (issues.value.length) await lineEditor.value?.revealIssue();
}
async function addLoan() {
	try {
		await c.appendLoan(loanChoice.value);
	} catch (reason) {
		state.error = reason instanceof Error ? reason.message : "借用读取失败";
	}
}
async function loans(search: string, start: number, signal: AbortSignal) {
	const query = newReportQuery("loans");
	query.view = "records";
	query.search = search;
	query.loanStatus = "outstanding";
	const page = await services.report(query, { start, page_length: 30 }, signal);
	return {
		rows: page.rows.map((row) => ({
			value: String(row.document || row.original_loan),
			label: `${row.borrower || ""} · ${row.document || row.original_loan}`,
			detail: String(row.activity_title || ""),
		})),
		total: page.matched_count,
		next: page.next_start,
	};
}
async function copy(text = c.recoveryText.value) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		state.error = "请选中恢复文字并复制";
	}
}
async function back() {
	if (await c.requestLeave()) emit("back");
}
</script>
<template>
	<section
		ref="formRoot"
		:class="[
			receive ? 'receive-example' : 'preview-form-page',
			{ 'workspace-expanded': expanded },
		]"
	>
		<div :class="receive ? 'page-heading' : 'form-page-heading'">
			<div>
				<span class="eyebrow">{{ receive ? "RECEIVE / 入库登记" : "货物流动" }}</span>
				<h1>{{ receive && !state.identity ? "把善意，妥善安放。" : title }}</h1>
				<p class="muted">
					{{
						receive
							? "一张清楚的入库记录，是物资流转的开始。"
							: "核对物品、数量、批次与库位，复核后确认。"
					}}
				</p>
			</div>
			<UiButton variant="ghost" @click="back">返回</UiButton>
		</div>
		<p v-if="loading" role="status">正在读取原生记录…</p>
		<div class="form-status">
			<span class="badge neutral">{{
				state.identity
					? `${state.identity.doctype} · ${state.identity.name}`
					: "尚未创建原生记录"
			}}</span
			><span role="status">{{ statusLabels[state.status] }}</span
			><UiButton
				v-if="state.identity && !busy"
				@click="dirty ? (reloadOpen = true) : c.load(true)"
				>重新读取</UiButton
			>
		</div>
		<p v-if="state.error" class="notice-bar danger" role="alert">{{ state.error }}</p>
		<p v-if="state.recoveryError" class="notice-bar warning" role="alert">
			{{ state.recoveryError }}
		</p>
		<div
			v-if="['conflict', 'deleted', 'forbidden'].includes(state.status)"
			class="notice-bar warning"
		>
			<p>当前输入保留在下方；请复制后核对原记录。</p>
			<pre class="preview-long-text" tabindex="0">{{ c.recoveryText.value }}</pre>
			<UiButton @click="copy()">复制输入</UiButton>
		</div>
		<section v-if="candidates.length" class="surface form-section">
			<h2>此浏览器的未完成输入</h2>
			<p class="muted">仅在此浏览器和当前账户可用，不会预留库存。</p>
			<div v-for="candidate in candidates" :key="candidate.editorId">
				<p>
					{{ candidate.updatedAt }} ·
					{{ candidate.identity?.name || "尚未创建原生记录" }}
				</p>
				<UiButton @click="c.recover(candidate)">检查并恢复</UiButton
				><UiButton @click="copy(JSON.stringify(candidate.values, null, 2))"
					>复制恢复文字</UiButton
				>
			</div>
		</section>
		<div v-if="!loading && state.server && !writable" class="form-actions">
			<a
				:href="`/app/${state.server.doctype === 'Stock Entry' ? 'stock-entry' : 'stock-reconciliation'}/${encodeURIComponent(state.server.name)}`"
				target="_blank"
				rel="noopener"
				>在 ERPNext 查看</a
			><UiButton
				v-if="
					state.server.docstatus === 1 &&
					(state.server.permissions as Record<string, boolean>)?.cancel
				"
				@click="action = 'cancel'"
				>取消原生记录</UiButton
			><UiButton
				v-if="
					state.server.docstatus === 2 &&
					(state.server.permissions as Record<string, boolean>)?.amend
				"
				@click="action = 'amend'"
				>创建修订草稿</UiButton
			><UiButton
				v-if="(state.server.permissions as Record<string, boolean>)?.duplicate"
				@click="action = 'duplicate'"
				>复制为新草稿</UiButton
			>
		</div>
		<form
			novalidate
			:class="receive ? 'receive-layout' : 'form-layout'"
			@submit.prevent="review"
		>
			<div :class="receive ? 'receive-main' : 'form-main surface'">
				<template v-if="writable">
					<section :class="['form-section', { surface: receive }]">
						<div class="section-heading">
							<h2>{{ title }}时间</h2>
							<span class="muted">01</span>
						</div>
						<div class="form-fields">
							<label class="preview-field"
								>操作日期<input
									v-model="draft.postingDate"
									type="date"
									:disabled="busy || draft.timeMode === 'current'" /></label
							><label class="preview-field"
								>时间方式<select v-model="draft.timeMode" :disabled="busy">
									<option value="current">确认时的当前时间</option>
									<option value="manual">指定历史时间</option>
								</select></label
							><label v-if="draft.timeMode === 'manual'" class="preview-field"
								>操作时间<input
									v-model="draft.postingTime"
									type="time"
									step="1"
									:disabled="busy"
							/></label>
							<p v-if="draft.timeMode === 'manual'" class="muted">
								可用数量按指定日期和时间核对。
							</p>
						</div>
					</section>
					<section
						v-if="draft.kind === 'Loan' || draft.kind === 'Return' || draft.loanName"
						:class="['form-section', { surface: receive }]"
					>
						<h2>{{ draft.kind === "Loan" ? "借用对象" : "归还来源" }}</h2>
						<div class="form-fields">
							<template v-if="draft.kind === 'Loan'"
								><label class="preview-field"
									>借用人 / 团体<input
										v-model="draft.borrower"
										:disabled="busy" /></label
								><SearchSelect
									label="借出存放库位"
									:model-value="draft.loanDestination"
									@update:model-value="c.setLoanDestination"
									:options="reference.leasedLeaves"
									:disabled="busy" /></template
							><template v-else
								><RemoteSelect
									label="关联借用记录"
									v-model="loanChoice"
									:load="loans"
									:disabled="busy"
								/><UiButton :disabled="!loanChoice || busy" @click="addLoan"
									>加入此借用</UiButton
								>
								<p>
									{{ draft.borrower }} ·
									{{
										reference.activities.find(
											(row) => row.value === draft.activity,
										)?.label || draft.activity
									}}<br />可加入同一借用方和活动的多笔借用；遗失使用单独操作。
								</p></template
							>
						</div>
					</section>
				</template>
				<section :class="['form-section operation-section', { surface: receive }]">
					<div class="section-heading">
						<div>
							<span class="eyebrow">02 / 物品与位置</span>
							<h2>{{ receive ? "这次收到什么？" : "操作物资" }}</h2>
						</div>
						<span class="badge neutral">{{ draft.items.length }} 行分配</span>
					</div>
					<OperationLines
						ref="lineEditor"
						:draft="draft"
						:mode="writable ? 'edit' : 'display'"
						:disabled="!writable || busy"
						:show-error="showError"
						:expanded="expanded"
						:active="active"
						@expand="toggle"
						@notify="emit('notify', $event)"
					/>
				</section>
				<section :class="['form-section', { surface: receive }]">
					<div class="section-heading">
						<h2>补充信息</h2>
						<span class="muted">03</span>
					</div>
					<button
						type="button"
						class="disclosure"
						:aria-expanded="detailsOpen"
						@click="detailsOpen = !detailsOpen"
					>
						来源、活动与备注 <InventoryIcon name="chevron-down" />
					</button>
					<div v-show="detailsOpen" class="form-grid">
						<TransactionContext
							:draft="draft"
							:disabled="busy"
							:mode="writable ? 'edit' : 'display'"
							@dirty-change="supportingDirty = $event"
						/><label v-if="writable" class="preview-field full-width"
							>备注<textarea v-model="draft.note" rows="3" :disabled="busy" />
						</label>
						<div v-else class="preview-long-text">{{ draft.note }}</div>
					</div>
					<div class="attachment-area">
						<h3>凭证附件 <small class="muted">可选</small></h3>
						<Attachments
							:controller="files"
							:disabled="!writable || busy"
							:mode="writable ? 'edit' : 'display'"
						/>
					</div>
					<fieldset v-if="writable" class="people-fields" :disabled="busy">
						<legend>现场人员（可选）</legend>
						<div class="form-grid">
							<label class="preview-field"
								>记录人<input v-model="draft.recorder" /></label
							><label class="preview-field"
								>经手人<input v-model="draft.handler" /></label
							><label class="preview-field"
								>鉴证人<input v-model="draft.reviewer"
							/></label>
						</div>
					</fieldset>
					<dl v-else class="preview-info-grid">
						<div
							v-for="(value, label) in {
								记录人: draft.recorder,
								经手人: draft.handler,
								鉴证人: draft.reviewer,
							}"
							:key="label"
						>
							<dt>{{ label }}</dt>
							<dd>{{ value || "未填写" }}</dd>
						</div>
					</dl>
				</section>
				<div v-if="showError && issues.length" role="alert" class="notice-bar danger">
					<p v-for="issue in issues.filter((row) => !row.lineId)" :key="issue.field">
						{{ issue.message }}
					</p>
					<p>{{ issues.length }} 处待完善，输入已保留。</p>
				</div>
				<div
					v-if="writable || state.confirmationVersion"
					ref="reviewBar"
					:class="[
						'form-section form-actions preview-document-actions',
						{ surface: receive },
					]"
				>
					<p class="muted">
						{{ draft.items.length }} 行 · {{ totals || "尚未添加物品" }}
					</p>
					<UiButton
						v-if="!state.confirmationVersion"
						:disabled="busy || supportingDirty"
						@click="c.save(true)"
						>保存草稿</UiButton
					><UiButton
						v-if="!state.confirmationVersion && c.canSubmit.value"
						variant="primary"
						type="submit"
						:disabled="busy || supportingDirty"
						:loading="busy"
						>复核并确认</UiButton
					><UiButton v-else variant="primary" :loading="busy" @click="c.confirm"
						>检查上次确认结果</UiButton
					><small class="muted">复核并确认后才变更库存。</small
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
			</div>
			<aside :class="['surface', receive ? 'receive-summary' : 'form-review']">
				<span class="eyebrow">REVIEW / 检查</span>
				<h2>本次{{ title }}</h2>
				<div class="summary-count">
					{{ new Set(draft.items.map((line) => line.code)).size
					}}<span>种物品 · {{ draft.items.length }} 行分配</span>
				</div>
				<p class="numeric">{{ totals || "尚未添加物品" }}</p>
				<p class="muted">
					{{
						new Set(
							draft.items
								.map((line) => line.sourceLocation || line.location)
								.filter(Boolean),
						).size
					}}
					个位置<br />{{ files.files.length }} 份附件
				</p>
				<AllocationSummary :draft="draft" collapsible />
			</aside>
		</form>
		<Overlay
			v-if="reviewOpen"
			:title="`检查并确认${title}`"
			@close="!busy && (reviewOpen = false)"
			><p>
				{{ draft.postingDate }} ·
				{{ draft.timeMode === "current" ? "确认时的当前时间" : draft.postingTime }}
			</p>
			<p>{{ itemCount }} 种物品 · {{ draft.items.length }} 行分配 · {{ totals }}</p>
			<AllocationSummary :draft="draft" /><TransactionContext
				:draft="draft"
				mode="display"
			/>
			<dl class="preview-info-grid">
				<div
					v-for="(value, label) in {
						借用方: draft.borrower,
						记录人: draft.recorder,
						经手人: draft.handler,
						鉴证人: draft.reviewer,
					}"
					:key="label"
				>
					<dt>{{ label }}</dt>
					<dd>{{ value || "未填写" }}</dd>
				</div>
			</dl>
			<div class="preview-long-text">{{ draft.note }}</div>
			<p>{{ files.files.length }} 份附件。确认后此记录及附件不可直接修改。</p>
			<p v-if="state.error" role="alert">{{ state.error }}</p>
			<template #footer
				><UiButton :disabled="busy" @click="reviewOpen = false">返回检查</UiButton
				><UiButton variant="primary" :loading="busy" @click="c.confirm"
					>确认提交</UiButton
				></template
			></Overlay
		>
		<Overlay v-if="reloadOpen" title="放弃当前输入并重新读取？" @close="reloadOpen = false"
			><p>重新读取会替换当前页面的输入。可先复制保留。</p>
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
		<Overlay v-if="leaveOpen" title="离开当前编辑？" @close="c.finishLeave('stay')"
			><p>未完成输入仅能在此浏览器恢复；待上传文件需要重新选择。</p>
			<template #footer
				><UiButton @click="c.finishLeave('stay')">继续编辑</UiButton
				><UiButton @click="c.finishLeave('retain')">保留输入并离开</UiButton
				><UiButton variant="danger" @click="c.finishLeave('discard')"
					>放弃输入并离开</UiButton
				></template
			></Overlay
		>
		<Overlay
			v-if="action"
			:title="
				action === 'cancel'
					? '取消此原生记录？'
					: action === 'delete'
						? '删除此原生草稿？'
						: action === 'duplicate'
							? '复制为新草稿？'
							: '创建修订草稿？'
			"
			@close="!busy && (action = undefined)"
			><p>
				{{ state.identity?.name }}。{{
					action === "cancel"
						? "将通过 ERPNext 原生取消流程恢复库存，相关依赖仍会校验。"
						: action === "delete"
							? "仅删除此原生草稿，已创建的物品、分类和单位仍保留。"
							: action === "duplicate"
								? "另建原生草稿，保留物品、分配与记录的换算；附件需重新添加。请核对当前库存与入账时间。"
								: "保留原记录，另建带修订来源的新草稿。"
				}}
			</p>
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
