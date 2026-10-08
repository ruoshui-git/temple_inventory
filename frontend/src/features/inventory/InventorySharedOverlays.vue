<script setup lang="ts">
import Scanner from "../../components/Scanner.vue";
import ExportDialog from "../../components/ExportDialog.vue";
import { type InventoryController } from "./useInventoryController";

const props = defineProps<{ controller: InventoryController }>();
const {
	exportOpen,
	exportFilters,
	selection,
	selected,
	operationCaps,
	selectedOperation,
	scanner,
	scanBusy,
	scan,
	unknownBarcodePrompt,
	dismissUnknownItem,
	createUnknownItem,
} = props.controller;
</script>

<template>
	<div
		v-if="selection && selected.length"
		class="context-action-bar"
		role="toolbar"
		aria-label="已选物品操作"
	>
		<span>已选 {{ selected.length }} 项</span
		><template v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan']" :key="kind"
			><button v-if="operationCaps[kind]" type="button" @click="selectedOperation(kind)">
				{{
					(
						{
							Receive: "入库",
							Issue: "出库",
							Transfer: "转移",
							Loan: "借出",
						} as any
					)[kind]
				}}
			</button></template
		>
	</div>
	<Scanner
		v-if="scanner"
		presentation="modal"
		:paused="scanBusy"
		@scan="scan"
		@close="scanner = false"
	/>
	<div
		v-if="unknownBarcodePrompt"
		class="modal"
		role="presentation"
		@click.self="dismissUnknownItem"
	>
		<section role="dialog" aria-modal="true" aria-labelledby="unknown-barcode-title">
			<h2 id="unknown-barcode-title">未找到物品</h2>
			<p>没有找到条码 {{ unknownBarcodePrompt }} 对应的物品。要现在新建物品吗？</p>
			<div class="detail-actions">
				<button type="button" @click="dismissUnknownItem">取消</button
				><button type="button" class="primary" @click="createUnknownItem">新建物品</button>
			</div>
		</section>
	</div>
	<ExportDialog
		v-model:open="exportOpen"
		report-type="current_stock"
		:filters="exportFilters"
		title="导出当前库存"
		summary="沿用当前搜索、类别、仓库和排序条件，包含物品汇总与批次明细。"
	/>
</template>
