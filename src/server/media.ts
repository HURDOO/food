// 올라온 사진에서 위치정보 같은 메타데이터를 지운다.
// 페이지를 올리는 스크립트가 Mac에서 한 번 지우고, 서버가 받을 때 한 번 더 지운다.

export class MediaError extends Error {}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
// APP1(EXIF·XMP), APP13(IPTC), COM(주석)은 버린다. APP0(JFIF), APP2(ICC 색공간), APP14(Adobe)는 남긴다.
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

export function stripJpegMetadata(input: Uint8Array): Buffer {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== SOI) throw new MediaError('not_jpeg');

  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  let sawScan = false;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) throw new MediaError('bad_marker');
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
    if (i + 4 > buf.length) throw new MediaError('truncated');
    const length = buf.readUInt16BE(i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > buf.length) throw new MediaError('truncated');
    if (!JPEG_DROP.has(marker)) parts.push(buf.subarray(i, end));
    i = end;
  }
  if (!sawScan) throw new MediaError('no_image_data');
  return Buffer.concat(parts);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// 글자·EXIF·시각 정보가 들어가는 청크는 버린다. 그림을 그리는 데 필요한 청크는 그대로 둔다.
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

export function stripPngMetadata(input: Uint8Array): Buffer {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new MediaError('not_png');
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i + 8 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + length;
    if (end > buf.length) throw new MediaError('truncated');
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new MediaError('truncated');
  return Buffer.concat(parts);
}

/** 확장자에 맞춰 메타데이터를 지운다. 사진이 아니면 그대로 돌려준다. */
export function cleanMedia(name: string, data: Uint8Array): Buffer {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return stripJpegMetadata(data);
  if (lower.endsWith('.png')) return stripPngMetadata(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}
