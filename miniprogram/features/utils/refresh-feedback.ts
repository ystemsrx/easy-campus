interface RefreshConfirmationHost {
  selectComponent(selector: string): unknown;
}

interface RefreshConfirmationInstance {
  show?: (message?: string) => void;
}

export function showRefreshConfirmation(host: RefreshConfirmationHost): void {
  const component = host.selectComponent(
    "#refresh-confirmation",
  ) as RefreshConfirmationInstance | null;
  component?.show?.();
}

export function showRefreshFailure(host: RefreshConfirmationHost): void {
  const component = host.selectComponent(
    "#refresh-confirmation",
  ) as RefreshConfirmationInstance | null;
  component?.show?.("刷新失败，请稍后重试");
}
