<script setup lang="ts">
import ItemImagePreview from "../../components/ItemImagePreview.vue";
import AttachmentList from "../../components/AttachmentList.vue";
import { type LoanDetailController } from "./useLoanDetailController";

const props = defineProps<{ controller: LoanDetailController }>();
const { loan, selected, error, begin, close, retry } = props.controller;
</script>
<template>
	<section class="app-shell">
		<header>
			<button type="button" @click="close">‹ 返回</button>
			<h1>借用详情</h1>
		</header>
		<p v-if="error" class="error">
			{{ error }} <button type="button" @click="retry">重试</button>
		</p>
		<template v-if="loan"
			><h2>{{ loan.borrower || "借用方未登记" }}</h2>
			<p>{{ loan.posting_datetime }} · {{ loan.activity || "无活动" }}</p>
			<article v-for="row in loan.items" :key="row.loan_item" class="item-card">
				<label
					><input
						v-model="selected"
						type="checkbox"
						:value="row.loan_item"
						:aria-label="`选择 ${row.item_name}`" /></label
				><ItemImagePreview :src="row.image" :alt="row.item_name" />
				<div>
					<b>{{ row.item_name }}</b>
					<p>
						借出 {{ row.loaned }} · 已归还 {{ row.returned }} · 损坏
						{{ row.damaged }} · 遗失 {{ row.lost }}
					</p>
					<p>尚未结清 {{ row.outstanding }} {{ row.uom }}</p>
				</div>
			</article>
			<AttachmentList :attachments="loan.attachments" />
			<div v-if="selected.length" class="context-action-bar">
				<span>已选 {{ selected.length }} 项</span
				><button type="button" @click="begin('Return')">归还</button
				><button type="button" @click="begin('Loss')">记录遗失</button>
			</div></template
		>
	</section>
</template>
