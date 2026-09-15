import type { NoticeTable } from "../../../types/api";
import { layoutNoticeTable } from "../../utils/notice-table-layout";

Component({
  properties: {
    table: { type: Object, value: null as NoticeTable | null },
    theme: { type: String, value: "light" },
  },
  data: {
    layout: { width: 0, height: 1, cells: [] } as ReturnType<
      typeof layoutNoticeTable
    >,
  },
  observers: {
    table() {
      this.rebuild();
    },
  },
  lifetimes: {
    ready() {
      this.rebuild();
    },
  },
  pageLifetimes: {
    resize() {
      this.rebuild();
    },
  },
  methods: {
    rebuild() {
      const table = this.data.table as NoticeTable | null;
      if (!table) return;
      this.createSelectorQuery()
        .select(".table-viewport")
        .boundingClientRect((rect) => {
          if (!rect || Array.isArray(rect) || this.data.table !== table) return;
          this.setData({ layout: layoutNoticeTable(table, rect.width) }, () =>
            this.measure(),
          );
        })
        .exec();
    },
    measure() {
      const table = this.data.table as NoticeTable | null;
      if (!table) return;
      const query = this.createSelectorQuery();
      query.selectAll(".table-cell-content").boundingClientRect();
      query.exec((results) => {
        if (this.data.table !== table) return;
        const boxes =
          results[0] as WechatMiniprogram.BoundingClientRectCallbackResult[];
        if (!boxes || boxes.length !== table.cells.length) return;
        const layout = layoutNoticeTable(
          table,
          this.data.layout.width - 1,
          boxes.map((box) => box.height),
        );
        if (JSON.stringify(layout) === JSON.stringify(this.data.layout)) return;
        this.setData({ layout }, () => this.triggerEvent("resize"));
      });
    },
    previewImage(event: WechatMiniprogram.BaseEvent) {
      this.triggerEvent(
        "previewimage",
        { src: event.currentTarget.dataset.src },
        { bubbles: true, composed: true },
      );
    },
    openAttachment(event: WechatMiniprogram.BaseEvent) {
      this.triggerEvent(
        "openattachment",
        { url: event.currentTarget.dataset.url },
        { bubbles: true, composed: true },
      );
    },
  },
});
