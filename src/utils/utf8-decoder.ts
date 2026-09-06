/**
 * UTF-8 Safe Streaming Decoder
 * Uses TextDecoder's stream option to handle incomplete sequences automatically
 */
export class SimpleUTF8Decoder {
  private decoder: TextDecoder;

  constructor() {
    this.decoder = new TextDecoder("utf-8", {
      fatal: false,
      ignoreBOM: true,
    });
  }

  decode(chunk: Uint8Array, isLastChunk: boolean = false): string {
    // TextDecoder with stream: true handles incomplete sequences automatically
    return this.decoder.decode(chunk, { stream: !isLastChunk });
  }
}
