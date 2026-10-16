<script setup lang="ts">
import type { ReviewDraft } from "../reviewModel";
import PreviewTransactionContext from "./PreviewTransactionContext.vue";
import PreviewAllocationSummary from "./PreviewAllocationSummary.vue";
import PreviewCountSummary from "./PreviewCountSummary.vue";
import PreviewAttachments from "./PreviewAttachments.vue";
defineProps<{ draft: ReviewDraft }>();
</script>
<template>
	<article class="surface form-section preview-document-display">
		<h2>记录资料</h2>
		<dl class="preview-info-grid">
			<div>
				<dt>单据</dt>
				<dd>{{ draft.documentType || "Stock Entry" }} / {{ draft.name }}</dd>
			</div>
			<div>
				<dt>状态</dt>
				<dd>
					{{
						draft.status === "completed"
							? "已提交"
							: draft.status === "cancelled"
								? "已取消"
								: "仅查看"
					}}
				</dd>
			</div>
			<div>
				<dt>日期 / 时间</dt>
				<dd>{{ draft.postingDate }} · {{ draft.postingTime || "未记录时间" }}</dd>
			</div>
			<div>
				<dt>借用方</dt>
				<dd>{{ draft.borrower || "未填写" }}</dd>
			</div>
			<div>
				<dt>记录人</dt>
				<dd>{{ draft.recorder || "未填写" }}</dd>
			</div>
			<div>
				<dt>经手人</dt>
				<dd>{{ draft.handler || "未填写" }}</dd>
			</div>
			<div>
				<dt>鉴证人</dt>
				<dd>{{ draft.reviewer || "未填写" }}</dd>
			</div>
		</dl>
		<PreviewTransactionContext :draft="draft" mode="display" />
		<template v-if="draft.kind === 'Reconcile'"
			><PreviewCountSummary :draft="draft" />
			<dl v-for="line in draft.lines" :key="line.id" class="preview-info-grid">
				<div>
					<dt>物品 / 库位 / 批次</dt>
					<dd>{{ line.code }} · {{ line.location }} · {{ line.batch || "无批次" }}</dd>
				</div>
				<div>
					<dt>账面 / 实点 / 差异</dt>
					<dd>
						{{ line.qty }} / {{ line.countedQty ?? "未核对" }} /
						{{ line.countedQty === undefined ? "未核对" : line.countedQty - line.qty }}
						{{ line.uom }}
					</dd>
				</div>
				<div>
					<dt>原因</dt>
					<dd>{{ line.reason || "未填写" }}</dd>
				</div>
			</dl></template
		>
		<PreviewAllocationSummary v-else :draft="draft" />
		<details>
			<summary>备注</summary>
			<div class="preview-long-text">{{ draft.note || "未填写备注" }}</div>
		</details>
		<h3>附件</h3>
		<PreviewAttachments :model-value="draft.files" mode="display" />
	</article>
</template>
