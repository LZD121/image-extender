// app/lib/aspectRatio.ts
/**
 * The one home of the aspect-ratio table, and the "nearest supported ratio"
 * decision the generate route makes for every request.
 *
 * Why this lives outside `app/api/generate/route.ts`: Next generates a
 * route-module type that constrains the module's exports (`Diff<...>` against
 * an index signature), so a route file may only export handlers. The table and
 * its two functions must therefore live somewhere importable — measured on
 * this machine: adding `export` to the route file makes `tsc --noEmit` fail
 * with TS2344.
 *
 * The table is deliberately a closed list. `width`/`height` never leave this
 * machine: the only size signal that reaches a chat gateway is the ratio NAME
 * this function picks (`image_config.aspect_ratio`, injected at the route's
 * call site). That is why adding `4:1` / `8:1` below is a product change with a
 * measured blast radius, not a formatting tweak.
 */

export const SUPPORTED_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '4:1',
  '8:1',
] as const

export function aspectRatioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  return w / h
}

export function supportedAspectRatioForSize(width: number, height: number): string {
  const target = width / height
  return SUPPORTED_IMAGE_ASPECT_RATIOS
    .map((ratio) => ({
      ratio,
      // Compare in log space so 2:1 and 1:2 errors are symmetric.
      error: Math.abs(Math.log(aspectRatioValue(ratio) / target)),
    }))
    .sort((a, b) => a.error - b.error)[0].ratio
}
