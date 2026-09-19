"""Representative clean-site transactions created through workspace services."""
import frappe
from frappe.utils import flt

SIGNATURE = "data:image/png;base64,AA=="

def _settings(): return frappe.get_single("Temple Inventory Settings")

def _confirm(kind, rows, **extra):
    from temple_inventory.workspace_api import confirm_workspace, create_workspace
    data={"items":rows,"no_independent_reviewer":1,"recorder_signature":SIGNATURE,"recorded_by":frappe.session.user,"posting_time_mode":"current",**extra}
    draft=create_workspace(f"sample-{kind.lower()}-{frappe.generate_hash(12)}", kind, data)
    return confirm_workspace(draft["name"], draft["revision"])

def _stock_item(warehouses):
    for item in frappe.get_all("Item", filters={"disabled":0,"is_stock_item":1,"has_batch_no":0}, fields=["name","stock_uom"], limit_page_length=0):
        bins=frappe.get_all("Bin", filters={"item_code":item.name,"warehouse":["in",warehouses]}, fields=["warehouse","actual_qty"], limit_page_length=0)
        usable=[row for row in bins if flt(row.actual_qty)>=12]
        if usable: return item, usable[0].warehouse, (usable[1].warehouse if len(usable)>1 else None)
    frappe.throw("样例数据没有找到足够库存的非批次 Item")

def install_representative_transactions(company):
    settings=_settings(); leaves=[row.warehouse for row in settings.get("allowed_warehouses",[]) if row.warehouse]
    if len(leaves)<2: frappe.throw("样例交易需要至少两个实体库位")
    item, source, destination=_stock_item(leaves); destination=destination or next(name for name in leaves if name!=source)
    base={"item_code":item.name,"uom":item.stock_uom,"qty":1}
    for qty in (2,3): _confirm("Receive",[{**base,"qty":qty,"warehouse":source}],source_text="样例入库")
    for _ in range(2): _confirm("Issue",[{**base,"warehouse":source}],purpose_text="样例出库")
    for _ in range(2): _confirm("Transfer",[{**base,"from_warehouse":source,"to_warehouse":destination}],purpose_text="样例转移")
    loans=[]
    for borrower in ("样例借用方一","样例借用方二","样例借用方三"):
        result=_confirm("Loan",[{**base,"qty":2,"from_warehouse":destination}],borrower=borrower,purpose_text="样例借出")
        loans.append(result)
    outstanding=frappe.get_attr("temple_inventory.inventory_api.outstanding_loan_items")()
    candidates=[row for row in outstanding if row["item_code"]==item.name]
    if len(candidates)<3: frappe.throw("样例借出明细不足")
    ret_rows=[{**base,"qty":1,"loan_item":candidates[0]["loan_item"],"outcome":"Returned","to_warehouse":source},{**base,"qty":1,"loan_item":candidates[1]["loan_item"],"outcome":"Damaged"},{**base,"qty":1,"loan_item":candidates[2]["loan_item"],"outcome":"Returned","to_warehouse":destination}]
    _confirm("Return",ret_rows,borrower="多借用方",purpose_text="样例归还")
    _confirm("Loss",[{**base,"qty":1,"original_loan_item":candidates[2]["loan_item"]}],borrower="样例借用方三",purpose_text="样例借出遗失")
    _confirm("Damage",[{**base,"qty":2,"warehouse":source}],purpose_text="样例普通损坏")
    _confirm("Loss",[{**base,"qty":1,"warehouse":destination}],purpose_text="样例普通遗失")
    _confirm("Repair",[{**base,"qty":1,"from_warehouse":settings.damaged_warehouse,"to_warehouse":source}],purpose_text="样例修复")
    _confirm("Disposal",[{**base,"qty":1,"from_warehouse":settings.damaged_warehouse}],purpose_text="样例报废")
    return {"item_code":item.name,"loans":len(loans),"transactions":14}
