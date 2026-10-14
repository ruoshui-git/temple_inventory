<script setup lang="ts">
import PreviewSearchSelect from "./components/PreviewSearchSelect.vue";
import PreviewSetupWorkspace from "./components/PreviewSetupWorkspace.vue";
import { computed, reactive, ref, watch, onActivated, onDeactivated } from "vue";
import InventoryIcon from "../components/InventoryIcon.vue";
import PreviewUiButton from "./components/PreviewUiButton.vue";
import PreviewOverlay from "./PreviewOverlay.vue";
import { previewDate, textScales, type TextScale } from "./model";
import { previewPages, reviewSession, reviewMovementRows } from "./reviewModel";

import { matchesExpiry, groupMovements, quantityText } from "./browseModel";
import { moreNavigation } from "./navigation";

const props = withDefaults(
	defineProps<{
		page: string;
		variant: string;
		active?: boolean;
		textScale?: TextScale;
		density?: "compact" | "balanced" | "spacious";
	}>(),
	{
		active: true,
	},
);
const emit = defineEmits<{
	navigate: [page: string, variant: string];
	notify: [message: string];
	"update-text-scale": [scale: TextScale];
	"update-density": [density: "compact" | "balanced" | "spacious"];
}>();
type ReportType = "movement" | "movement_records" | "current_stock" | "warehouse_stock" | "expiry";
const reports: { type: ReportType; title: string; description: string; fields: string }[] = [
	{
		type: "movement",
		title: "货物流动汇总",
		description: "按日期、动作、类别和位置查看完成的库存流动。",
		fields: "日期、操作、物品、数量、来源与去向",
	},
	{
		type: "movement_records",
		title: "货物流动记录",
		description: "查看草稿、完成或取消的操作记录。",
		fields: "日期、记录编号、类型、状态、物品行、活动",
	},
	{
		type: "current_stock",
		title: "当前库存",
		description: "查看筛选范围内的物品总量、批次和位置。",
		fields: "编码、名称、类别、数量、单位、位置",
	},
	{
		type: "warehouse_stock",
		title: "仓库库存",
		description: "查看一个仓库节点及其下属位置的实际库存。",
		fields: "位置、编码、名称、类别、数量、单位",
	},
	{
		type: "expiry",
		title: "效期风险",
		description: "查看全部、临期、逾期或自选日期范围的批次。",
		fields: "批次、物品、类别、到期日、位置、数量",
	},
];
const movementLabels: Record<string, string> = {
	Receive: "入库",
	Issue: "出库",
	Transfer: "转移",
	Loan: "借出",
	Return: "归还",
	Damage: "标记损坏",
	Loss: "记录遗失",
	Repair: "修复归库",
	Disposal: "正式报废",
	Reconcile: "盘点",
	Opening: "期初库存",
};
const preferenceError = ref(false);
const preferencePending = ref(false);
const failPreference = ref(false);
const confirmedDensity = ref(props.density || "balanced");
const installPlatform = ref("ios");
const state = reactive({
	type: "movement" as ReportType,
	search: "",
	category: "",
	warehouse: "",
	movementKind: "",
	period: "this_month",
	dateFrom: "",
	dateTo: "",
	expiryMode: "all",
	expiryDays: "30",
	expiryFrom: "",
	expiryTo: "",
	exportOpen: false,
	exportFailed: false,
	exportFormat: "CSV",
	exportDataset: "summary",
	inStock: false,
	settingsDensity: "balanced",
	setupChecked: false,
	installOpen: false,
	logoutOpen: false,
	recovery: "idle" as "idle" | "expired" | "restored",
});
watch(
	() => [props.page, props.variant],
	([page, variant]) => {
		const report = String(variant).replaceAll("-", "_") as ReportType;
		if (reports.some((candidate) => candidate.type === report)) state.type = report;
		if (page === "report-export") state.exportOpen = true;
	},
	{ immediate: true },
);
watch(
	() => props.active,
	(active) => {
		if (!active) {
			state.exportOpen = false;
			state.installOpen = false;
			state.logoutOpen = false;
		}
	},
);
onDeactivated(() => {
	state.installOpen = false;
	state.logoutOpen = false;
	state.exportOpen = false;
});
onActivated(() => {
	state.settingsDensity = props.density || "balanced";
});
watch(
	() => props.density,
	(density) => {
		if (density) state.settingsDensity = density;
	},
);
const title = computed(
	() =>
		({
			reports: "报表与导出",
			"report-export": "导出范围复核",
			more: "工具",
			settings: "显示偏好 · 预览",
			setup: "配置检查 · 预览",
			recovery: "会话恢复 · 预览",
			"auth-complete": "身份验证完成 · 预览",
		})[props.page] || "更多工具",
);
const selectedReport = computed(() => reports.find((report) => report.type === state.type)!);
const categoryValues = computed(() => [
	...new Set(reviewSession.stock.map((item) => item.category)),
]);
const movementRows = computed(() =>
	reviewMovementRows().filter((row) => {
		const query = state.search.trim().toLocaleLowerCase();
		const matchText =
			!query ||
			[row.name, row.itemName, row.code, row.activity || "", row.borrower || ""].some(
				(value) => value.toLocaleLowerCase().includes(query),
			);
		const matchKind = !state.movementKind || row.kind === state.movementKind;
		const item = reviewSession.stock.find((candidate) => candidate.code === row.code);
		const matchCategory = !state.category || item?.category === state.category;
		const matchWarehouse =
			!state.warehouse ||
			[row.from, row.to].some((value) => value.includes(state.warehouse));
		const start =
			state.period === "this_month" ? `${previewDate.slice(0, 7)}-01` : state.dateFrom;
		const matchDate =
			(!start || row.date >= start) && (!state.dateTo || row.date <= state.dateTo);
		return (
			(state.type !== "movement" || row.docstatus === 1) &&
			matchText &&
			matchKind &&
			matchCategory &&
			matchWarehouse &&
			matchDate
		);
	}),
);
const stockRows = computed(() =>
	reviewSession.stock.filter((item) => {
		const query = state.search.trim().toLocaleLowerCase();
		return (
			(!query || `${item.code} ${item.name}`.toLocaleLowerCase().includes(query)) &&
			(!state.category || item.category === state.category) &&
			(!state.warehouse ||
				item.locations.some((row) => row.location.includes(state.warehouse)))
		);
	}),
);
const expiryRows = computed(() =>
	reviewSession.stock.flatMap((item) =>
		item.locations.flatMap((location) =>
			(location.batches || [])
				.filter((batch) => {
					const query = state.search.trim().toLocaleLowerCase();
					const expiry = batch.expiry || "";
					const today = previewDate;
					const maxSoon = new Date(`${today}T00:00:00Z`);
					maxSoon.setUTCDate(
						maxSoon.getUTCDate() + Math.max(1, Number(state.expiryDays) || 30),
					);
					const soon =
						!!expiry &&
						expiry >= today &&
						expiry <= maxSoon.toISOString().slice(0, 10);
					const matchesMode =
						(matchesExpiry(expiry || undefined, state.expiryMode) &&
							state.expiryMode !== "exact" &&
							state.expiryMode !== "soon") ||
						(state.expiryMode === "soon" && soon) ||
						(state.expiryMode === "expired" && !!expiry && expiry < today) ||
						(state.expiryMode === "exact" &&
							!!expiry &&
							expiry >= state.expiryFrom &&
							expiry <= state.expiryTo);
					return (
						item.tracksBatch &&
						(!state.inStock || batch.available > 0) &&
						matchesMode &&
						(!query ||
							`${item.name} ${item.code} ${batch.id}`
								.toLocaleLowerCase()
								.includes(query)) &&
						(!state.category || item.category === state.category) &&
						(!state.warehouse || location.location.includes(state.warehouse))
					);
				})
				.map((batch) => ({
					...batch,
					name: item.name,
					code: item.code,
					category: item.category,
					location: location.location,
					uom: item.uom,
				})),
		),
	),
);
const rows = computed(() =>
	state.type === "movement" || state.type === "movement_records"
		? movementRows.value
		: state.type === "expiry"
			? expiryRows.value
			: stockLocationRows.value,
);
const stockLocationRows = computed(() =>
	stockRows.value.flatMap((item) =>
		item.locations
			.filter((location) => !state.warehouse || location.location.includes(state.warehouse))
			.map((location) => ({ item, location })),
	),
);
const exportRows = computed(() => {
	if (state.type === "movement" || state.type === "movement_records") {
		if (state.exportDataset === "details")
			return movementRows.value.map(
				(row) =>
					`${row.name} · ${row.itemName} · ${movementLabels[row.kind]} · ${row.from} → ${row.to} · ${row.batch || "不分批次"} · ${row.qty} ${row.uom}`,
			);
		if (state.type === "movement")
			return groupMovements(movementRows.value).map(
				(group) =>
					`${group.code} · ${group.name} · ${group.totals.map((total) => `${movementLabels[total.kind]} ${total.text}`).join(" · ")}`,
			);
		return [...new Set(movementRows.value.map((row) => row.name))].map(
			(name) =>
				`${name} · ${quantityText(movementRows.value.filter((row) => row.name === name))}`,
		);
	}
	if (state.type === "expiry")
		return expiryRows.value.map(
			(row) =>
				`${row.code} · ${row.id} · ${row.expiry || "无效期"} · ${row.location} · ${row.available} ${row.uom}`,
		);
	if (state.exportDataset === "summary")
		return stockRows.value.map(
			(item) =>
				`${item.code} · ${item.name} · ${item.locations.filter((location) => !state.warehouse || location.location.includes(state.warehouse)).reduce((sum, location) => sum + location.available, 0)} ${item.uom}`,
		);
	return stockLocationRows.value.map(
		({ item, location }) =>
			`${item.code} · ${item.name} · ${location.location} · ${location.available} ${item.uom}`,
	);
});
const canExport = computed(() => state.type !== "warehouse_stock" || !!state.warehouse);
function chooseReport(type: ReportType) {
	state.type = type;
	state.exportOpen = false;
}
function openExport() {
	if (!canExport.value) {
		emit("notify", "请选择一个仓库节点后查看导出范围");
		return;
	}
	if (
		state.type === "expiry" &&
		state.expiryMode === "exact" &&
		(!state.expiryFrom || !state.expiryTo || state.expiryFrom > state.expiryTo)
	) {
		emit("notify", "请选择有效的效期开始和结束日期");
		return;
	}
	state.exportDataset = state.type === "expiry" ? "details" : "summary";
	state.exportOpen = true;
	state.exportFailed = false;
}
function simulateExport() {
	if (state.exportFailed) {
		state.exportFailed = false;
		emit("notify", `已模拟生成 ${exportRows.value.length} 条${state.exportFormat}记录`);
	} else {
		state.exportFailed = true;
	}
}
function navigateByKey(key: string) {
	const target = previewPages.find((route) => route.key === key);
	if (target) emit("navigate", target.page, target.variant);
}
function recoverSession() {
	if (state.recovery === "restored" || props.page === "auth-complete") {
		emit("navigate", "drafts", "open");
		return;
	}
	state.recovery = "restored";
	emit("notify", "示例会话已恢复，草稿输入仍保留");
}
function updateDensity(density: "compact" | "balanced" | "spacious") {
	state.settingsDensity = density;
	document.documentElement.dataset.previewDensity = density;
	emit("update-density", density);
	preferencePending.value = true;
	preferenceError.value = failPreference.value;
	if (!preferenceError.value) {
		confirmedDensity.value = density;
		preferencePending.value = false;
	}
}
function retryPreference() {
	preferenceError.value = false;
	preferencePending.value = false;
	confirmedDensity.value = state.settingsDensity as "compact" | "balanced" | "spacious";
}
</script>

<template>
	<section class="preview-utility-page">
		<header class="utility-heading">
			<div>
				<span class="eyebrow">UTILITY WORKFLOW · PREVIEW</span>
				<h1>{{ title }}</h1>
				<p class="muted">功能与反馈均为可交互样本，不连接账户设置或服务端。</p>
			</div>
			<span class="utility-sample-tag">预览样本</span>
		</header>
		<template v-if="page === 'reports' || page === 'report-export'">
			<div v-if="page === 'reports'" class="report-catalog">
				<button
					v-for="report in reports"
					:key="report.type"
					class="report-card surface"
					:aria-pressed="state.type === report.type"
					@click="chooseReport(report.type)"
				>
					<span class="report-card-icon"><InventoryIcon name="table" /></span
					><span
						><strong>{{ report.title }}</strong
						><small>{{ report.description }}</small
						><em>固定字段：{{ report.fields }}</em></span
					><span aria-hidden="true">→</span>
				</button>
			</div>
			<section class="surface report-workspace">
				<div class="report-toolbar">
					<div>
						<h2>{{ selectedReport.title }}</h2>
						<p class="muted">调整条件后，样本结果与导出复核范围会同步变化。</p>
					</div>
					<PreviewUiButton variant="primary" icon="download" @click="openExport"
						>复核并导出</PreviewUiButton
					>
				</div>
				<div class="report-filters">
					<label class="preview-field"
						>搜索<input
							v-model="state.search"
							type="search"
							placeholder="物品、编号或活动"
					/></label>
					<PreviewSearchSelect
						label="物品类别"
						v-model="state.category"
						:options="categoryValues"
					/>
					<PreviewSearchSelect
						label="仓库 / 位置"
						v-model="state.warehouse"
						:options="
							reviewSession.warehouses.map((node) => ({
								value: node.name,
								label: node.label || node.name,
							}))
						"
					/>
					<template v-if="state.type === 'movement' || state.type === 'movement_records'"
						><label class="preview-field"
							>操作类型<select v-model="state.movementKind">
								<option value="">全部操作</option>
								<option
									v-for="kind in [
										'Receive',
										'Issue',
										'Transfer',
										'Loan',
										'Return',
										'Damage',
										'Loss',
										'Repair',
										'Disposal',
									]"
									:key="kind"
									:value="kind"
								>
									{{ movementLabels[kind] }}
								</option>
							</select></label
						><label class="preview-field"
							>日期范围<select v-model="state.period">
								<option value="this_month">本月</option>
								<option value="custom">自选日期</option>
							</select></label
						><template v-if="state.period === 'custom'"
							><label class="preview-field"
								>开始日期<input v-model="state.dateFrom" type="date" /></label
							><label class="preview-field"
								>结束日期<input
									v-model="state.dateTo"
									type="date" /></label></template
					></template>
					<template v-if="state.type === 'expiry'"
						><label class="preview-field"
							>效期范围<select v-model="state.expiryMode">
								<option value="all">全部</option>
								<option value="unexpired">未过期</option>
								<option value="undated">无效期</option>
								<option value="soon">0–30天内到期（指定窗口）</option>
								<option value="expired">已过期</option>
								<option value="exact">指定日期范围</option>
							</select></label
						><label class="preview-field" v-if="state.expiryMode === 'soon'"
							>未来天数<input
								v-model="state.expiryDays"
								type="number"
								min="1" /></label
						><template v-if="state.expiryMode === 'exact'"
							><label class="preview-field"
								>到期日从<input v-model="state.expiryFrom" type="date" /></label
							><label class="preview-field"
								>到期日到<input
									v-model="state.expiryTo"
									type="date" /></label></template
					></template>
					<label
						v-if="state.type === 'expiry'"
						class="preview-choice-label preview-check"
						><input v-model="state.inStock" type="checkbox" />仅有库存批次</label
					>
					<p v-if="state.type === 'warehouse_stock'" class="filter-note">
						仓库库存报表必须选择一个具体仓库或位置。
					</p>
				</div>
				<div class="report-result-heading">
					<strong>筛选结果</strong><span>{{ rows.length }} 条样本记录</span>
				</div>
				<div class="report-table-wrap">
					<table>
						<thead>
							<tr>
								<th
									v-if="
										state.type === 'movement' ||
										state.type === 'movement_records'
									"
								>
									日期
								</th>
								<th
									v-if="
										state.type === 'movement' ||
										state.type === 'movement_records'
									"
								>
									操作
								</th>
								<th>物品 / 记录</th>
								<th>类别 / 状态</th>
								<th>位置</th>
								<th>数量</th>
							</tr>
						</thead>
						<tbody>
							<template
								v-if="
									state.type === 'movement' || state.type === 'movement_records'
								"
								><tr v-for="row in movementRows" :key="row.name">
									<td>{{ row.date }}</td>
									<td>{{ movementLabels[row.kind] || row.kind }}</td>
									<td>
										{{ row.itemName }}<small>{{ row.name }}</small>
									</td>
									<td>
										{{
											row.docstatus === 1
												? "已完成"
												: row.docstatus === 0
													? "草稿"
													: "已取消"
										}}
									</td>
									<td>{{ row.from }} → {{ row.to }}</td>
									<td>{{ row.qty }} {{ row.uom }}</td>
								</tr></template
							>
							<template
								v-else-if="
									state.type === 'current_stock' ||
									state.type === 'warehouse_stock'
								"
								><tr
									v-for="row in stockLocationRows"
									:key="row.item.code + row.location.location"
								>
									<td>
										{{ row.item.name }}<small>{{ row.item.code }}</small>
									</td>
									<td>{{ row.item.category }}</td>
									<td>{{ row.location.location }}</td>
									<td>{{ row.location.available }} {{ row.item.uom }}</td>
								</tr></template
							>
							<template v-else
								><tr
									v-for="row in expiryRows"
									:key="row.code + row.id + row.location"
								>
									<td>
										{{ row.name
										}}<small
											>{{ row.code }} · {{ row.id }} · 到期
											{{ row.expiry }}</small
										>
									</td>
									<td>{{ row.category }}</td>
									<td>{{ row.location }}</td>
									<td>{{ row.available }} {{ row.uom }}</td>
								</tr></template
							>
							<tr v-if="!rows.length">
								<td colspan="6" class="report-empty">
									当前条件下没有匹配的预览记录。
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>
			<PreviewOverlay
				v-if="state.exportOpen"
				title="确认导出范围"
				@close="state.exportOpen = false"
				><p>{{ selectedReport.title }} · 依据当前全部筛选条件</p>
				<label class="preview-field"
					>文件格式<select v-model="state.exportFormat">
						<option>CSV</option>
						<option>XLSX</option>
					</select></label
				>
				<label class="preview-field" v-if="state.type !== 'expiry'"
					>导出内容<select v-model="state.exportDataset">
						<option value="summary">
							{{ state.type === "movement_records" ? "操作记录" : "物品汇总" }}
						</option>
						<option value="details">逐行明细</option>
					</select></label
				>
				<ul>
					<li v-for="(row, index) in exportRows" :key="index">{{ row }}</li>
				</ul>
				<div class="export-scope">
					<strong>{{ exportRows.length }} 条结果</strong
					><small>字段：{{ selectedReport.fields }}</small
					><small v-if="state.warehouse">位置：{{ state.warehouse }}</small
					><small v-if="state.search">搜索：{{ state.search }}</small>
				</div>
				<p v-if="state.exportFailed" class="utility-error" role="alert">
					模拟导出失败，筛选和输入内容已保留，可重试。
				</p>
				<template #footer
					><PreviewUiButton variant="secondary" @click="state.exportOpen = false"
						>返回修改</PreviewUiButton
					><PreviewUiButton variant="primary" @click="simulateExport">{{
						state.exportFailed ? "重试导出" : "模拟导出"
					}}</PreviewUiButton></template
				></PreviewOverlay
			>
		</template>
		<template v-else-if="page === 'more'">
			<section v-for="group in moreNavigation" :key="group.label" class="more-section">
				<h2>{{ group.label }}</h2>
				<div class="more-grid">
					<button
						v-for="item in group.items"
						:key="item.key"
						class="more-card surface"
						@click="navigateByKey(item.route)"
					>
						<span><InventoryIcon :name="item.icon" /></span
						><strong
							>{{ item.label
							}}<span v-if="item.key === 'drafts'" class="count-dot">{{
								reviewSession.drafts.filter((draft) => draft.status === "draft")
									.length
							}}</span></strong
						>
						<small>{{ item.description }}</small>
					</button>
				</div>
			</section>
			<section class="more-section">
				<PreviewUiButton @click="emit('navigate', 'setup', 'default')"
					>配置与恢复</PreviewUiButton
				>
				<h2>账户与设备</h2>
				<div class="more-grid">
					<button class="more-card surface" @click="state.installOpen = true">
						<span><InventoryIcon name="download" /></span
						><strong>安装到手机 / 电脑</strong
						><small>添加到主屏幕，方便下次打开</small>
					</button>
					<div class="more-card surface">
						<strong>当前账户</strong>
						<p>System Manager · 示例账户</p>
						<PreviewUiButton variant="danger" @click="state.logoutOpen = true"
							>退出登录</PreviewUiButton
						>
					</div>
				</div>
			</section>
			<PreviewOverlay
				v-if="state.installOpen"
				title="安装到手机 / 电脑"
				@close="state.installOpen = false"
			>
				<p>
					手机浏览器：打开分享或浏览器菜单，选择「添加到主屏幕」。电脑浏览器：使用地址栏或菜单中的「安装应用」。
				</p>
				<label class="preview-field"
					>设备<select v-model="installPlatform">
						<option value="ios">iPhone / iPad Safari</option>
						<option value="chromium">Chrome / Edge</option>
						<option value="unsupported">其他浏览器</option>
					</select></label
				>
				<p>
					{{
						installPlatform === "ios"
							? "Safari → 分享 → 添加到主屏幕"
							: installPlatform === "chromium"
								? "浏览器菜单 → 安装应用；不可安装时可添加书签。"
								: "此浏览器不支持安装，可添加书签继续使用。"
					}}
				</p>
				<p class="muted">预览不注册服务工作线程。</p>
				<template #footer
					><PreviewUiButton @click="state.installOpen = false"
						>知道了</PreviewUiButton
					></template
				>
			</PreviewOverlay>
			<PreviewOverlay
				v-if="state.logoutOpen"
				title="退出登录"
				@close="state.logoutOpen = false"
			>
				<p>这是退出登录的交互样本，确认后保留本次预览中的输入和草稿。</p>
				<template #footer
					><PreviewUiButton @click="state.logoutOpen = false">取消</PreviewUiButton
					><PreviewUiButton
						variant="danger"
						@click="
							state.logoutOpen = false;
							emit('notify', '已模拟退出登录，预览数据仍保留');
						"
						>确认退出</PreviewUiButton
					></template
				>
			</PreviewOverlay>
		</template>
		<template v-else-if="page === 'settings'"
			><section class="surface utility-panel">
				<h2>文字大小</h2>
				<label class="preview-field"
					>文字大小<select
						aria-label="文字大小"
						:value="textScale || 100"
						@change="
							emit(
								'update-text-scale',
								Number(($event.target as HTMLSelectElement).value) as TextScale,
							)
						"
					>
						<option v-for="scale in textScales" :key="scale" :value="scale">
							{{ scale }}%
						</option>
					</select></label
				>
				<p>文字示例：核对物品、数量和库位后确认。</p>
				<PreviewUiButton @click="emit('update-text-scale', 100)">恢复默认</PreviewUiButton>
				<h2>显示密度</h2>
				<p v-if="preferenceError" role="alert">
					偏好保存失败，当前显示保留；确认的偏好仍为
					{{ confirmedDensity }}。<PreviewUiButton @click="retryPreference"
						>重试保存偏好</PreviewUiButton
					>
				</p>
				<p v-else-if="!preferencePending" role="status">
					预览偏好已确认：{{ confirmedDensity }}
				</p>
				<details>
					<summary>预览偏好状态</summary>
					<label class="preview-choice-label"
						><input v-model="failPreference" type="checkbox" />下次保存失败</label
					>
				</details>
				<p class="muted">此处只改变预览显示，不会保存到账户。</p>
				<div class="density-choice">
					<label
						class="preview-choice-label"
						v-for="option in [
							{ value: 'compact', label: '紧凑' },
							{ value: 'balanced', label: '均衡' },
							{ value: 'spacious', label: '宽松' },
						]"
						:key="option.value"
						><input
							type="radio"
							name="preview-density"
							:value="option.value"
							:checked="state.settingsDensity === option.value"
							@change="
								updateDensity(option.value as 'compact' | 'balanced' | 'spacious')
							"
						/><span>{{ option.label }}</span></label
					>
				</div>
				<PreviewUiButton
					variant="primary"
					@click="emit('notify', `预览密度：${state.settingsDensity}；不写入账户设置`)"
					>应用于此预览</PreviewUiButton
				>
			</section></template
		>
		<template v-else-if="page === 'setup'"><PreviewSetupWorkspace /></template>
		<template v-else-if="page === 'recovery' || page === 'auth-complete'"
			><section class="surface utility-panel recovery-panel">
				<span class="recovery-mark"
					><InventoryIcon
						:name="
							state.recovery === 'restored' || page === 'auth-complete'
								? 'check'
								: 'notice'
						"
				/></span>
				<h2>
					{{
						state.recovery === "restored" || page === "auth-complete"
							? "已恢复到预览会话"
							: "登录状态已过期"
					}}
				</h2>
				<p>输入的表单与草稿保留在本次预览会话中；恢复过程使用模拟反馈。</p>
				<div v-if="state.recovery === 'expired'" class="utility-error" role="alert">
					网络恢复后可以继续，不需要重新录入。
				</div>
				<PreviewUiButton variant="primary" @click="recoverSession">{{
					state.recovery === "restored" || page === "auth-complete"
						? "返回刚才的工作"
						: "模拟验证并继续"
				}}</PreviewUiButton
				><button class="utility-link" @click="navigateByKey('drafts/open')">
					查看保留的草稿样本
				</button>
			</section></template
		>
	</section>
</template>
