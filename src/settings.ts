import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type AxWikiClipperPlugin from "../main";
import { logger } from "./utils/logger";

export type AuthMode = "basic" | "cookie";
export type LinkStyle = "wikilink" | "markdown";

export interface AxWikiClipperSettings {
  // Connection
  baseUrl: string;
  authMode: AuthMode;
  username: string;
  password: string;
  cookie: string;
  // Storage
  inboxPath: string;
  downloadAllAttachments: boolean;
  // Markdown
  linkStyle: LinkStyle;
}

export const DEFAULT_SETTINGS: AxWikiClipperSettings = {
  baseUrl: "https://wiki.aixin-chip.com",
  authMode: "basic",
  username: "",
  password: "",
  cookie: "",
  inboxPath: "inbox",
  downloadAllAttachments: false,
  linkStyle: "wikilink",
};

/** Hardcoded constants that we deliberately do NOT expose in settings. */
export const HARDCODED = {
  concurrency: 8,
  timeoutMs: 30_000,
  attachmentPageSize: 200,
} as const;

export class AxWikiClipperSettingTab extends PluginSettingTab {
  private plugin: AxWikiClipperPlugin;

  constructor(app: App, plugin: AxWikiClipperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Connection ---
    containerEl.createEl("h2", { text: "Connection" });

    new Setting(containerEl)
      .setName("Wiki base URL")
      .setDesc("Root of the Confluence site. No trailing slash.")
      .addText((t) =>
        t
          .setPlaceholder("https://wiki.aixin-chip.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.baseUrl = v.trim().replace(/\/+$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Authentication mode")
      .setDesc("Basic Auth works on most sites. Use Cookie if your site enforces SSO.")
      .addDropdown((d) =>
        d
          .addOption("basic", "Basic Auth (username + password)")
          .addOption("cookie", "Cookie (paste from browser)")
          .setValue(this.plugin.settings.authMode)
          .onChange(async (v) => {
            this.plugin.settings.authMode = v as AuthMode;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.authMode === "basic") {
      new Setting(containerEl).setName("Username").addText((t) =>
        t.setValue(this.plugin.settings.username).onChange(async (v) => {
          this.plugin.settings.username = v;
          await this.plugin.saveSettings();
        })
      );

      new Setting(containerEl)
        .setName("Password")
        .setDesc("⚠ Stored as plain text in the vault's .obsidian/plugins/ax-wiki-clipper/data.json")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(this.plugin.settings.password).onChange(async (v) => {
            this.plugin.settings.password = v;
            await this.plugin.saveSettings();
          });
        });
    } else {
      new Setting(containerEl)
        .setName("Cookie")
        .setDesc("Paste the full Cookie header value. Get it from Chrome DevTools → Application → Cookies.")
        .addTextArea((t) => {
          t.inputEl.rows = 3;
          t.setPlaceholder("JSESSIONID=...; seraph.confluence=...")
            .setValue(this.plugin.settings.cookie)
            .onChange(async (v) => {
              this.plugin.settings.cookie = v.trim();
              await this.plugin.saveSettings();
            });
        });
    }

    // --- Storage ---
    containerEl.createEl("h2", { text: "Storage" });

    new Setting(containerEl)
      .setName("Inbox folder")
      .setDesc("Vault-relative folder where downloads are placed.")
      .addText((t) =>
        t.setValue(this.plugin.settings.inboxPath).onChange(async (v) => {
          this.plugin.settings.inboxPath = v.trim().replace(/^\/+|\/+$/g, "") || "inbox";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Download all attachments")
      .setDesc("If off, only attachments referenced in the page body are downloaded.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.downloadAllAttachments).onChange(async (v) => {
          this.plugin.settings.downloadAllAttachments = v;
          await this.plugin.saveSettings();
        })
      );

    // --- Markdown ---
    containerEl.createEl("h2", { text: "Markdown" });

    new Setting(containerEl)
      .setName("Attachment link style")
      .setDesc(
        "How to reference downloaded attachments in the note body. Wikilink works only inside Obsidian; standard Markdown is portable."
      )
      .addDropdown((d) =>
        d
          .addOption("wikilink", "Obsidian wikilink  ![[path]]")
          .addOption("markdown", "Standard Markdown  ![](path)")
          .setValue(this.plugin.settings.linkStyle)
          .onChange(async (v) => {
            this.plugin.settings.linkStyle = v as LinkStyle;
            await this.plugin.saveSettings();
          })
      );

    // --- Troubleshooting (not a setting) ---
    containerEl.createEl("h2", { text: "Troubleshooting" });
    new Setting(containerEl)
      .setName("Enable debug logs")
      .setDesc(
        "Turns on verbose console logging for this session. Open DevTools with Ctrl+Shift+I to view."
      )
      .addToggle((t) =>
        t.setValue(logger.isDebugEnabled()).onChange((v) => {
          if (v) {
            logger.enableDebug();
            new Notice("Debug logs enabled. Open DevTools (Ctrl+Shift+I) to view.");
          } else {
            logger.disableDebug();
            new Notice("Debug logs disabled.");
          }
        })
      );
  }
}
