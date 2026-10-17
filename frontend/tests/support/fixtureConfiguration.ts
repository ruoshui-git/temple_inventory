/** Development-only setup scenarios; no account, warehouse or stock RPCs. */
import { reactive } from "vue";
import { reviewSession } from "./reviewModel";
import {
  fixtureWarehouseCall,
  templeRoot,
  physicalRoot,
} from "./fixtureWarehouses";
import type {
  ConfigurationStatus,
  RepairPreview,
} from "../../src/features/setup/useConfiguration";
export const fixtureConfiguration = reactive({
  scenario: "ready",
  revision: 1,
  overrides: {} as Record<string, string>,
});
const pointers = [
  ["root_warehouse", "寺院仓库根目录", templeRoot],
  ["physical_root_warehouse", "实体仓库根目录", physicalRoot],
  ["leased_warehouse", "借出仓库组", "借出"],
  ["default_lease_program_warehouse", "默认借出库位", "借出 / 法会义工组"],
  ["damaged_warehouse", "损坏库位", "损坏待处理 / 斋堂"],
] as const;
function status(): ConfigurationStatus {
  fixtureWarehouseCall("warehouses.tree", {});
  const scenario = fixtureConfiguration.scenario;
  if (["guest", "role", "denied"].includes(scenario))
    throw new Error(
      {
        guest: "请先登录",
        role: "此应用目前仅供 System Manager 使用",
        denied: "已配置仓库存在，但当前账户无权读取；请核对授权，不能重新创建",
      }[scenario],
    );
  return {
    version: String(fixtureConfiguration.revision),
    ready: scenario === "ready",
    setup_required: scenario !== "ready",
    is_manager: true,
    can_initialize: scenario === "new",
    companies: ["图库示例"],
    selected_company: "图库示例",
    warnings: [],
    blockers:
      scenario === "ready"
        ? []
        : [
            {
              code: scenario,
              message:
                scenario === "new"
                  ? "尚未建立必需仓库"
                  : scenario === "metadata"
                    ? "物理仓库的类型需要在仓库资料中核对"
                    : "实体仓库根引用已失效，请查看影响后修复",
            },
          ],
    pointers: pointers.map(([field, label, current]) => ({
      field,
      label,
      current:
        scenario === "new"
          ? ""
          : scenario === "root" && field === "physical_root_warehouse"
            ? "已不存在的仓库"
            : fixtureConfiguration.overrides[field] || current,
      issue: scenario === "ready" ? "" : "missing",
    })),
    candidates: reviewSession.warehouses.map((row) => ({
      value: row.name,
      label: row.label,
      group: row.is_group,
      parent: row.parent || "",
      type: row.warehouse_type,
      version: "1",
    })),
  };
}
function preview(args: Record<string, unknown>): RepairPreview {
  const value = status(),
    pointer = value.pointers.find((row) => row.field === args.field),
    replacement = value.candidates.find((row) => row.value === args.warehouse);
  if (!pointer || !replacement)
    throw new Error("请选择当前可读取的配置项与替代仓库");
  return {
    field: pointer.field,
    label: pointer.label,
    current: pointer.current,
    replacement: replacement.value,
    version: value.version,
    visible_nodes: 1,
    visible_leaves: replacement.group ? 0 : 1,
    impact:
      "仅修改此配置引用，仓库上级与库存数量保持原样。请同时核对其它引用。",
    affected_references: value.pointers
      .filter((row) => row.field !== pointer.field)
      .map((row) => ({ field: row.field, warehouse: row.current })),
    fingerprint: JSON.stringify([
      value.version,
      pointer.field,
      replacement.value,
    ]),
  };
}
export function fixtureConfigurationCall(
  endpoint: string,
  args: Record<string, unknown>,
) {
  if (endpoint === "configuration.status") return status();
  if (endpoint === "configuration.repair_preview") return preview(args);
  if (args.version !== String(fixtureConfiguration.revision))
    throw new Error("配置已更改，请重新检查");
  if (endpoint === "configuration.initialize") {
    if (fixtureConfiguration.scenario !== "new" || args.company !== "图库示例")
      throw new Error("已有配置，不能重新初始化");
  } else if (endpoint === "configuration.repair_pointer") {
    if (
      args.confirmed !== true ||
      preview(args).fingerprint !== args.fingerprint
    )
      throw new Error("请核对当前修复影响后明确确认");
    fixtureConfiguration.overrides[String(args.field)] = String(args.warehouse);
  } else throw new Error("未实现的图库配置操作");
  fixtureConfiguration.revision++;
  fixtureConfiguration.scenario = "ready";
  return status();
}
