<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Combobox } from "frappe-ui";
import { api, upload } from "../lib/api";
import { toast } from "../lib/toast";
import IconButton from "./IconButton.vue";
import ScannableInput from "./ScannableInput.vue";

const props = withDefaults(
	defineProps<{
		boot: any;
		barcode?: string;
		submitLabel?: string;
		cancelLabel?: string;
	}>(),
	{ barcode: "", submitLabel: "创建物品", cancelLabel: "取消" },
);
const emit = defineEmits<{ created: [itemCode: string]; cancel: [] }>();
const nos = props.boot.uoms.find((uom: any) => uom.name === "Nos")?.name || "";
const item = ref({
	item_code: "",
	item_name: "",
	item_group: props.boot.item_groups[0]?.name || "",
	stock_uom: nos,
	barcode: props.barcode,
	description: "",
	has_batch_no: false,
	has_expiry_date: false,
});
const error = ref("");
const busy = ref(false);
const created = ref("");
const photo = ref<File>();
const unitDialog = ref(false);
const categoryDialog = ref(false);
const unitName = ref("");
const whole = ref(true);
const categoryName = ref("");
const codeStatus = ref<"idle" | "checking" | "available" | "invalid" | "unavailable">("idle");
const codeMessage = ref("");
const uomOptions = computed(() =>
	props.boot.uoms.map((uom: any) => ({ label: uom.uom_name, value: uom.name })),
);
let codeTimer: ReturnType<typeof setTimeout> | undefined;
let codeSequence = 0;
let settingSuggestedCode = false;

function setCodeResult(result: any) {
	codeStatus.value = result.available
		? "available"
		: result.reason === "exists"
			? "unavailable"
			: "invalid";
	codeMessage.value = result.message || (result.available ? "此编号可用" : "物品编号不可用");
}

async function checkCode(normalize = false) {
	if (codeTimer) clearTimeout(codeTimer);
	const requested = item.value.item_code;
	const current = ++codeSequence;
	if (!requested.trim()) {
		codeStatus.value = "invalid";
		codeMessage.value = "请输入物品编号";
		return false;
	}
	codeStatus.value = "checking";
	codeMessage.value = "正在检查编号…";
	try {
		const result = await api("check_item_code", { item_code: requested });
		if (current !== codeSequence || item.value.item_code !== requested) return false;
		if (normalize && result.item_code !== requested) {
			settingSuggestedCode = true;
			item.value.item_code = result.item_code;
			await nextTick();
			settingSuggestedCode = false;
		}
		setCodeResult(result);
		return Boolean(result.available);
	} catch (cause: any) {
		if (current !== codeSequence) return false;
		codeStatus.value = "invalid";
		codeMessage.value = cause.message || "无法检查物品编号";
		return false;
	}
}

async function useSuggestedCode() {
	if (codeTimer) clearTimeout(codeTimer);
	const current = ++codeSequence;
	codeStatus.value = "checking";
	codeMessage.value = "正在生成自动编号…";
	try {
		const result = await api("suggest_item_code");
		if (current !== codeSequence) return;
		settingSuggestedCode = true;
		item.value.item_code = result.item_code;
		await nextTick();
		settingSuggestedCode = false;
		codeStatus.value = "available";
		codeMessage.value = "此编号可用";
	} catch (cause: any) {
		if (current !== codeSequence) return;
		codeStatus.value = "invalid";
		codeMessage.value = cause.message || "无法生成自动编号";
	}
}

watch(
	() => item.value.item_code,
	() => {
		if (settingSuggestedCode || created.value) return;
		if (codeTimer) clearTimeout(codeTimer);
		codeSequence++;
		if (!item.value.item_code.trim()) {
			codeStatus.value = "invalid";
			codeMessage.value = "请输入物品编号";
			return;
		}
		codeStatus.value = "checking";
		codeMessage.value = "正在检查编号…";
		codeTimer = setTimeout(() => void checkCode(), 350);
	},
);

async function create() {
	if (busy.value) return;
	if (!props.boot.uoms.some((uom: any) => uom.name === item.value.stock_uom)) {
		error.value = "请选择已有单位或先新建单位";
		return;
	}
	if (!created.value && !(await checkCode(true))) return;
	busy.value = true;
	error.value = "";
	try {
		if (!created.value) {
			const result = await api("create_item", { data: item.value });
			created.value = result.item_code;
			toast(`已创建物品：${item.value.item_name}`);
		}
		if (photo.value) {
			const file = await upload(photo.value, "Item", created.value);
			await api("set_item_image", { item_code: created.value, image: file.file_url });
			photo.value = undefined;
		}
		emit("created", created.value);
	} catch (cause: any) {
		if (
			cause.kind === "DuplicateEntryError" ||
			String(cause.message || "").includes("物品编号已存在")
		) {
			codeStatus.value = "unavailable";
			codeMessage.value = "此物品编号已存在。请输入其他编号，或使用自动编号。";
		} else error.value = cause.message;
	} finally {
		busy.value = false;
	}
}

async function createUnit() {
	try {
		const result = await api("create_uom", {
			uom_name: unitName.value,
			must_be_whole_number: whole.value,
		});
		if (!props.boot.uoms.some((uom: any) => uom.name === result.name))
			props.boot.uoms.push(result);
		item.value.stock_uom = result.name;
		unitDialog.value = false;
	} catch (cause: any) {
		error.value = cause.message;
	}
}

async function createCategory() {
	try {
		const result = await api("create_item_group", { name: categoryName.value });
		if (!props.boot.item_groups.some((group: any) => group.name === result.name))
			props.boot.item_groups.push(result);
		item.value.item_group = result.name;
		categoryDialog.value = false;
	} catch (cause: any) {
		error.value = cause.message;
	}
}

onMounted(() => void useSuggestedCode());
onBeforeUnmount(() => {
	if (codeTimer) clearTimeout(codeTimer);
	codeSequence++;
});
</script>

<template>
	<div class="item-create-form-shell">
		<form class="item-create-form" @submit.prevent="create">
			<p v-if="error" class="error" role="alert">{{ error }}</p>
			<fieldset :disabled="busy || !!created">
				<label for="new-item-code"
					>物品编号 <span class="required-mark" aria-hidden="true">*</span
					><span class="sr-only">必填</span></label
				>
				<div class="input-with-action">
					<input
						id="new-item-code"
						v-model="item.item_code"
						required
						autocomplete="off"
						aria-describedby="item-code-status"
						@blur="checkCode(true)"
					/><IconButton label="使用新的自动编号" @click="useSuggestedCode">
						<svg aria-hidden="true" viewBox="0 0 24 24">
							<path
								d="M20 7v5h-5M4 17v-5h5M6.1 9A7 7 0 0 1 18 6l2 1M17.9 15A7 7 0 0 1 6 18l-2-1"
							/>
						</svg>
					</IconButton>
				</div>
				<p
					id="item-code-status"
					class="field-hint item-code-status"
					:class="{
						error: codeStatus === 'invalid' || codeStatus === 'unavailable',
						success: codeStatus === 'available',
					}"
					aria-live="polite"
				>
					{{ codeMessage }}
				</p>
				<label
					>名称 <span class="required-mark" aria-hidden="true">*</span
					><span class="sr-only">必填</span><input v-model="item.item_name" required
				/></label>
				<label
					>类别 <span class="required-mark" aria-hidden="true">*</span
					><span class="sr-only">必填</span
					><select v-model="item.item_group" required>
						<option
							v-for="group in boot.item_groups"
							:key="group.name"
							:value="group.name"
						>
							{{ group.item_group_name }}
						</option>
					</select></label
				>
				<button v-if="boot.capabilities.Item" type="button" @click="categoryDialog = true">
					新建类别
				</button>
				<label
					>默认单位 <span class="required-mark" aria-hidden="true">*</span
					><span class="sr-only">必填</span
					><Combobox
						v-model="item.stock_uom"
						:options="uomOptions"
						placeholder="搜索已有单位"
						aria-label="默认单位"
				/></label>
				<button v-if="boot.capabilities.UOM" type="button" @click="unitDialog = true">
					＋新建单位
				</button>
				<ScannableInput
					v-model="item.barcode"
					label="条码"
					placeholder="输入或扫描条码"
					scan-label="扫描新物品条码"
				/>
				<label>备注<textarea v-model="item.description" /></label>
				<label class="choice-row"
					><input
						type="checkbox"
						v-model="item.has_batch_no"
						:disabled="!boot.batch.enabled"
					/><span>批次追踪</span></label
				>
				<label v-if="item.has_batch_no" class="choice-row"
					><input type="checkbox" v-model="item.has_expiry_date" /><span
						>需要有效期</span
					></label
				>
				<p v-if="!boot.batch.enabled" class="warn">{{ boot.batch.error }}</p>
			</fieldset>
			<label
				>图片<input
					type="file"
					accept="image/*"
					@change="photo = ($event.target as HTMLInputElement).files?.[0]"
			/></label>
			<div class="detail-actions">
				<button
					class="primary"
					:disabled="busy || (!created && codeStatus !== 'available')"
				>
					{{ created ? "重试图片上传并继续" : submitLabel }}</button
				><button type="button" :disabled="busy" @click="emit('cancel')">
					{{ cancelLabel }}
				</button>
			</div>
		</form>
		<div v-if="unitDialog || categoryDialog" class="nested-dialog">
			<form @submit.prevent="unitDialog ? createUnit() : createCategory()">
				<h3>{{ unitDialog ? "新建单位" : "新建类别" }}</h3>
				<label v-if="unitDialog"
					>单位名称 <span class="required-mark" aria-hidden="true">*</span
					><span class="sr-only">必填</span
					><input v-model="unitName" required placeholder="单位名称"
				/></label>
				<label v-else
					>类别名称 <span class="required-mark" aria-hidden="true">*</span
					><span class="sr-only">必填</span
					><input v-model="categoryName" required placeholder="类别名称"
				/></label>
				<label v-if="unitDialog" class="choice-row"
					><input type="checkbox" v-model="whole" /><span>必须为整数</span></label
				>
				<button>创建并选择</button
				><button
					type="button"
					@click="
						unitDialog = false;
						categoryDialog = false;
					"
				>
					取消
				</button>
			</form>
		</div>
	</div>
</template>

<style scoped>
.item-create-form-shell {
	position: relative;
}

.item-create-form {
	display: grid;
	gap: 0.75rem;
	padding: clamp(1rem, 4vw, 1.5rem);
	border: 1px solid var(--border-color, #dedbd3);
	border-radius: 1rem;
	background: var(--surface-card, #fff);
}

.item-create-form fieldset {
	display: grid;
	min-width: 0;
	margin: 0;
	padding: 0;
	border: 0;
}

.input-with-action {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0.5rem;
	align-items: start;
}

.input-with-action :deep(.icon-button) {
	width: 2.75rem;
	height: 2.75rem;
	margin-top: 0.25rem;
	flex: 0 0 auto;
}

.item-code-status {
	min-height: 1.25rem;
	margin-top: -0.5rem;
}

.item-code-status.success {
	color: #18794e;
}

.nested-dialog {
	position: fixed;
	z-index: 70;
}

@media (max-width: 640px) {
	.item-create-form {
		padding: 1rem;
		border-radius: 0.75rem;
	}
}
</style>
