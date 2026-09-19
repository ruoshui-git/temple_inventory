"""Generate and verify the tracked sample-image bundle."""
from __future__ import annotations
import argparse, csv, hashlib, json
from pathlib import Path
from PIL import Image, ImageOps
MAX_EDGE=1280
QUALITY=80
MAX_TOTAL_BYTES=25*1024*1024

def _sha256(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def _convert(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image=ImageOps.exif_transpose(image)
        image.thumbnail((MAX_EDGE,MAX_EDGE),Image.Resampling.LANCZOS)
        if image.mode not in ("RGB","RGBA"): image=image.convert("RGBA" if "A" in image.getbands() else "RGB")
        image.save(destination,"WEBP",quality=QUALITY,method=6,exif=b"")
    with Image.open(destination) as image: width,height=image.size
    return {"bytes":destination.stat().st_size,"sha256":_sha256(destination),"width":width,"height":height}

def _manifest_sources(root):
    result=[]
    general=json.loads((root/"sample_images"/"approved_images.json").read_text(encoding="utf-8"))["images"]
    for key,entry in general.items():
        if entry.get("status")=="approved": result.append(("general",key,root/"sample_images"/entry["file"],True))
    costume=root/"costumes-data"
    with (costume/"image_manifest.csv").open(encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle): result.append(("costumes",row["item_code"],costume/"images"/row["image_filename"],row["is_primary"]=="1"))
    return result

def build(root):
    root=Path(root); asset_root=root/"sample_assets"; rows=[]; seen=set()
    for dataset,key,source,primary in _manifest_sources(root):
        if not source.is_file(): raise FileNotFoundError(source)
        name=f"{key}.webp" if dataset=="general" else f"{key}-{source.stem}.webp"
        if name in seen: raise ValueError(f"duplicate output name: {name}")
        seen.add(name); output=asset_root/"images"/dataset/name; meta=_convert(source,output)
        rows.append({"dataset":dataset,"key":key,"source":str(source.relative_to(root)),"output":str(output.relative_to(asset_root)),"primary":primary,**meta})
    rows.sort(key=lambda row:(row["dataset"],row["key"],row["output"])); total=sum(row["bytes"] for row in rows)
    if len(rows)!=175 or total>MAX_TOTAL_BYTES: raise ValueError(f"invalid optimized bundle: count={len(rows)} bytes={total}")
    (asset_root/"manifest.json").write_text(json.dumps({"version":1,"max_edge":MAX_EDGE,"quality":QUALITY,"total_bytes":total,"images":rows},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return {"count":len(rows),"bytes":total,"manifest":str(asset_root/"manifest.json")}

def verify(root):
    root=Path(root); asset_root=root/"sample_assets"; payload=json.loads((asset_root/"manifest.json").read_text(encoding="utf-8")); total=0
    for row in payload["images"]:
        path=asset_root/row["output"]
        if not path.is_file() or path.stat().st_size!=row["bytes"] or _sha256(path)!=row["sha256"]: raise ValueError(f"asset verification failed: {path}")
        total+=path.stat().st_size
    if len(payload["images"])!=175 or total!=payload["total_bytes"] or total>MAX_TOTAL_BYTES: raise ValueError("asset manifest count/size verification failed")
    return {"count":len(payload["images"]),"bytes":total}

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("command",choices=("build","verify")); parser.add_argument("--root",default=str(Path(__file__).resolve().parent)); args=parser.parse_args(); print(json.dumps(build(args.root) if args.command=="build" else verify(args.root),ensure_ascii=False))
if __name__=="__main__": main()
