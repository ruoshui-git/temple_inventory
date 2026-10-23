<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import type { useRelatedLoans } from "./useRelatedLoans";
import { useReferenceData } from "../../services/contracts";
import { warehouseLabel } from "../../lib/warehouseLabel";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
const props = defineProps<{
	controller: ReturnType<typeof useRelatedLoans>;
	disabled?: boolean;
}>();
const emit = defineEmits<{ openFull: [name: string] }>();
const c = props.controller,
	reference = useReferenceData();
const stage = ref<HTMLElement>();
watch(
	() => c.selected.value,
	async () => {
		await nextTick();
		stage.value?.focus({ preventScroll: true });
	},
);
function openFull() {
	const name = c.selected.value;
	c.close();
	emit("openFull", name);
}
</script>
<template>
	<Overlay v-if="c.open.value" title="关联借出 · 只读预览" adaptive-creation @close="c.close">
		<div ref="stage" class="related-loan-content" tabindex="-1">
			<template v-if="!c.selected.value">
				<p>选择原借出记录；数量与结清情况属于原借出。</p>
				<article v-for="name in c.names.value" :key="name" class="related-loan-choice">
					<SkeletonBlock v-if="c.records[name]?.loading" variant="lines" :count="3" />
					<template v-else-if="c.records[name]?.loan">
						<UiButton @click="c.selected.value = name"
							>{{ c.records[name]!.loan!.ti_borrower || "未填写借用方" }} ·
							{{ c.records[name]!.loan!.posting_date }}</UiButton
						>
						<p>
							{{ c.records[name]!.loan!.activity_title || "未关联活动" }} ·
							{{
								c.records[name]!.loan!.items.map(
									(line) => line.item_name || line.item_code,
								).join("、")
							}}
						</p>
						<small>{{ name }}</small>
					</template>
					<p v-else role="alert">
						借出记录暂不可用 <UiButton @click="c.retry(name)">重试</UiButton>
					</p>
				</article>
			</template>
			<template v-else>
				<UiButton v-if="c.names.value.length > 1" @click="c.selected.value = ''"
					>返回关联借出列表</UiButton
				>
				<SkeletonBlock
					v-if="c.current.value?.loading"
					variant="detail"
					:count="3"
					:rows="3"
				/>
				<p v-else-if="c.current.value?.error" role="alert">
					{{ c.current.value.error }}
					<UiButton @click="c.retry(c.selected.value)">重试</UiButton>
				</p>
				<template v-else-if="c.current.value?.loan">
					<h3>{{ c.current.value.loan.ti_borrower || "未填写借用方" }}</h3>
					<p class="related-loan-heading">
						{{ c.current.value.loan.posting_date }} ·
						<NativeStatusBadge :status="c.current.value.loan.docstatus" /> ·
						{{ c.current.value.loan.activity_title || "未关联活动" }}
					</p>
					<p class="muted">
						{{ c.current.value.loan.name }} ·
						原借出资料；结余按当前已提交的结算记录计算。
					</p>
					<article
						v-for="line in c.current.value.loan.items"
						:key="line.name"
						class="form-section"
					>
						<strong>{{ line.item_name || line.item_code }}</strong>
						<p>
							借出 {{ line.transfer_qty }} · 当前未结清 {{ line.outstanding_qty }}
							{{ line.stock_uom }}
						</p>
						<p>
							完好归还 {{ line.outcomes.Returned }} · 损坏
							{{ line.outcomes.Damaged }} · 遗失 {{ line.outcomes.Lost }}
							{{ line.stock_uom }}
						</p>
						<p>
							{{
								warehouseLabel(
									line.s_warehouse,
									reference.warehouses,
									line.s_warehouse_label,
								)
							}}
							→
							{{
								warehouseLabel(
									line.t_warehouse,
									reference.warehouses,
									line.t_warehouse_label,
								)
							}}
						</p>
					</article>
					<p class="preview-long-text">
						{{ c.current.value.loan.remarks || "未填写备注" }}
					</p>
				</template>
			</template>
		</div>
		<template #footer
			><UiButton v-if="c.current.value?.loan" :disabled="disabled" @click="openFull"
				>打开完整记录</UiButton
			><UiButton @click="c.close">关闭</UiButton></template
		>
	</Overlay>
</template>
