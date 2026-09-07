function isCancelled(error: unknown): boolean {
  return /cancel/i.test(String((error as { errMsg?: string })?.errMsg || ""));
}

export async function shareGeneratedImage(path: string): Promise<void> {
  // Native UI keeps the final destination and send/save action in the user's hands.
  if (
    typeof wx.showShareImageMenu === "function" &&
    wx.canIUse("showShareImageMenu")
  ) {
    try {
      await new Promise<void>((resolve, reject) =>
        wx.showShareImageMenu({
          path,
          needShowEntrance: true,
          entrancePath: "pages/home/index",
          success: () => resolve(),
          fail: reject,
        }),
      );
      return;
    } catch (error) {
      if (isCancelled(error)) return;
      if (
        !/not support|not supported|unavailable|暂不支持|不支持/i.test(
          String((error as { errMsg?: string })?.errMsg || ""),
        )
      )
        throw error;
    }
  }
  await new Promise<void>((resolve, reject) =>
    wx.previewImage({
      current: path,
      urls: [path],
      showmenu: true,
      success: () => resolve(),
      fail: (error) => (isCancelled(error) ? resolve() : reject(error)),
    }),
  );
}
