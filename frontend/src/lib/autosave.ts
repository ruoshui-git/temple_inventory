// One request at a time. Edits during an in-flight request remain queued.
export class SaveQueue {
  private timer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  private pending = false
  private disposed = false
  constructor(private save: () => Promise<void>, private onError: (e: any) => void, private paused = () => false) {}
  schedule(immediate = false) { if (this.disposed) return; this.pending = true; clearTimeout(this.timer); if (immediate) void this.flush(); else this.timer = setTimeout(()=>void this.flush(),3000) }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.running) { await this.running; if (this.pending && !this.paused()) return this.flush(); return }
    if (!this.pending || this.disposed || this.paused()) return
    this.running = (async()=>{ while (this.pending && !this.disposed && !this.paused()) { this.pending=false; try { await this.save() } catch(e) { this.onError(e); break } } })()
    try { await this.running } finally { this.running=undefined }
  }
  dispose() { this.disposed=true; clearTimeout(this.timer) }
}
