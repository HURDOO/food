// 테스트용 가짜 JPEG. 디코딩은 하지 않으니 마커 구조만 맞으면 된다.
const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function fakeJpeg({ withExif = true } = {}): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(withExif ? segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('GPS 37.5894N 127.0323E')]) : []),
    ...segment(0xfe, ascii('comment')),
    ...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1]),
    ...segment(0xdb, [0, ...new Array(64).fill(1)]),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12, 0x34, 0x56, 0x78,
    0xff, 0xd9,
  ]);
}

export const includesAscii = (buf: Uint8Array, text: string) => Buffer.from(buf).includes(Buffer.from(text, 'latin1'));
