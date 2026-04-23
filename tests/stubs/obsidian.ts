// Minimal stub of the Obsidian runtime API used in tests.
// Tests that need richer behavior use vi.mock("obsidian") to override these.
export class Notice {
  constructor(_msg: string, _timeout?: number) {}
}
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}
export const requestUrl = async (_: unknown): Promise<unknown> => {
  throw new Error("requestUrl stub — tests must mock this.");
};
export class Plugin {}
export class PluginSettingTab {
  constructor(..._args: unknown[]) {}
}
export class Setting {
  constructor(..._args: unknown[]) {}
}
export class Modal {
  constructor(..._args: unknown[]) {}
}
export interface App {}
export interface Vault {}
export interface RequestUrlParam {}
export interface RequestUrlResponse {}
