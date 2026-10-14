<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import PreviewAttachments from "./components/PreviewAttachments.vue";
import PreviewSearchSelect from "./components/PreviewSearchSelect.vue";
import { activities, type PreviewAttachment } from "./workflowModel";
import UiButton from "./components/PreviewUiButton.vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import PreviewOperationLines from "./components/PreviewOperationLines.vue";
import PreviewAllocationSummary from "./components/PreviewAllocationSummary.vue";
import { usePreviewFocusVisibility } from "./focusVisibility";
import { useResponsiveLayout } from "../composables/useResponsiveLayout";
import PreviewItemPicker from "./components/PreviewItemPicker.vue";
import {
	reviewSession,
	assignReceiptBatchIds,
	type DraftLine,
	type ReviewDraft,
} from "./reviewModel";
import { validateOperation } from "./formModel";
import { items, locations, type Pattern } from "./model";
const props = defineProps<{ pattern: Pattern; active?: boolean }>();
const emit = defineEmits<{ notify: [message: string]; back: [] }>();
const lineEditor = ref<InstanceType<typeof PreviewOperationLines>>();
const formRoot = ref<HTMLElement>();
const reviewBar = ref<HTMLElement>();
const { isMobile } = useResponsiveLayout();
usePreviewFocusVisibility(
	formRoot,
	reviewBar,
	() => isMobile.value && props.pattern === "proposed",
	() => props.active !== false,
);
const destination = ref(locations[0]);
const lines = ref<DraftLine[]>([
	{
		id: "canonical-1",
		uom: items[0].uom,
		code: items[0].code,
		qty: 12,
		location: locations[0],
		batch: "RICE-2610",
		expiry: "2027-03-01",
	},
]);
const fields = reactive({
	date: "2026-10-11",
	source: "社区善心捐赠",
	activity: "",
	notes: "",
	recorder: "",
	handler: "",
	reviewer: "",
});
const attachments = ref<PreviewAttachment[]>([]);
const picker = ref(false);

const review = ref(false);
const detailsOpen = ref(false);
const error = ref("");
const saveStatus = ref("草稿已保存（模拟）");
const failure = ref(false);
const conflict = ref(false);
const completed = ref(false);
const confirmBusy = ref(false);
const leaveOpen = ref(false);
const scanOpen = ref(false);
watch(
	() => props.active,
	(active) => {
		if (active) return;
		picker.value = false;
		review.value = false;
		leaveOpen.value = false;
		scanOpen.value = false;
	},
);
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let confirmTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 2;
const lookup = (code: string) => reviewSession.stock.find((item) => item.code === code)!;
const locationCount = computed(
	() => new Set(lines.value.map((line) => line.location).filter(Boolean)).size,
);
const itemCount = computed(() => new Set(lines.value.map((line) => line.code)).size);
const totals = computed(() => {
	const values = new Map<string, number>();
	lines.value.forEach((line) => {
		const uom = lookup(line.code).uom;
		values.set(uom, (values.get(uom) || 0) + (Number(line.qty) || 0));
	});
	return [...values].map(([uom, qty]) => `${qty} ${uom}`).join(" · ");
});
const receiveDraft = computed<ReviewDraft>(() => ({
	name: "MAT-STE-2026-00900",
	kind: "Receive",
	status: completed.value ? "completed" : "draft",
	postingDate: fields.date,
	activity: fields.activity,
	borrower: "",
	responsible: "",
	note: fields.notes,
	lines: lines.value,
}));
function saveDraft() {
	clearTimeout(saveTimer);
	if (completed.value) return;
	saveStatus.value = "正在保存（模拟）…";
	saveTimer = setTimeout(() => {
		saveStatus.value = conflict.value
			? "版本冲突 · 输入已保留"
			: failure.value
				? "保存失败 · 输入已保留"
				: "草稿已保存（模拟）";
	}, 500);
}
watch([lines, fields, attachments], saveDraft, { deep: true });
function add(code: string) {
	const item = lookup(code);
	lines.value.push({
		id: `canonical-${nextId++}`,
		uom: item.uom,
		code,
		qty: 1,
		location: destination.value,
		batch: "",
		expiry: "",
	});
	picker.value = false;
	scanOpen.value = false;
	emit("notify", `已添加${item.name}，可直接修改数量与位置。`);
}
function check() {
	error.value = validateOperation(receiveDraft.value);
	if (error.value) lineEditor.value?.revealIssue();
	if (conflict.value) error.value = "当前草稿存在版本冲突，输入已保留。请先结束冲突演示。";
	if (!fields.date) error.value = "请选择入库日期。";
	if (!error.value) review.value = true;
}
function confirm() {
	error.value = validateOperation(receiveDraft.value);
	if (error.value) {
		review.value = false;
		lineEditor.value?.revealIssue();
	}
	if (error.value || confirmBusy.value || completed.value || conflict.value) return;
	confirmBusy.value = true;
	confirmTimer = setTimeout(() => {
		confirmBusy.value = false;
		if (failure.value) {
			error.value = "模拟提交失败。所有输入均已保留，请关闭失败演示后重试。";
			return;
		}
		assignReceiptBatchIds(receiveDraft.value);
		completed.value = true;
		review.value = false;
		clearTimeout(saveTimer);
		saveStatus.value = "已完成（模拟）";
		emit("notify", "入库演示已完成。真实库存没有发生变化。");
	}, 650);
}
function resetDemo() {
	completed.value = false;
	error.value = "";
	saveStatus.value = "草稿已保存（模拟）";
}
onBeforeUnmount(() => {
	clearTimeout(saveTimer);
	clearTimeout(confirmTimer);
});
</script>
<template>
	<div ref="formRoot" class="receive-example">
		<div class="page-heading">
			<div>
				<span class="eyebrow">RECEIVE / 入库登记</span>
				<h1>把善意，妥善安放。</h1>
				<p class="muted">一张清楚的入库记录，是物资流转的开始。</p>
			</div>
			<UiButton variant="ghost" @click="leaveOpen = true">返回库存</UiButton>
		</div>
		<div class="proposal-note">
			<InventoryIcon name="notice" /><span>{{
				pattern === "current"
					? "当前结构：日期在前，物品与位置随后，提交按钮位于表单末尾。"
					: "实验表单提案：日期在前，右侧保留入库汇总与检查入口；尚未决定用于正式流程。"
			}}</span>
		</div>
		<div v-if="completed" class="notice-bar success" role="status">
			<InventoryIcon name="select" />模拟入库完成，记录已锁定。<UiButton @click="resetDemo"
				>继续编辑示例</UiButton
			>
		</div>
		<form novalidate class="receive-layout" @submit.prevent="check">
			<div class="receive-main">
				<div class="form-status">
					<span class="badge" :class="completed ? 'success' : 'neutral'">{{
						completed ? "已完成" : "入库草稿"
					}}</span
					><span
						role="status"
						:class="{
							'text-danger':
								saveStatus.includes('失败') || saveStatus.includes('冲突'),
						}"
						>{{ saveStatus }}</span
					><UiButton v-if="saveStatus.includes('失败')" @click="saveDraft"
						>重试保存</UiButton
					>
				</div>
				<p v-if="error" class="notice-bar danger" role="alert">{{ error }}</p>
				<div v-if="conflict" class="notice-bar warning" role="alert">
					版本冲突演示：当前输入保持不变，确认操作暂停。<UiButton
						@click="
							conflict = false;
							saveDraft();
						"
						>结束冲突演示</UiButton
					>
				</div>
				<fieldset :disabled="completed || confirmBusy">
					<section class="surface form-section">
						<div class="section-heading">
							<h2>入库时间</h2>
							<span class="muted">01</span>
						</div>
						<label class="preview-field field"
							><span>日期 <span aria-hidden="true">*</span></span
							><input v-model="fields.date" type="date" required
						/></label>
					</section>
					<section class="surface form-section">
						<div class="section-heading">
							<div>
								<span class="eyebrow">02 / 物品与位置</span>
								<h2>这次收到什么？</h2>
							</div>
							<span class="badge neutral">{{ lines.length }} 行物品</span>
						</div>
						<PreviewOperationLines
							ref="lineEditor"
							:draft="receiveDraft"
							:disabled="completed || confirmBusy"
							:show-error="!!error"
							@notify="emit('notify', $event)"
						/>
						<UiButton icon="scan" @click="scanOpen = true">扫码添加</UiButton>
					</section>
					<section class="surface form-section">
						<div class="section-heading">
							<h2>补充信息</h2>
							<span class="muted">03</span>
						</div>
						<button
							class="disclosure"
							type="button"
							:aria-expanded="detailsOpen"
							@click="detailsOpen = !detailsOpen"
						>
							来源、活动与备注 <InventoryIcon name="chevron-down" />
						</button>
						<div v-show="detailsOpen" class="form-grid">
							<label class="preview-field field"
								>来源<input
									v-model="fields.source"
									placeholder="例如：捐赠单位或个人" /></label
							><PreviewSearchSelect
								label="关联活动"
								v-model="fields.activity"
								:options="activities.map((row) => row.name)"
							/>
							<label class="preview-field field full-width"
								>备注<textarea
									v-model="fields.notes"
									rows="3"
									placeholder="补充需要交接的信息（可选）"
								/>
							</label>
						</div>
						<div class="attachment-area">
							<h3>凭证附件 <small class="muted">可选</small></h3>
							<p class="muted">仅保存在本次预览会话中，不上传到服务器。</p>
							<PreviewAttachments
								v-model="attachments"
								:disabled="completed || confirmBusy"
							/>
						</div>
						<fieldset class="people-fields">
							<legend>现场人员（可选）</legend>
							<div class="form-grid">
								<label class="preview-field field"
									>记录人<input v-model="fields.recorder" /></label
								><label class="preview-field field"
									>经手人<input v-model="fields.handler" /></label
								><label class="preview-field field"
									>鉴证人<input v-model="fields.reviewer"
								/></label>
							</div>
						</fieldset>
					</section>
				</fieldset>
				<div v-if="pattern === 'current'" class="surface form-section">
					<p class="muted">{{ lines.length }} 行 · {{ totals || "暂无物品" }}</p>
					<UiButton
						variant="primary"
						type="submit"
						:disabled="completed || conflict"
						:loading="confirmBusy"
						>提交</UiButton
					><small class="muted">下一步检查明细，确认后才完成模拟入库。</small>
				</div>
			</div>
			<aside ref="reviewBar" v-if="pattern === 'proposed'" class="surface receive-summary">
				<span class="eyebrow">REVIEW / 检查</span>
				<h2>本次入库</h2>
				<div class="summary-count">
					{{ itemCount }}<span>种物品 · {{ lines.length }} 行分配</span>
				</div>
				<p class="numeric">{{ totals || "尚未添加物品" }}</p>
				<p class="muted">
					{{ locationCount }} 个入库位置<br />{{ attachments.length }} 份附件
				</p>
				<UiButton
					variant="primary"
					type="submit"
					:disabled="completed || conflict"
					:loading="confirmBusy"
					>检查并确认</UiButton
				><small class="muted">先检查，再确认。草稿保存不会改变库存。</small>
			</aside>
		</form>
		<div class="demo-state-control">
			<span>评审工具 · 失败恢复</span
			><label class="preview-choice-label"
				><input v-model="failure" type="checkbox" @change="saveDraft" />模拟保存 /
				提交失败</label
			><label class="preview-choice-label"
				><input
					v-model="conflict"
					type="checkbox"
					@change="saveDraft"
				/>模拟版本冲突</label
			>
		</div>
		<PreviewItemPicker
			v-if="picker"
			mode="add-multiple"
			allow-create
			@close="picker = false"
			@select="add"
			@select-multiple="(codes) => codes.forEach(add)"
			@notify="emit('notify', $event)"
		/>
		<PreviewOverlay v-if="scanOpen" title="扫码添加 · 模拟" @close="scanOpen = false"
			><div class="scan-placeholder">
				<InventoryIcon name="scan" />不使用相机，也可手动选择物品
			</div>
			<template #footer
				><UiButton
					@click="
						scanOpen = false;
						picker = true;
					"
					>手动选择</UiButton
				><UiButton variant="primary" @click="add(items[1].code)"
					>模拟识别菜籽油</UiButton
				></template
			></PreviewOverlay
		>
		<PreviewOverlay
			v-if="review"
			title="检查并确认入库"
			@close="!confirmBusy && (review = false)"
			><p class="muted">{{ fields.date }} · {{ fields.source || "未填写来源" }}</p>
			<PreviewAllocationSummary :draft="receiveDraft" />
			<p>{{ totals }}</p>
			<p class="muted">
				活动：{{ fields.activity || "无" }} · 附件：{{ attachments.length }} 份
			</p>
			<p class="muted">
				记录人：{{ fields.recorder || "未填写" }} · 经手人：{{
					fields.handler || "未填写"
				}}
				· 鉴证人：{{ fields.reviewer || "未填写" }}
			</p>
			<p v-if="fields.notes">备注：{{ fields.notes }}</p>
			<p class="notice-bar">仅模拟确认，不创建真实库存记录。</p>
			<p v-if="error" class="notice-bar danger" role="alert">{{ error }}</p>
			<template #footer
				><UiButton :disabled="confirmBusy" @click="review = false">返回修改</UiButton
				><UiButton variant="primary" :loading="confirmBusy" @click="confirm"
					>确认入库（模拟）</UiButton
				></template
			></PreviewOverlay
		>
		<PreviewOverlay v-if="leaveOpen" title="返回库存示例？" @close="leaveOpen = false"
			><p>本次输入会保留在预览中，重新打开入库示例可以继续编辑。刷新页面会重置示例数据。</p>
			<template #footer
				><UiButton @click="leaveOpen = false">继续编辑</UiButton
				><UiButton
					variant="primary"
					@click="
						leaveOpen = false;
						emit('back');
					"
					>保留并返回</UiButton
				></template
			></PreviewOverlay
		>
	</div>
</template>
