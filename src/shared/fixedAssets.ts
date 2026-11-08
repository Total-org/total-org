/**
 * The fixed-asset register (WP 3.6) was removed in the feature cleanup (audit A13b): its screens,
 * channels and input schemas are gone. Only the year-end status the close preview still returns
 * (services/fixedAssets.ts `yearStatus`) is shaped here. The statutory sources the register was
 * built on stay cited in migration 026 (src/main/db/migrations.ts) and ./fixedAssetSources.ts.
 */

export interface DepreciationYearStatus {
  fyStartYear: number
  /** Assets in service at some point in the FY. */
  assetsInService: number
  /** Last day of the FY covered by a live run (null = no run in the FY). */
  coveredThrough: string | null
  /** Depreciation for the FY has not been run up to 31 March. */
  missing: boolean
}
