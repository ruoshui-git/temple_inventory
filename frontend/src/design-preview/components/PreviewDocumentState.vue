<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { cancelPreviewDocument, externalSnapshot, type EditSnapshot } from "../workflowModel";
import {
	captureSavedDraft,
	savedDraftSnapshot,
	createDraft,
	reviewSession,
	submitDraft,
	type ReviewDraft,
} from "../reviewModel";
import { validateOperation } from "../formModel";
import PreviewUiButton from "./PreviewUiButton.vue";

const copyStatus = ref("");
async function copyRetained() {
	try {
		await navigator.clipboard.writeText(retained.value);
		copyStatus.value = "已复制";
	} catch {
		copyStatus.value = "复制不可用，请选择文本复制";
	}
}
const props = defineProps<{ draft: ReviewDraft }>();
const emit = defineEmits<{ blocked: [value: boolean]; amend: [draft: ReviewDraft] }>();
const baseline = ref(savedDraftSnapshot(props.draft));
const dirty = computed(
	() => props.draft.saved === false || JSON.stringify(props.draft) !== baseline.value,
);
const remote = ref<EditSnapshot>();
const sessionExpired = ref(false);
const unavailable = ref(false);
const retained = ref("");
const error = ref("");
const blocked = computed(() => !!remote.value || sessionExpired.value || unavailable.value);
watch(blocked, (value) => emit("blocked", value));
watch(
	() => props.draft.version,
	() => {
		baseline.value = savedDraftSnapshot(props.draft);
	},
);
watch(
	() => props.draft,
	() => {
		baseline.value = savedDraftSnapshot(props.draft);
		remote.value = undefined;
		unavailable.value = false;
		sessionExpired.value = false;
		retained.value = "";
		error.value = "";
		emit("blocked", false);
	},
);
function external(action: "edit" | "submit" | "cancel" | "delete") {
	error.value = "";
	const saved: ReviewDraft = JSON.parse(baseline.value);
	if (action === "delete" && saved.status !== "draft") {
		error.value = "已提交或已取消记录不能直接删除。";
		return;
	}
	if (action === "cancel" && saved.status !== "completed") {
		error.value = "只有已提交记录可以取消。";
		return;
	}
	if (action === "submit" && saved.status !== "draft") return;
	remote.value = externalSnapshot(saved, action);
	emit("blocked", true);
	if (!dirty.value) reload();
}
function reload() {
	if (!remote.value) return;
	const incoming = remote.value;
	error.value = "";
	if (incoming.status === "completed" && props.draft.status === "draft") {
		error.value = validateOperation(incoming.document);
		if (error.value) {
			remote.value = undefined;
			return;
		}
	}
	const localCopy = JSON.stringify(props.draft, null, 2);
	if (incoming.deleted) {
		if (dirty.value) retained.value = localCopy;
		unavailable.value = true;
		const index = reviewSession.drafts.indexOf(props.draft);
		if (index >= 0) reviewSession.drafts.splice(index, 1);
		reviewSession.movements.splice(
			0,
			reviewSession.movements.length,
			...reviewSession.movements.filter((row) => row.name !== props.draft.name),
		);
	} else {
		if (incoming.status === "cancelled") {
			error.value = cancelPreviewDocument(props.draft);
			if (error.value) {
				remote.value = undefined;
				return;
			}
		}
		if (dirty.value) retained.value = localCopy;
		Object.assign(props.draft, incoming.document);
		if (incoming.status === "completed" && props.draft.status === "draft") {
			if (!submitDraft(props.draft.kind, props.draft.name)) {
				error.value = "外部提交未通过关联借用核对，输入副本已保留。";
				remote.value = undefined;
				return;
			}
		}
		Object.assign(props.draft, {
			version: incoming.version,
			status: incoming.status,
			saved: true,
		});
		baseline.value = captureSavedDraft(props.draft);
	}
	remote.value = undefined;
}
function amend() {
	let suffix = 1;
	while (reviewSession.drafts.some((row) => row.name === `${props.draft.name}-${suffix}`))
		suffix++;
	const name = `${props.draft.name}-${suffix}`;
	const next = createDraft(props.draft.kind, name);
	Object.assign(next, JSON.parse(JSON.stringify(props.draft)), {
		name,
		amendedFrom: props.draft.name,
		status: "draft",
		saved: false,
		version: 1,
		origin: "frontend",
	});
	emit("amend", next);
}
function markDeskOrigin() {
	props.draft.origin = "desk";
	props.draft.saved = true;
	baseline.value = captureSavedDraft(props.draft);
}
function cancel() {
	error.value = cancelPreviewDocument(props.draft);
}
</script>
<template>
	<section class="form-section">
		<p>
			{{
				draft.documentType ||
				(draft.kind === "Reconcile" ? "Stock Reconciliation" : "Stock Entry")
			}}
			· {{ draft.saved === false ? "未保存" : draft.name }} ·
			{{ draft.origin === "desk" ? "ERPNext 创建" : "前端创建" }}
		</p>
		<p v-if="draft.amendedFrom">修订自 {{ draft.amendedFrom }}</p>
		<p v-if="error" role="alert">{{ error }}</p>
		<div v-if="remote" role="alert">
			ERPNext 中的记录已{{
				remote.deleted ? "删除" : "更新"
			}}。当前输入保留，保存已暂停。<PreviewUiButton @click="reload"
				>载入最新记录并保留输入副本</PreviewUiButton
			>
		</div>
		<p v-if="unavailable" role="alert">记录已删除，不能继续保存。请返回列表。</p>
		<div v-if="sessionExpired" role="alert">
			登录已过期，输入已保留。<PreviewUiButton @click="sessionExpired = false"
				>重新登录并继续</PreviewUiButton
			>
		</div>
		<details v-if="retained">
			<summary>恢复前的输入副本</summary>
			<pre class="preview-long-text" aria-label="保留的输入副本">{{ retained }}</pre>
			<PreviewUiButton @click="copyRetained">复制输入副本</PreviewUiButton>
			<p v-if="copyStatus" role="status">{{ copyStatus }}</p>
		</details>
		<PreviewUiButton v-if="draft.status === 'cancelled' && !blocked" @click="amend"
			>修订为新草稿</PreviewUiButton
		>
		<details>
			<summary>预览 ERPNext 生命周期</summary>
			<div class="form-check-row">
				<PreviewUiButton :disabled="blocked" @click="markDeskOrigin"
					>Desk 创建的同一草稿</PreviewUiButton
				>
				<PreviewUiButton :disabled="blocked" @click="external('edit')"
					>外部修改</PreviewUiButton
				>
				<PreviewUiButton :disabled="blocked" @click="external('submit')"
					>外部提交</PreviewUiButton
				>
				<PreviewUiButton :disabled="blocked" @click="external('cancel')"
					>外部取消</PreviewUiButton
				>
				<PreviewUiButton :disabled="blocked" @click="external('delete')"
					>外部删除</PreviewUiButton
				>
				<PreviewUiButton
					@click="
						sessionExpired = true;
						emit('blocked', true);
					"
					>登录过期</PreviewUiButton
				>
				<PreviewUiButton
					v-if="draft.status === 'completed'"
					:disabled="blocked"
					@click="cancel"
					>取消已提交记录</PreviewUiButton
				>
			</div>
		</details>
	</section>
</template>
