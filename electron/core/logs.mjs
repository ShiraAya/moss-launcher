import { StringDecoder } from "node:string_decoder";

// Assemble UTF-8 and log records before redacting, so tokens split across chunks cannot leak.
export class GameLogDecoder {
  constructor(emit, token = "") {
    this.emit = emit;
    this.token = token === "0" ? "" : token;
    this.pending = "";
    this.decoder = new StringDecoder("utf8");
  }
  output(text) {
    if (this.token) text = text.split(this.token).join("[已隐藏令牌]");
    const trimmed = text.trim();
    if (trimmed) this.emit(trimmed.slice(0, 16000));
  }
  write(chunk) {
    this.pending += this.decoder.write(chunk);
    while (this.pending) {
      const start = this.pending.indexOf("<log4j:Event");
      if (start === 0) {
        const end = this.pending.indexOf("</log4j:Event>");
        if (end === -1) break;
        const xml = this.pending.slice(0, end + 14);
        const message = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] || xml;
        const level = xml.match(/level="([^"]+)"/)?.[1] || "INFO";
        const thread = xml.match(/thread="([^"]+)"/)?.[1] || "Game";
        this.output(`[${level}] [${thread}] ${message}`);
        this.pending = this.pending.slice(end + 14);
        continue;
      }
      const newline = this.pending.indexOf("\n");
      if (start > 0 && (newline === -1 || start < newline)) {
        this.output(this.pending.slice(0, start));
        this.pending = this.pending.slice(start);
        continue;
      }
      if (newline === -1) break;
      this.output(this.pending.slice(0, newline));
      this.pending = this.pending.slice(newline + 1);
    }
    // A malformed or very long line must not grow memory without bounds.
    if (this.pending.length > 1024 * 1024) {
      this.emit("[过长日志记录已省略]");
      this.pending = "";
    }
  }
  end() {
    this.pending += this.decoder.end();
    this.output(this.pending);
    this.pending = "";
  }
}
