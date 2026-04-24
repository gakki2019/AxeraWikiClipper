import { describe, expect, it, vi, beforeEach } from "vitest";

const requestMock = vi.fn();
vi.mock("obsidian", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "../tests/stubs/obsidian"
  );
  return {
    ...actual,
    requestUrl: (params: unknown) => requestMock(params),
  };
});

import { ConfluenceClient } from "../src/confluence/client";
import { DEFAULT_SETTINGS } from "../src/settings";

function makeClient() {
  return new ConfluenceClient({
    ...DEFAULT_SETTINGS,
    baseUrl: "https://wiki.aixin-chip.com",
    authMode: "basic",
    username: "u",
    password: "p",
  });
}

describe("ConfluenceClient.downloadAttachment", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("retries without query string when the first request hits a redirect loop", async () => {
    const bodyBuf = new TextEncoder().encode("ok").buffer;
    requestMock
      .mockImplementationOnce(async () => {
        throw new Error("net::ERR_TOO_MANY_REDIRECTS");
      })
      .mockImplementationOnce(async () => ({
        status: 200,
        arrayBuffer: bodyBuf,
        headers: {},
        text: "",
        json: null,
      }));

    const client = makeClient();
    const buf = await client.downloadAttachment(
      "/download/attachments/242053973/image2026-4-22_20-21-0.png?version=1&modificationDate=1&api=v2"
    );
    expect(new TextDecoder().decode(buf)).toBe("ok");
    expect(requestMock).toHaveBeenCalledTimes(2);
    const secondUrl = (requestMock.mock.calls[1][0] as { url: string }).url;
    expect(secondUrl).toBe(
      "https://wiki.aixin-chip.com/download/attachments/242053973/image2026-4-22_20-21-0.png"
    );
  });

  it("does not retry on non-redirect failures", async () => {
    requestMock.mockImplementationOnce(async () => {
      throw new Error("dns resolution failed");
    });
    const client = makeClient();
    await expect(
      client.downloadAttachment(
        "/download/attachments/242053973/file.pdf?version=1"
      )
    ).rejects.toThrow(/Network error/);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the URL already has no query string", async () => {
    requestMock.mockImplementationOnce(async () => {
      throw new Error("ERR_TOO_MANY_REDIRECTS");
    });
    const client = makeClient();
    await expect(
      client.downloadAttachment("/download/attachments/242053973/file.pdf")
    ).rejects.toThrow(/ERR_TOO_MANY_REDIRECTS/);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

describe("ConfluenceClient.resolvePageIdByTitle", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("returns the first result's id on a hit", async () => {
    requestMock.mockImplementationOnce(async () => ({
      status: 200,
      headers: {},
      text: "",
      json: { results: [{ id: "242053973", title: "07. FAQ" }] },
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();
    const id = await client.resolvePageIdByTitle("SW", "07. FAQ");
    expect(id).toBe("242053973");
    const calledUrl = (requestMock.mock.calls[0][0] as { url: string }).url;
    expect(calledUrl).toContain("/rest/api/content?spaceKey=SW");
    expect(calledUrl).toContain("title=07.%20FAQ");
  });

  it("throws NotFoundError when results are empty", async () => {
    requestMock.mockImplementationOnce(async () => ({
      status: 200,
      headers: {},
      text: "",
      json: { results: [] },
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();
    await expect(client.resolvePageIdByTitle("SW", "Nope")).rejects.toThrow(
      /No page found/
    );
  });
});
