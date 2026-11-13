export interface ItemImageSource {
  code: string;
  image?: string | null;
}

export interface ItemGalleryImage {
  key: string;
  url: string;
  label: string;
  primary: boolean;
}

/** An attachment already normalized by its caller: stable key, display label, URL and mime type. */
export interface ItemImageFile {
  key: string;
  label: string;
  url: string;
  type: string;
}

export function imageVersion(url: string) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(url))
    hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export function originalUrl(code: string, url: string) {
  if (!url || url.startsWith("data:image/")) return url;
  return `/api/method/temple_inventory.item_images.original?item=${encodeURIComponent(code)}&v=${imageVersion(url)}`;
}

export function thumbnailUrl(
  code: string,
  url: string,
  cssSize: number,
  devicePixelRatio = typeof window === "undefined"
    ? 1
    : window.devicePixelRatio || 1,
) {
  if (!url || url.startsWith("data:image/")) return url;
  const size = cssSize * devicePixelRatio > 160 ? 640 : 160;
  return `/api/method/temple_inventory.item_images.thumbnail?item=${encodeURIComponent(code)}&size=${size}&v=${imageVersion(url)}`;
}

export function galleryImages(
  item: ItemImageSource,
  files: ItemImageFile[],
): ItemGalleryImage[] {
  const cover = item.image || "";
  const images: ItemGalleryImage[] = cover
    ? [{ key: "primary", url: cover, label: "主图", primary: true }]
    : [];
  const seen = new Set(cover ? [cover] : []);
  for (const file of files) {
    if (
      !file.url ||
      !file.type.toLowerCase().startsWith("image/") ||
      seen.has(file.url)
    )
      continue;
    seen.add(file.url);
    images.push({
      key: file.key,
      url: file.url,
      label: file.label,
      primary: false,
    });
  }
  return images;
}
