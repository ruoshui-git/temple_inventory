<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../components/ui/UiButton.vue";
import { items, locations } from "./model";
const rows = ref(
	Array.from({ length: 30 }, (_, index) => ({
		id: index + 1,
		item: items[index % items.length],
		qty: 1,
		location: locations[index % locations.length],
	})),
);
const expanded = ref<number>();
const batchNotes = ref<Record<number, string>>({});
</script>
<template>
	<section class="surface gallery-section dense-lines-sample">
		<div class="section-heading">
			<h2>紧凑行项目 · 布局样本</h2>
			<span class="eyebrow">09 / DENSITY</span>
		</div>
		<p class="muted">
			30 行测试文字、数量输入与表格密度。复杂字段按需展开；完整创建流程留待后续设计。
		</p>
		<div class="dense-lines-scroll">
			<table class="preview-table dense-lines-table">
				<caption class="sr-only">
					紧凑入库行项目样本
				</caption>
				<thead>
					<tr>
						<th>物品</th>
						<th>数量</th>
						<th>位置</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					<template v-for="row in rows" :key="row.id"
						><tr>
							<td>{{ row.id }}. {{ row.item.name }}</td>
							<td>
								<label class="inline-field"
									><input
										v-model.number="row.qty"
										:aria-label="`第${row.id}行数量`"
										type="number"
										min="0.000001"
										step="any"
										:aria-invalid="!(row.qty > 0)"
									/>{{ row.item.uom }}</label
								><small v-if="!(row.qty > 0)" class="text-danger"
									>数量须大于 0</small
								>
							</td>
							<td>
								<select v-model="row.location" :aria-label="`第${row.id}行位置`">
									<option v-for="location in locations" :key="location">
										{{ location }}
									</option>
								</select>
							</td>
							<td>
								<UiButton
									v-if="row.item.tracksBatch"
									variant="ghost"
									:aria-expanded="expanded === row.id"
									@click="expanded = expanded === row.id ? undefined : row.id"
									>批次信息</UiButton
								><span v-else class="muted">—</span>
							</td>
						</tr>
						<tr v-if="expanded === row.id">
							<td colspan="4">
								<label class="preview-field field"
									>批次备注（布局样本）<input
										v-model="batchNotes[row.id]"
										:aria-label="`第${row.id}行批次备注`"
										placeholder="按需展开的补充字段"
								/></label>
							</td></tr
					></template>
				</tbody>
			</table>
		</div>
	</section>
</template>
