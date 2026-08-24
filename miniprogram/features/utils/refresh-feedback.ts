interface RefreshConfirmationHost {
  selectComponent(selector: string): unknown;
}

interface RefreshConfirmationInstance {
  show?: () => void;
}

export function showRefreshConfirmation(host: RefreshConfirmationHost): void {
  const component = host.selectComponent(
    "#refresh-confirmation",
  ) as RefreshConfirmationInstance | null;
  component?.show?.();
}
