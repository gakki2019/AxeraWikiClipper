import { App, Modal, Setting } from "obsidian";

export class UrlModal extends Modal {
  private value = "";

  constructor(app: App, private onSubmit: (input: string) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Download Axera wiki page" });

    // Stacked layout: label + single-line description, then a full-width input.
    const field = contentEl.createDiv({ cls: "axwc-field" });
    field.createEl("div", { text: "Wiki page URL", cls: "setting-item-name" });
    const desc = field.createEl("div", {
      text: "Paste the full page URL, e.g: https://wiki.aixin-chip.com/pages/viewpage.action?pageId=242053973",
      cls: "setting-item-description",
    });
    desc.style.whiteSpace = "nowrap";
    desc.style.overflow = "hidden";
    desc.style.textOverflow = "ellipsis";

    const input = field.createEl("input", { type: "text", cls: "axwc-url-input" });
    input.placeholder = "https://wiki.aixin-chip.com/display/SW/07.+FAQ";
    input.style.width = "100%";
    input.style.marginTop = "8px";
    input.addEventListener("input", () => (this.value = input.value));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.submit();
      }
    });
    setTimeout(() => input.focus(), 0);

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => this.close())
      )
      .addButton((b) =>
        b
          .setButtonText("Download")
          .setCta()
          .onClick(() => this.submit())
      );
  }

  private submit(): void {
    const v = this.value.trim();
    if (!v) return;
    this.close();
    this.onSubmit(v);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
