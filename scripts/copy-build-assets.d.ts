export interface CopyBuildAssetsResult {
  readonly success: boolean;
  readonly nativeCopied: boolean;
  readonly resourcesCopied: boolean;
  readonly electron149Binary: string;
  readonly icoFile: string;
}

export interface CopyBuildAssetsOptions {
  readonly silent?: boolean;
}

export function copyBuildAssets(options?: CopyBuildAssetsOptions): CopyBuildAssetsResult;
