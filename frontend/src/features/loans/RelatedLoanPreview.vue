<script setup lang="ts">
import { unitLabel } from "../../lib/units";
import { ref, watch, nextTick } from "vue";
import type { useRelatedLoans } from "./useRelatedLoans";
import Overlay from "../../components/ui/Overlay.vue";
import UiButton from "../../components/ui/UiButton.vue";
import SkeletonBlock from "../../components/ui/SkeletonBlock.vue";
import NativeStatusBadge from "../../components/ui/NativeStatusBadge.vue";
import LocationEndpoint from "../../components/ui/LocationEndpoint.vue";
import ItemImage from "../../components/ItemImage.vue";
import type { LoanLine } from "./useLoanDetail";

const props = defineProps<{
	controller: ReturnType<typeof useRelatedLoans>;
	disabled?: boolean;
}>();
const emit = defineEmits<{ openFull: [name: string] }>();
const c = props.controller;
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
function item(line: LoanLine) {
	return {
		code: line.item_code,
		name: line.item_name || line.item_code,
		image: String(line.ti_display_image || line.image || ""),
	};
}
function settlement(line: LoanLine) {
	const total =
		Number(line.outcomes.Returned || 0) +
		Number(line.outcomes.Damaged || 0) +
		Number(line.outcomes.Lost || 0);
	return total > 0
		? `已结算 ${total} ${unitLabel(line.stock_uom)}`
		: `未结清 ${unitLabel(line.stock_uom)}`;
}
</script>

<template>
	<Overlay v-if="c.open.value" title="原借出记录 · 只读" adaptive-creation @close="c.close">
		<div ref="stage" class="related-loan-content" tabindex="-1">
			<p>这笔记录结算的是以下借出记录。数量与结清情况以原借出为准。</p>
			<template v-if="!c.selected.value">
				<article v-for="name in c.names.value" :key="name" class="related-loan-choice">
					<SkeletonBlock v-if="c.records[name]?.loading" variant="lines" :count="3" />
					<template v-else-if="c.records[name]?.loan">
						<button
							class="related-loan-card"
							type="button"
							@click="c.selected.value = name"
						>
							<dl class="ti-fields">
								<div>
									<dt>借用方</dt>
									<dd>{{ c.records[name]!.loan!.ti_borrower || "未填写" }}</dd>
								</div>
								<div>
									<dt>借出日期</dt>
									<dd>{{ c.records[name]!.loan!.posting_date }}</dd>
								</div>
								<div>
									<dt>活动</dt>
									<dd>
										{{ c.records[name]!.loan!.activity_title || "未关联活动" }}
									</dd>
								</div>
								<div>
									<dt>状态</dt>
									<dd>
										<NativeStatusBadge
											:status="c.records[name]!.loan!.docstatus"
										/>
										·
										{{
											c.records[name]!.loan!.items.some(
												(line) => Number(line.outstanding_qty) > 0,
											)
												? "未结清"
												: "已结清"
										}}
									</dd>
								</div>
							</dl>
							<span class="related-loan-thumbnails">
								<ItemImage
									v-for="line in c.records[name]!.loan!.items.slice(0, 5)"
									:key="line.name"
									:item="item(line)"
									:thumbnail-size="28"
									:target-size="28"
								/>
								<small v-if="c.records[name]!.loan!.items.length > 5"
									>等 {{ c.records[name]!.loan!.items.length - 5 }} 种</small
								>
							</span>
							<small class="muted">{{ name }}</small>
						</button>
					</template>
					<p v-else role="alert">
						借出记录暂不可用 <UiButton @click="c.retry(name)">重试</UiButton>
					</p>
				</article>
			</template>
			<template v-else>
				<UiButton v-if="c.names.value.length > 1" @click="c.selected.value = ''"
					>全部原借出记录</UiButton
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
					<dl class="ti-fields related-loan-header">
						<div>
							<dt>借用方</dt>
							<dd>{{ c.current.value.loan.ti_borrower || "未填写" }}</dd>
						</div>
						<div>
							<dt>借出日期</dt>
							<dd>{{ c.current.value.loan.posting_date }}</dd>
						</div>
						<div>
							<dt>活动</dt>
							<dd>{{ c.current.value.loan.activity_title || "未关联活动" }}</dd>
						</div>
						<div>
							<dt>状态</dt>
							<dd>
								<NativeStatusBadge :status="c.current.value.loan.docstatus" /> ·
								{{
									c.current.value.loan.items.some(
										(line) => Number(line.outstanding_qty) > 0,
									)
										? "未结清"
										: "已结清"
								}}
							</dd>
						</div>
						<div>
							<dt>单据</dt>
							<dd>{{ c.current.value.loan.name }}</dd>
						</div>
					</dl>
					<div class="related-loan-table-scroll">
						<table class="related-loan-table">
							<thead>
								<tr>
									<th>物品</th>
									<th>借出</th>
									<th>完好归还</th>
									<th>损坏</th>
									<th>遗失</th>
									<th>未结清</th>
									<th>原存放</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="line in c.current.value.loan.items" :key="line.name">
									<td>
										<span class="related-loan-item"
											><ItemImage
												:item="item(line)"
												:thumbnail-size="24"
												:target-size="24"
											/><strong>{{
												line.item_name || line.item_code
											}}</strong></span
										>
									</td>
									<td>
										{{ line.transfer_qty }} {{ unitLabel(line.stock_uom) }}
									</td>
									<td>
										{{ line.outcomes.Returned }}
										{{ unitLabel(line.stock_uom) }}
									</td>
									<td>
										{{ line.outcomes.Damaged }} {{ unitLabel(line.stock_uom) }}
									</td>
									<td>
										{{ line.outcomes.Lost }} {{ unitLabel(line.stock_uom) }}
									</td>
									<td>
										{{ line.outstanding_qty }} {{ unitLabel(line.stock_uom) }}
									</td>
									<td>
										<LocationEndpoint
											:warehouse="line.s_warehouse"
											kind="Loan"
											role="来源位置"
										/>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
					<div v-if="c.current.value.loan.remarks" class="related-loan-remarks">
						<strong>备注</strong>
						<p class="preview-long-text">{{ c.current.value.loan.remarks }}</p>
					</div>
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
