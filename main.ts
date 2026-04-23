import { addIcon, Notice, Plugin } from "obsidian";
import {
  AxWikiClipperSettings,
  AxWikiClipperSettingTab,
  DEFAULT_SETTINGS,
} from "./src/settings";
import { Pipeline } from "./src/confluence/pipeline";
import { UrlModal } from "./src/ui/UrlModal";
import { logger } from "./src/utils/logger";

// Inline SVG for the ribbon icon. `fill="currentColor"` lets Obsidian
// recolor the icon for light/dark themes and hover/active/disabled states.
// Content is the original 0..1900 Axera "wiki" path, rescaled into the
// 100x100 viewBox that `addIcon` wraps around us (factor = 100/1900 = 0.05263).
const AXERA_WIKI_ICON_SVG =
  '<g transform="translate(0,100) scale(0.0526316,-0.0526316)" fill="currentColor" stroke="none">' +
  '<path d="M1398 1798 c-9 -7 -37 -47 -63 -88 -52 -83 -116 -154 -158 -176 -44 -23 -112 -32 -169 -22 -77 13 -169 50 -387 156 -257 123 -259 124 -282 112 -23 -13 -35 -36 -133 -258 -49 -110 -76 -183 -74 -200 3 -23 17 -34 108 -79 217 -108 419 -197 532 -234 217 -71 421 -73 589 -4 152 61 290 189 418 385 83 126 87 135 72 158 -12 19 -403 262 -422 262 -8 0 -22 -6 -31 -12z"/>' +
  '<path d="M660 921 c-203 -46 -372 -180 -525 -415 -72 -110 -79 -124 -76 -157 1 -9 86 -69 206 -143 162 -101 211 -127 230 -122 15 4 35 26 55 61 84 146 150 209 249 235 35 9 57 8 117 -5 93 -21 141 -40 399 -164 115 -56 222 -101 237 -101 18 0 33 8 43 23 35 54 186 413 183 437 -3 27 -43 50 -303 172 -391 183 -598 229 -815 179z"/>' +
  '</g>';

export default class AxWikiClipperPlugin extends Plugin {
  settings: AxWikiClipperSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    logger.info("onload");

    addIcon("axera-wiki", AXERA_WIKI_ICON_SVG);

    this.addRibbonIcon("axera-wiki", "AxeraWikiClipper: Download wiki page", () => {
      this.openDownloadModal();
    });

    this.addCommand({
      id: "download-wiki",
      name: "Download wiki page by URL",
      callback: () => this.openDownloadModal(),
    });

    this.addSettingTab(new AxWikiClipperSettingTab(this.app, this));
  }

  onunload(): void {
    logger.info("onunload");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private openDownloadModal(): void {
    if (!this.isAuthConfigured()) {
      new Notice("Please configure authentication in AxeraWikiClipper settings.");
      return;
    }
    new UrlModal(this.app, async (input) => {
      try {
        const pipeline = new Pipeline(this.app, this.settings);
        await pipeline.downloadByInput(input);
      } catch (e) {
        logger.error("Download failed", e);
        new Notice(`AxeraWikiClipper: ${(e as Error).message}`);
      }
    }).open();
  }

  private isAuthConfigured(): boolean {
    const s = this.settings;
    if (s.authMode === "basic") return !!s.username && !!s.password;
    return !!s.cookie;
  }
}
