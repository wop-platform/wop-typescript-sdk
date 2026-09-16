import { WopError } from '../error';
import {
  DEFAULT_EXPIRED_SECONDS,
  defaultHttpClientSettings,
  type HttpClientSettings,
  type WopSdkConfig,
} from './types';
import { validateAndNormalize } from './configValidator';

/** 配置专用极简 JSON 解析器（K8/K21）：忽略未知顶层字段；检测重复键；支持一层嵌套 httpClient */
export function parseConfigJson(json: string | null | undefined): WopSdkConfig {
  if (json == null) {
    throw new WopError('配置文件 JSON 解析失败: 空内容', 'configuration');
  }
  const trimmed = stripBom(json.trim());
  if (trimmed === '') {
    throw new WopError('配置文件 JSON 解析失败: 空文件', 'configuration');
  }
  return new ConfigJsonParser(trimmed).parseRoot();
}

function stripBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

class ConfigJsonParser {
  private pos = 0;

  constructor(private readonly json: string) {}

  parseRoot(): WopSdkConfig {
    this.expect('{');
    let appKey: string | null = null;
    let suite: string | null = null;
    let merchantPrivateKey: string | null = null;
    let platformPublicKey: string | null = null;
    let serverRoot: string | null = null;
    let backupServerRoots: string[] = [];
    let expiredSeconds: number | null = null;
    let httpClient: HttpClientSettings | null = null;
    const seen = new Set<string>();
    while (!this.tryConsume('}')) {
      const key = this.readString();
      this.requireDuplicateFree(seen, key);
      this.expect(':');
      switch (key) {
        case 'appKey':
          appKey = this.readString();
          break;
        case 'suite':
          suite = this.readString();
          break;
        case 'merchantPrivateKey':
          merchantPrivateKey = this.readString();
          break;
        case 'platformPublicKey':
          platformPublicKey = this.readString();
          break;
        case 'serverRoot':
          serverRoot = this.readString();
          break;
        case 'backupServerRoots':
          backupServerRoots = this.readStringArray();
          break;
        case 'expiredSeconds':
          expiredSeconds = this.readLong('expiredSeconds');
          break;
        case 'httpClient':
          httpClient = this.readHttpClient();
          break;
        default:
          this.skipValue();
      }
      this.optionalComma();
    }
    const raw: WopSdkConfig = {
      appKey: appKey ?? '',
      suite: suite ?? '',
      merchantPrivateKey: merchantPrivateKey ?? '',
      platformPublicKey: platformPublicKey ?? '',
      serverRoot: serverRoot ?? '',
      backupServerRoots,
      expiredSeconds: expiredSeconds ?? DEFAULT_EXPIRED_SECONDS,
      httpClient: httpClient ?? defaultHttpClientSettings(),
    };
    return validateAndNormalize(raw);
  }

  private readHttpClient(): HttpClientSettings {
    this.expect('{');
    let connect: number | null = null;
    let read: number | null = null;
    let maxRetry: number | null = null;
    const seen = new Set<string>();
    while (!this.tryConsume('}')) {
      const key = this.readString();
      this.requireDuplicateFree(seen, key);
      this.expect(':');
      switch (key) {
        case 'connectTimeout':
          connect = this.readInt('connectTimeout');
          break;
        case 'readTimeout':
          read = this.readInt('readTimeout');
          break;
        case 'maxRetryCount':
          maxRetry = this.readInt('maxRetryCount');
          break;
        default:
          this.skipValue();
      }
      this.optionalComma();
    }
    const defaults = defaultHttpClientSettings();
    return {
      connectTimeout: connect ?? defaults.connectTimeout,
      readTimeout: read ?? defaults.readTimeout,
      maxRetryCount: maxRetry ?? defaults.maxRetryCount,
    };
  }

  private readStringArray(): string[] {
    this.expect('[');
    const values: string[] = [];
    while (!this.tryConsume(']')) {
      values.push(this.readString());
      this.optionalComma();
    }
    return values;
  }

  private requireDuplicateFree(seen: Set<string>, key: string): void {
    if (seen.has(key)) {
      throw new WopError(`配置字段 ${key} 重复: ${key}`, 'configuration');
    }
    seen.add(key);
  }

  private readString(): string {
    this.skipWhitespace();
    if (this.pos >= this.json.length || this.json[this.pos] !== '"') {
      throw this.syntax('期望字符串');
    }
    this.pos++;
    let out = '';
    while (this.pos < this.json.length) {
      const c = this.json[this.pos++]!;
      if (c === '"') {
        return out;
      }
      if (c === '\\') {
        if (this.pos >= this.json.length) {
          throw this.syntax('字符串转义不完整');
        }
        const esc = this.json[this.pos++]!;
        switch (esc) {
          case '"':
          case '\\':
          case '/':
            out += esc;
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u':
            out += this.readUnicode();
            break;
          default:
            throw this.syntax(`非法转义 \\${esc}`);
        }
      } else {
        out += c;
      }
    }
    throw this.syntax('字符串未闭合');
  }

  private readUnicode(): string {
    if (this.pos + 4 > this.json.length) {
      throw this.syntax('\\u 转义不完整');
    }
    let code = 0;
    for (let i = 0; i < 4; i++) {
      const h = this.json[this.pos++]!;
      code <<= 4;
      if (h >= '0' && h <= '9') {
        code += h.charCodeAt(0) - 48;
      } else if (h >= 'a' && h <= 'f') {
        code += h.charCodeAt(0) - 97 + 10;
      } else if (h >= 'A' && h <= 'F') {
        code += h.charCodeAt(0) - 65 + 10;
      } else {
        throw this.syntax('\\u 转义非法');
      }
    }
    return String.fromCharCode(code);
  }

  private readLong(fieldName: string): number {
    this.skipWhitespace();
    const start = this.pos;
    if (this.pos < this.json.length && this.json[this.pos] === '-') {
      this.pos++;
    }
    while (this.pos < this.json.length && /\d/.test(this.json[this.pos]!)) {
      this.pos++;
    }
    if (start === this.pos) {
      throw this.syntax('期望数字');
    }
    const num = this.json.slice(start, this.pos);
    if (/[eE.]/.test(num)) {
      throw new WopError(`配置字段 ${fieldName} 类型非法: ${num}`, 'configuration');
    }
    const value = Number(num);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new WopError(`配置字段 ${fieldName} 类型非法: ${num}`, 'configuration');
    }
    return value;
  }

  private readInt(fieldName: string): number {
    const value = this.readLong(fieldName);
    if (value > 0x7fff_ffff) {
      throw new WopError(`配置字段 httpClient 类型非法: 数值越界`, 'configuration');
    }
    return value;
  }

  private skipValue(): void {
    this.skipWhitespace();
    if (this.pos >= this.json.length) {
      throw this.syntax('意外结束');
    }
    const c = this.json[this.pos]!;
    if (c === '"') {
      this.readString();
    } else if (c === '{') {
      this.skipObject();
    } else if (c === '[') {
      this.skipArray();
    } else if (c === 't' || c === 'f' || c === 'n') {
      this.skipLiteral();
    } else {
      while (this.pos < this.json.length && !',]}'.includes(this.json[this.pos]!)) {
        this.pos++;
      }
    }
  }

  private skipObject(): void {
    this.expect('{');
    while (!this.tryConsume('}')) {
      this.readString();
      this.expect(':');
      this.skipValue();
      this.optionalComma();
    }
  }

  private skipArray(): void {
    this.expect('[');
    while (!this.tryConsume(']')) {
      this.skipValue();
      this.optionalComma();
    }
  }

  private skipLiteral(): void {
    while (this.pos < this.json.length && /[a-zA-Z]/.test(this.json[this.pos]!)) {
      this.pos++;
    }
    const literal = this.json.slice(this.pos - 4, this.pos);
    if (literal === 'NaN' || literal.endsWith('NaN') || literal.includes('Infinity')) {
      throw new WopError('配置字段 类型非法: NaN/Infinity', 'configuration');
    }
  }

  private expect(ch: string): void {
    this.skipWhitespace();
    if (this.pos >= this.json.length || this.json[this.pos] !== ch) {
      throw this.syntax(`期望 '${ch}'`);
    }
    this.pos++;
  }

  private tryConsume(ch: string): boolean {
    this.skipWhitespace();
    if (this.pos < this.json.length && this.json[this.pos] === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  private optionalComma(): void {
    this.skipWhitespace();
    if (this.pos < this.json.length && this.json[this.pos] === ',') {
      this.pos++;
    }
  }

  private skipWhitespace(): void {
    while (this.pos < this.json.length && /\s/.test(this.json[this.pos]!)) {
      this.pos++;
    }
  }

  private syntax(detail: string): WopError {
    return new WopError(`配置文件 JSON 解析失败: ${detail}`, 'configuration');
  }
}
