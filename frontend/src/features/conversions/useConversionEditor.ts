import { useUpdateBlocker } from "../../lib/updateSafety";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  applyLineConversion,
  conversionError,
  conversionFactorError,
  enteredQty,
  type ConversionLine,
} from "../../lib/quantityConversion";
import type { StockItem } from "../../lib/stockPresentation";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { useReferenceCreation } from "../references/useReferenceCreation";

export interface SavedItemConversions {
  item_code: string;
  version: string;
  stock_uom: string;
  conversions: { uom: string; conversion_factor: number }[];
}
export function useConversionEditor(
  props: {
    line: ConversionLine;
    item: StockItem;
    selectedUnit?: string;
    reusableOnly?: boolean;
    disabled?: boolean;
  },
  applied: () => void,
  dirtyChanged: (value: boolean) => void,
  itemUpdated: (value: SavedItemConversions) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData();
  const unit = ref(props.selectedUnit || props.line.entryUom || props.line.uom),
    quantity = ref(enteredQty(props.line)),
    factor = ref<number | string>("");
  const canUpdate = computed(() => true);
  const reuse = ref(canUpdate.value),
    busy = ref(false),
    error = ref(""),
    conflict = ref(false);
  const version = ref(props.item.version || "");
  const conversions = ref([...(props.item.alternateUnits || [])]);
  const savedFactor = computed(() =>
    unit.value === props.line.uom
      ? 1
      : conversions.value.find((row) => row.uom === unit.value)?.factor,
  );
  const creation = useReferenceCreation("unit", (name) => {
    unit.value = name;
  });
  let disposed = false;
  onBeforeUnmount(() => {
    disposed = true;
  });
  watch(
    unit,
    () => {
      factor.value =
        unit.value === props.line.entryUom
          ? (props.line.conversionFactor ?? savedFactor.value ?? "")
          : (savedFactor.value ?? "");
      quantity.value =
        unit.value === props.line.entryUom
          ? enteredQty(props.line)
          : savedFactor.value
            ? props.line.qty / savedFactor.value
            : enteredQty(props.line);
    },
    { immediate: true },
  );
  const snapshot = () =>
    JSON.stringify([
      unit.value,
      factor.value,
      quantity.value,
      reuse.value,
      creation.name.value,
      creation.whole.value,
      creation.creating.value,
    ]);
  const baseline = ref(snapshot());
  const dirty = computed(
    () =>
      snapshot() !== baseline.value ||
      unit.value !== (props.line.entryUom || props.line.uom),
  );
  watch(dirty, dirtyChanged, { immediate: true });
  watch(canUpdate, (value) => {
    if (!value) reuse.value = false;
  });
  const replacement = computed(
    () =>
      (reuse.value || props.reusableOnly) &&
      savedFactor.value !== undefined &&
      Number(factor.value) !== savedFactor.value,
  );
  async function reload() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      const item = await services.call<{
        version: string;
        stock_uom: string;
        uoms: { uom: string; conversion_factor: number }[];
      }>("catalog.item_detail", { item_code: props.item.code });
      if (disposed) return;
      if (item.stock_uom !== props.line.uom)
        throw new Error("物品库存单位已变化，请保留输入并重新打开物品");
      version.value = item.version;
      conversions.value = item.uoms.map((row) => ({
        uom: row.uom,
        factor: row.conversion_factor,
      }));
      itemUpdated({
        item_code: props.item.code,
        version: item.version,
        stock_uom: item.stock_uom,
        conversions: item.uoms,
      });
      conflict.value = false;
    } catch (reason) {
      if (!disposed)
        error.value =
          reason instanceof Error ? reason.message : "读取常用换算失败";
    } finally {
      if (!disposed) busy.value = false;
    }
  }
  async function apply() {
    if (props.disabled || busy.value || conflict.value) return;
    if (creation.creating.value && creation.name.value.trim()) {
      error.value = "请先保存或取消正在填写的单位。";
      return;
    }
    if ((reuse.value || props.reusableOnly) && !canUpdate.value) {
      error.value = "没有更新物品的权限；输入已保留。";
      return;
    }
    if (
      !canUpdate.value &&
      unit.value !== props.line.uom &&
      Number(factor.value) !== savedFactor.value &&
      !(
        unit.value === props.line.entryUom &&
        Number(factor.value) === props.line.conversionFactor
      )
    ) {
      error.value = "您只能使用此物品已有或本行已记录的计量单位与换算。";
      return;
    }
    error.value = props.reusableOnly
      ? conversionFactorError(
          unit.value,
          Number(factor.value),
          props.line.uom,
          reference.units,
        )
      : conversionError(
          Number(quantity.value),
          unit.value,
          Number(factor.value),
          props.line.uom,
          reference.units,
        );
    if (error.value) return;
    busy.value = true;
    try {
      if (
        (reuse.value || props.reusableOnly) &&
        unit.value !== props.line.uom
      ) {
        if (!version.value)
          throw new Error("物品版本尚未读取，请重新载入常用换算后核对");
        const values = conversions.value
          .filter((row) => row.uom !== unit.value)
          .map((row) => ({ uom: row.uom, conversion_factor: row.factor }));
        values.push({
          uom: unit.value,
          conversion_factor: Number(factor.value),
        });
        const result = await services.call<SavedItemConversions>(
          "conversions.save_item_conversions",
          {
            item_code: props.line.code,
            version: version.value,
            conversions: values,
          },
        );
        if (disposed) return;
        version.value = result.version;
        conversions.value = result.conversions.map((row) => ({
          uom: row.uom,
          factor: row.conversion_factor,
        }));
        itemUpdated(result);
      }
      if (disposed) return;
      if (!props.reusableOnly)
        applyLineConversion(
          props.line,
          unit.value,
          Number(factor.value),
          Number(quantity.value),
        );
      baseline.value = snapshot();
      dirtyChanged(false);
      applied();
    } catch (reason) {
      if (disposed) return;
      error.value =
        reason instanceof Error
          ? reason.message
          : "常用换算保存失败，输入已保留";
      conflict.value =
        String((reason as { kind?: string })?.kind) ===
        "TimestampMismatchError";
    } finally {
      if (!disposed) busy.value = false;
    }
  }
  useUpdateBlocker(() => dirty.value || busy.value);

  return {
    reference,
    unit,
    quantity,
    factor,
    canUpdate,
    reuse,
    busy,
    error,
    conflict,
    savedFactor,
    replacement,
    creation,
    apply,
    reload,
  };
}
