// 올라온 사진이 JPEG인지 확인하고, 위치정보가 들어 있는 메타데이터를 지운다.
// 관리자 화면이 사진을 줄여서 JPEG로 보내지만, 원본이 그대로 와도 안전하게 처리한다.

export class JpegError extends Error {}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
// APP1(EXIF·XMP), APP13(IPTC), COM(주석)은 버린다. APP0(JFIF), APP2(ICC 색공간), APP14(Adobe)는 남긴다.
const DROP = new Set([0xe1, 0xed, 0xfe]);

export function stripJpegMetadata(input: Uint8Array): Buffer {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== SOI) throw new JpegError('not_jpeg');

  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  let sawScan = false;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) throw new JpegError('bad_marker');
    let marker = buf[i + 1] as number;
    while (marker === 0xff && i + 2 < buf.length) {
      i += 1;
      marker = buf[i + 1] as number;
    }
    if (marker === SOS) {
      parts.push(buf.subarray(i));
      sawScan = true;
      break;
    }
    if (marker === EOI) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) throw new JpegError('truncated');
    const length = buf.readUInt16BE(i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > buf.length) throw new JpegError('truncated');
    if (!DROP.has(marker)) parts.push(buf.subarray(i, end));
    i = end;
  }
  if (!sawScan) throw new JpegError('no_image_data');
  return Buffer.concat(parts);
}
