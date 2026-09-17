export function b64encodeForTest(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // Buffer exists in Node test environment; btoa does not.
  return Buffer.from(binary, 'binary').toString('base64');
}

export function b64decodeForTest(text: string): Uint8Array {
  const binary = Buffer.from(text, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
