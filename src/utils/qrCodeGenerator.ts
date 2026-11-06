/**
 * Pure TypeScript QR Code Generator (ISO/IEC 18004 compliant)
 * Generates a 2D boolean matrix for any text or URL without external dependencies.
 */

// QR Code Error Correction Levels
export const QR_ERROR_CORRECT_LEVEL = {
  L: 1, // ~7% error correction
  M: 0, // ~15% error correction
  Q: 3, // ~25% error correction
  H: 2, // ~30% error correction
} as const;

export type QRErrorCorrection = keyof typeof QR_ERROR_CORRECT_LEVEL;

// Galois Field (GF 256) Math
const QR_MATH = (() => {
  const EXP_TABLE = new Uint8Array(256);
  const LOG_TABLE = new Uint8Array(256);

  for (let i = 0; i < 8; i++) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i++) {
    EXP_TABLE[i] =
      EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i++) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }

  return {
    glog: (n: number) => {
      if (n < 1) throw new Error(`glog(${n})`);
      return LOG_TABLE[n];
    },
    gexp: (n: number) => {
      while (n < 0) n += 255;
      while (n >= 256) n -= 255;
      return EXP_TABLE[n];
    },
  };
})();

class QRPolynomial {
  num: number[];

  constructor(num: number[], shift = 0) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) {
      offset++;
    }
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) {
      this.num[i] = num[i + offset];
    }
    for (let i = num.length - offset; i < this.num.length; i++) {
      this.num[i] = 0;
    }
  }

  get(index: number) {
    return this.num[index];
  }

  getLength() {
    return this.num.length;
  }

  multiply(e: QRPolynomial): QRPolynomial {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= QR_MATH.gexp(
          QR_MATH.glog(this.get(i)) + QR_MATH.glog(e.get(j))
        );
      }
    }
    return new QRPolynomial(num);
  }

  mod(e: QRPolynomial): QRPolynomial {
    if (this.getLength() - e.getLength() < 0) {
      return this;
    }
    const ratio = QR_MATH.glog(this.get(0)) - QR_MATH.glog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) {
      num[i] = this.get(i);
    }
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= QR_MATH.gexp(QR_MATH.glog(e.get(i)) + ratio);
    }
    return new QRPolynomial(num).mod(e);
  }
}

// QR RS Block Table (Total Count, Data Count) per Error Correction Level for Versions 1-20
const RS_BLOCK_TABLE: number[][][] = [
  // L, M, Q, H
  // Version 1
  [[1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9]],
  // Version 2
  [[1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16]],
  // Version 3
  [[1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13]],
  // Version 4
  [[1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9]],
  // Version 5
  [[1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12]],
  // Version 6
  [[2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15]],
  // Version 7
  [[2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14]],
  // Version 8
  [[2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15]],
  // Version 9
  [[2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13]],
  // Version 10
  [[2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]],
  // Version 11
  [[4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13]],
  // Version 12
  [[2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15]],
  // Version 13
  [[4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12]],
  // Version 14
  [[3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13]],
  // Version 15
  [[5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13]],
  // Version 16
  [[5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16]],
  // Version 17
  [[1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15]],
  // Version 18
  [[5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15]],
  // Version 19
  [[3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14]],
  // Version 20
  [[3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16]],
];

class QRRSBlock {
  totalCount: number;
  dataCount: number;

  constructor(totalCount: number, dataCount: number) {
    this.totalCount = totalCount;
    this.dataCount = dataCount;
  }

  private static getEcTableIndex(errorCorrectLevel: number): number {
    switch (errorCorrectLevel) {
      case QR_ERROR_CORRECT_LEVEL.L:
        return 0;
      case QR_ERROR_CORRECT_LEVEL.M:
        return 1;
      case QR_ERROR_CORRECT_LEVEL.Q:
        return 2;
      case QR_ERROR_CORRECT_LEVEL.H:
        return 3;
      default:
        throw new Error(`Invalid QR errorCorrectLevel: ${errorCorrectLevel}`);
    }
  }

  static getRSBlocks(typeNumber: number, errorCorrectLevel: number): QRRSBlock[] {
    const ecIndex = QRRSBlock.getEcTableIndex(errorCorrectLevel);
    const rsBlock = RS_BLOCK_TABLE[typeNumber - 1]?.[ecIndex];
    if (!rsBlock) {
      throw new Error(`Unsupported QR version/EC level: ${typeNumber}/${errorCorrectLevel}`);
    }
    const length = rsBlock.length / 3;
    const list: QRRSBlock[] = [];
    for (let i = 0; i < length; i++) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j++) {
        list.push(new QRRSBlock(totalCount, dataCount));
      }
    }
    return list;
  }
}

class QRBitBuffer {
  buffer: number[] = [];
  length = 0;

  get(index: number) {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
  }

  put(num: number, length: number) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

function toUtf8ByteArray(str: string): number[] {
  const utf8Bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      utf8Bytes.push(c);
    } else if (c < 0x800) {
      utf8Bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      utf8Bytes.push(
        0xe0 | (c >> 12),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8Bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    }
  }
  return utf8Bytes;
}

// 8-bit Byte Data
class QR8BitByte {
  mode = 4; // MODE_8BIT_BYTE
  data: string;
  parsedData: number[];

  constructor(data: string) {
    this.data = data;
    this.parsedData = toUtf8ByteArray(data);
  }

  getLength() {
    return this.parsedData.length;
  }

  write(buffer: QRBitBuffer) {
    for (const b of this.parsedData) {
      buffer.put(b, 8);
    }
  }
}

// Main QR Model
export class QRCodeModel {
  typeNumber: number;
  errorCorrectLevel: number;
  modules: (boolean | null)[][] = [];
  moduleCount = 0;
  dataList: QR8BitByte[] = [];

  constructor(typeNumber: number, errorCorrectLevel: number) {
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
  }

  addData(data: string) {
    this.dataList.push(new QR8BitByte(data));
  }

  isDark(row: number, col: number) {
    if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
      throw new Error(`${row},${col}`);
    }
    return Boolean(this.modules[row][col]);
  }

  getModuleCount() {
    return this.moduleCount;
  }

  make() {
    this.makeImpl(false, this.getBestMaskPattern());
  }

  private makeImpl(test: boolean, maskPattern: number) {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array(this.moduleCount);
    for (let row = 0; row < this.moduleCount; row++) {
      this.modules[row] = new Array(this.moduleCount).fill(null);
    }

    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);

    if (this.typeNumber >= 7) {
      this.setupTypeNumber(test);
    }

    const data = this.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
    this.mapData(data, maskPattern);
  }

  private setupPositionProbePattern(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          this.modules[row + r][col + c] = true;
        } else {
          this.modules[row + r][col + c] = false;
        }
      }
    }
  }

  private getBestMaskPattern(): number {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i++) {
      this.makeImpl(true, i);
      const lostPoint = this.getLostPoint();
      if (i === 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  }

  private setupTimingPattern() {
    for (let r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] !== null) continue;
      this.modules[r][6] = r % 2 === 0;
    }
    for (let c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] !== null) continue;
      this.modules[6][c] = c % 2 === 0;
    }
  }

  private setupPositionAdjustPattern() {
    const pos = this.getPatternPosition(this.typeNumber);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const row = pos[i];
        const col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (
              Math.abs(r) === 2 ||
              Math.abs(c) === 2 ||
              (r === 0 && c === 0)
            ) {
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  }

  private getPatternPosition(typeNumber: number): number[] {
    const patternTable = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
    ];
    return patternTable[typeNumber - 1] || [];
  }

  private setupTypeNumber(test: boolean) {
    const bits = this.getBCHTypeNumber(this.typeNumber);
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      this.modules[Math.floor(i / 3)][(i % 3) + this.moduleCount - 8 - 3] = mod;
      this.modules[(i % 3) + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }

  private setupTypeInfo(test: boolean, maskPattern: number) {
    const data = (this.errorCorrectLevel << 3) | maskPattern;
    const bits = this.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }

      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }
    this.modules[this.moduleCount - 8][8] = !test;
  }

  private mapData(data: number[], maskPattern: number) {
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;

    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            }
            const mask = this.getMask(maskPattern, row, col - c);
            if (mask) {
              dark = !dark;
            }
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  private getMask(maskPattern: number, i: number, j: number): boolean {
    switch (maskPattern) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
      case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
      case 7: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
      default: throw new Error(`bad maskPattern: ${maskPattern}`);
    }
  }

  private getLostPoint(): number {
    const moduleCount = this.moduleCount;
    let lostPoint = 0;

    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        let sameCount = 0;
        const dark = this.modules[row][col];
        for (let r = -1; r <= 1; r++) {
          if (row + r < 0 || moduleCount <= row + r) continue;
          for (let c = -1; c <= 1; c++) {
            if (col + c < 0 || moduleCount <= col + c) continue;
            if (r === 0 && c === 0) continue;
            if (dark === this.modules[row + r][col + c]) {
              sameCount++;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }

    for (let row = 0; row < moduleCount - 1; row++) {
      for (let col = 0; col < moduleCount - 1; col++) {
        let count = 0;
        if (this.modules[row][col]) count++;
        if (this.modules[row + 1][col]) count++;
        if (this.modules[row][col + 1]) count++;
        if (this.modules[row + 1][col + 1]) count++;
        if (count === 0 || count === 4) {
          lostPoint += 3;
        }
      }
    }

    return lostPoint;
  }

  private getBCHTypeInfo(data: number) {
    let d = data << 10;
    while (this.getBCHDigit(d) - this.getBCHDigit(1335) >= 0) {
      d ^= 1335 << (this.getBCHDigit(d) - this.getBCHDigit(1335));
    }
    return ((data << 10) | d) ^ 21522;
  }

  private getBCHTypeNumber(data: number) {
    let d = data << 12;
    while (this.getBCHDigit(d) - this.getBCHDigit(7973) >= 0) {
      d ^= 7973 << (this.getBCHDigit(d) - this.getBCHDigit(7973));
    }
    return (data << 12) | d;
  }

  private getBCHDigit(data: number) {
    let digit = 0;
    while (data !== 0) {
      digit++;
      data >>>= 1;
    }
    return digit;
  }

  private createData(typeNumber: number, errorCorrectLevel: number, dataList: QR8BitByte[]): number[] {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    const buffer = new QRBitBuffer();

    for (const data of dataList) {
      buffer.put(data.mode, 4);
      buffer.put(data.getLength(), this.getLengthInBits(data.mode, typeNumber));
      data.write(buffer);
    }

    let totalDataCount = 0;
    for (const block of rsBlocks) {
      totalDataCount += block.dataCount;
    }

    if (buffer.length + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }

    while (buffer.length % 8 !== 0) {
      buffer.putBit(false);
    }

    while (true) {
      if (buffer.length >= totalDataCount * 8) {
        break;
      }
      buffer.put(0xec, 8);
      if (buffer.length >= totalDataCount * 8) {
        break;
      }
      buffer.put(0x11, 8);
    }

    return this.createBytes(buffer, rsBlocks);
  }

  private createBytes(buffer: QRBitBuffer, rsBlocks: QRRSBlock[]): number[] {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata: number[][] = new Array(rsBlocks.length);
    const ecdata: number[][] = new Array(rsBlocks.length);

    for (let r = 0; r < rsBlocks.length; r++) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);

      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i++) {
        dcdata[r][i] = 0xff & buffer.buffer[i + offset];
      }
      offset += dcCount;

      const rsPoly = this.getErrorCorrectPolynomial(ecCount);
      const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i++) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
      }
    }

    let totalCodeCount = 0;
    for (const block of rsBlocks) {
      totalCodeCount += block.totalCount;
    }

    const data = new Array(totalCodeCount);
    let index = 0;

    for (let i = 0; i < maxDcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < dcdata[r].length) {
          data[index++] = dcdata[r][i];
        }
      }
    }

    for (let i = 0; i < maxEcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < ecdata[r].length) {
          data[index++] = ecdata[r][i];
        }
      }
    }

    return data;
  }

  private getErrorCorrectPolynomial(errorCorrectLength: number): QRPolynomial {
    let a = new QRPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i++) {
      a = a.multiply(new QRPolynomial([1, QR_MATH.gexp(i)], 0));
    }
    return a;
  }

  private getLengthInBits(mode: number, type: number): number {
    if (1 <= type && type < 10) {
      switch (mode) {
        case 1: return 10;
        case 2: return 9;
        case 4: return 8;
        default: return 8;
      }
    }
    return 16;
  }
}

/**
 * Generate a QR matrix (2D boolean array) with auto-version calculation (versions 1-20)
 */
export function generateQrMatrix(
  text: string,
  ecLevel: QRErrorCorrection = 'M'
): boolean[][] {
  const ecCode = QR_ERROR_CORRECT_LEVEL[ecLevel];
  const byteLength = toUtf8ByteArray(text).length;

  // Find lowest version that fits byteLength
  let chosenVersion = 1;
  for (let v = 1; v <= 20; v++) {
    const blocks = QRRSBlock.getRSBlocks(v, ecCode);
    let capBytes = 0;
    for (const b of blocks) capBytes += b.dataCount;
    const lengthBits = v < 10 ? 8 : 16;
    const requiredBits = 4 + lengthBits + byteLength * 8;
    if (capBytes * 8 >= requiredBits) {
      chosenVersion = v;
      break;
    }
    chosenVersion = v;
  }

  const qr = new QRCodeModel(chosenVersion, ecCode);
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const matrix: boolean[][] = [];
  for (let r = 0; r < count; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < count; c++) {
      row.push(qr.isDark(r, c));
    }
    matrix.push(row);
  }
  return matrix;
}
