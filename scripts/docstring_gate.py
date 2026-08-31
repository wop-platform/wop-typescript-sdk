#!/usr/bin/env python3
"""docstring 门检查器(wop-typescript-sdk)。

统一契约:docstring-gate-contract.md(2026-08-31)——CLI/度量口径/反作弊一致:

- 对外 API(100%):顶层 ``export`` 声明(函数/类/interface/type/enum/const)
  + export 类的非私有方法(含 get/set 存取器;构造函数非方法,不计)。
- 内部 API(≥80%,空集=达标):非 export 顶层声明(函数/类/interface/type/enum/const)。
- docstring 判定:紧邻声明上方、与声明间无空行的连续注释块,块首行以
  ``/**`` 或 ``//`` 开头(多行块末行为 ``*/``/``*``,故按块首判,与契约
  Go 行"连续注释块"同解)。
- 扫描面:``git ls-files`` 枚举 src/**/*.ts(反作弊:不 glob 全扫;tests/
  生成物不在 src 下,天然排除)。
- 实现方式:契约许可"无第三方依赖时用正则"——本仓 Python 环境无 TS
  compiler API 绑定,采用 词法剥离(字符串/模板/注释/正则字面量)+
  括号深度 + 声明正则,零第三方依赖。

CLI:无参 = 全量检查(exit 0 达标 / 1 未达标,stdout 逐符号缺失清单 +
统计);``--self-test`` = 负控制(内嵌已知坏输入断言非零);``--json`` =
JSON 统计输出。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

EXTERNAL_MIN = 1.0  # 对外 100%
INTERNAL_MIN_NUM, INTERNAL_MIN_DEN = 80, 100  # 内部 ≥80%(整数比较,避浮点误差)

# ── 词法剥离:字符串/模板/注释/正则字面量 → 空格(保留换行与代码) ──────────

_REGEX_PRECEDERS = {
    '(', '[', '{', ',', ';', ':', '=', '!', '?', '&', '|', '+', '-', '*',
    '%', '~', '^', '<', '>',
}
_REGEX_KEYWORDS = {
    'return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else',
    'new', 'delete', 'void', 'throw', 'yield', 'await',
}


def strip_noncode(src: str) -> str:
    """返回与 src 等长的"纯代码"文本:注释/字符串/模板/正则内容替换为空格。

    供括号深度统计与声明正则使用;换行保留(行号对齐)。
    模板插值 ``${...}`` 内部按代码处理(嵌套模板正确);
    正则字面量按前驱字符判别(除号 vs 正则),``[...]`` 字符类内 ``/`` 不闭合。
    """
    out = list(src)
    n = len(src)
    i = 0
    depth = 0                    # 代码层花括号深度
    tmpl_stack: list = []        # 各层 ${ 进入时的代码深度
    mode = 'code'
    quote = ''
    last_code = ''               # 最近一个保留的代码字符(正则判别用)
    last_word = ''               # 最近一个标识符词(关键字判别用)

    def blank(k: int) -> None:
        if out[k] != '\n':
            out[k] = ' '

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if mode == 'code':
            if c == '/' and nxt == '/':
                blank(i); blank(i + 1); i += 2; mode = 'line_comment'
                continue
            if c == '/' and nxt == '*':
                blank(i); blank(i + 1); i += 2; mode = 'block_comment'
                continue
            if c in ('"', "'"):
                blank(i); quote = c; mode = 'quote'; i += 1
                continue
            if c == '`':
                blank(i); mode = 'template'; i += 1
                continue
            if c == '/' and _is_regex_start(last_code, last_word):
                j = _skip_regex(src, i)
                for k in range(i, j):
                    blank(k)
                i = j
                continue
            if c == '{':
                depth += 1
            elif c == '}':
                if tmpl_stack and tmpl_stack[-1] == depth:
                    tmpl_stack.pop(); blank(i); mode = 'template'; i += 1
                    continue
                depth -= 1
            if not c.isspace():
                if c.isalnum() or c in '_$':
                    last_word = (last_word + c) if (
                        last_code.isalnum() or last_code in '_$') else c
                else:
                    last_word = ''
                last_code = c
            i += 1
        elif mode == 'line_comment':
            if c == '\n':
                mode = 'code'
            else:
                blank(i)
            i += 1
        elif mode == 'block_comment':
            if c == '*' and nxt == '/':
                blank(i); blank(i + 1); i += 2; mode = 'code'
                continue
            blank(i)
            i += 1
        elif mode == 'quote':
            if c == '\\':
                blank(i)
                if i + 1 < n:
                    blank(i + 1)
                i += 2
                continue
            if c in [quote, '\n']:  # 未闭合字符串按行终止(容错)
                blank(i); mode = 'code'
            else:
                blank(i)
            i += 1
        elif mode == 'template':
            if c == '\\':
                blank(i)
                if i + 1 < n:
                    blank(i + 1)
                i += 2
                continue
            if c == '`':
                blank(i); mode = 'code'
            elif c == '$' and nxt == '{':
                blank(i); blank(i + 1)
                tmpl_stack.append(depth)
                mode = 'code'
                i += 2
                continue
            else:
                blank(i)
            i += 1
    # quote/template 未闭合:容错,剩余已按内容空格化
    return ''.join(out)


def _is_regex_start(last_code: str, last_word: str) -> bool:
    """斜杠前驱判别:运算位 → 正则字面量;操作数位 → 除号。"""
    if not last_code:
        return True
    if last_code in _REGEX_PRECEDERS:
        return True
    return (
        last_code.isalnum() or last_code in '_$'
    ) and last_word in _REGEX_KEYWORDS


def _skip_regex(src: str, start: int) -> int:
    """跳过正则字面量,返回其结束后下标。处理转义与 [...] 字符类。"""
    i = start + 1
    in_class = False
    n = len(src)
    while i < n:
        c = src[i]
        if c == '\\':
            i += 2
            continue
        if in_class:
            if c == ']':
                in_class = False
        elif c == '[':
            in_class = True
        elif c == '/':
            i += 1
            break
        elif c == '\n':  # 跨行必非正则(容错:按单斜杠处理)
            break
        i += 1
    while i < n and src[i].isalpha():  # flags
        i += 1
    return i


# ── 符号枚举 ────────────────────────────────────────────────────────────────

EXPORT_DECL_RE = re.compile(
    r'^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?'
    r'(?:(?:async\s+)?function\s*\*?\s*|class\s+|interface\s+|type\s+'
    r'|const\s+(?!enum\b)|enum\s+)'
    r'([A-Za-z_$][\w$]*)'
)
PLAIN_DECL_RE = re.compile(
    r'^(?:(?:async\s+)?function\s*\*?\s*|class\s+|interface\s+|type\s+'
    r'|const\s+(?!enum\b)|enum\s+)'
    r'([A-Za-z_$][\w$]*)'
)
COMMENT_LINE_RE = re.compile(r'^\s*(?://|/\*+|\*)')

METHOD_MODIFIERS = {
    'public', 'protected', 'private', 'static', 'override', 'abstract',
    'readonly', 'async',
}
METHOD_RESERVED = {
    'constructor',  # 构造函数非方法(度量口径拍板:不计数)
    'if', 'for', 'while', 'switch', 'catch', 'return', 'do', 'else',
    'new', 'function', 'throw', 'await', 'yield',
}


@dataclass
class Symbol:
    path: str
    line: int          # 1-based
    name: str
    kind: str          # 'external' | 'internal'
    decl: str          # 声明种类(function/class/interface/type/enum/const/method)


@dataclass
class Report:
    external_total: int = 0
    external_documented: int = 0
    internal_total: int = 0
    internal_documented: int = 0
    missing: list = field(default_factory=list)   # "path:line name"

    @property
    def ok(self) -> bool:
        ext_ok = self.external_documented >= self.external_total * EXTERNAL_MIN
        int_ok = (self.internal_total == 0) or (
            self.internal_documented * INTERNAL_MIN_DEN
            >= INTERNAL_MIN_NUM * self.internal_total)
        return ext_ok and int_ok


def parse_method(line: str):
    """类体内方法行解析:返回 (名称, 种类) 或 None。

    私有(private)方法与构造函数不计入度量;get/set 存取器计入
    (契约:getter/setter 不豁免)。
    """
    s = line.strip()
    private = False
    while True:
        m = re.match(r'([A-Za-z_$][\w$]*)\s*', s)
        if not m:
            return None
        word = m[1]
        if word in METHOD_MODIFIERS:
            if word == 'private':
                private = True
            s = s[m.end():]
            continue
        break
    if private:
        return None
    if word in ('get', 'set'):  # 存取器:get name(...) → name
        m2 = re.match(r'([A-Za-z_$][\w$]*)\s*\(', s)
        return (m2[1], 'accessor') if m2 else None
    if word in METHOD_RESERVED:
        return None
    if re.match(r'[A-Za-z_$][\w$]*\s*(?:<[^>(]*/?>)?\s*\(', s):
        return word, 'method'
    return None


def has_docstring(orig_lines: list, decl_idx: int) -> bool:
    """声明上一行起:非空、是注释行、向上追溯连续注释块,块首 /** 或 //。"""
    i = decl_idx - 1
    if i < 0:
        return False
    if not orig_lines[i].strip():          # 与声明之间有空行 → 不算
        return False
    if not COMMENT_LINE_RE.match(orig_lines[i]):
        return False
    while (
        i >= 1
        and orig_lines[i - 1].strip()
        and COMMENT_LINE_RE.match(orig_lines[i - 1])
    ):
        i -= 1
    first = orig_lines[i].strip()
    return first.startswith('/**') or first.startswith('//')


def _decl_kind(cline: str) -> str:
    return next(
        (
            kw
            for kw in (
                'function',
                'class',
                'interface',
                'type',
                'enum',
                'const',
            )
            if re.search(r'\b' + kw + r'\b', cline)
        ),
        'decl',
    )


def analyze(path: str, src: str) -> list:
    """单文件符号枚举。"""
    code = strip_noncode(src)
    code_lines = code.split('\n')
    # 行首括号深度(该行首个字符之前的深度)
    depths = []
    d = 0
    for line in code_lines:
        depths.append(d)
        for ch in line:
            if ch == '{':
                d += 1
            elif ch == '}':
                d -= 1

    symbols = []
    in_exported_class = False
    class_name = ''
    for idx, cline in enumerate(code_lines):
        if depths[idx] == 0:
            in_exported_class = False
            if m := EXPORT_DECL_RE.match(cline):
                name = m.group(1)
                kind = _decl_kind(cline)
                symbols.append(Symbol(path, idx + 1, name, 'external', kind))
                if kind == 'class':
                    in_exported_class = True
                    class_name = name
                continue
            if m := PLAIN_DECL_RE.match(cline):
                symbols.append(Symbol(path, idx + 1, m.group(1), 'internal',
                                      _decl_kind(cline)))
        elif depths[idx] == 1 and in_exported_class:
            if parsed := parse_method(cline):
                name, kind = parsed
                symbols.append(Symbol(path, idx + 1, f'{class_name}.{name}',
                                      'external', kind))
    return symbols


def scan_files(files: list) -> Report:
    """(path, src) 列表 → 度量报告。"""
    rep = Report()
    for path, src in files:
        orig_lines = src.split('\n')
        for sym in analyze(path, src):
            documented = has_docstring(orig_lines, sym.line - 1)
            if sym.kind == 'external':
                rep.external_total += 1
                rep.external_documented += int(documented)
            else:
                rep.internal_total += 1
                rep.internal_documented += int(documented)
            if not documented:
                rep.missing.append(f'{sym.path}:{sym.line} {sym.name}')
    return rep


def scan_repo() -> Report:
    """扫描面:git ls-files 枚举(反作弊)src/**/*.ts。"""
    try:
        out = subprocess.run(
            ['git', 'ls-files', '--', 'src/*.ts', 'src/**/*.ts'],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout
    except subprocess.CalledProcessError as exc:
        print(f'git ls-files 失败: {exc}', file=sys.stderr)
        raise SystemExit(2) from exc
    files = [
        (rel, (REPO_ROOT / rel).read_text(encoding='utf-8'))
        for rel in sorted(l.strip() for l in out.splitlines() if l.strip())
        if not rel.endswith('.d.ts')
    ]
    return scan_files(files)


def format_report(rep: Report) -> str:
    lines = list(rep.missing)
    lines.extend(
        (
            f'对外 {rep.external_documented}/{rep.external_total}、内部 {rep.internal_documented}/{rep.internal_total}',
            f'docstring gate: {"PASS" if rep.ok else "FAIL"}',
        )
    )
    return '\n'.join(lines)


# ── 负控制自测(--self-test)────────────────────────────────────────────────

SELF_TEST_CASES = [
    # (名称, 源码, 期望判定)
    ('bad-export-missing', 'export function noDoc() { return 1; }\n',
     'external_missing'),
    ('good-export-singleline',
     '/** doc */\nexport function ok() { return 1; }\n', 'ok'),
    ('good-export-line-comment', '// doc\nexport const K = 1;\n', 'ok'),
    ('good-multiline-block',
     '/**\n * doc\n */\nexport interface I { a: string }\n', 'ok'),
    ('bad-blank-line-between',
     '/** doc */\n\nexport function gap() { return 1; }\n',
     'external_missing'),
    ('bad-plain-block-comment',
     '/* not jsdoc */\nexport function f() { return 1; }\n',
     'external_missing'),
    ('bad-public-method-missing',
     'export class C {\n  send(x: string): string { return x; }\n}\n',
     'external_missing'),
    ('good-private-method-exempt',
     '/** doc */\nexport class C {\n  private hidden(): void {}\n}\n', 'ok'),
    ('good-constructor-exempt',
     '/** doc */\nexport class C {\n  constructor(x: number) {}\n}\n', 'ok'),
    ('good-interface-member-exempt',
     '/** doc */\nexport interface T {\n  send(r: string): Promise<string>;\n}\n',
     'ok'),
    ('bad-internal-below-80',
     '/** d */\nexport function f() { return 1; }\n'
     'function a() { return 1; }\nfunction b() { return 2; }\n',
     'internal_missing'),
    ('good-internal-vacuous-empty',
     '/** d */\nexport function f() { return 1; }\n', 'ok'),
    ('good-regex-template-robustness',
     '/** d1 */\nexport const R = /^https?:\\/\\//i;\n'
     '/** d2 */\nexport function g(p: string) {\n'
     '  return `v${p}${R.source}{x}`;\n}\n'
     '/** d3 */\nexport const T = 1;\n', 'ok'),
]


def _expectation(rep: Report, expect: str) -> bool:
    if expect == 'ok':
        return rep.ok
    if expect == 'external_missing':
        return (not rep.ok) and rep.external_documented < rep.external_total
    if expect == 'internal_missing':
        return (not rep.ok) and (
            rep.internal_total > 0
            and rep.internal_documented * 100 < 80 * rep.internal_total)
    return False


def self_test() -> int:
    """负控制:内嵌已知坏输入,断言检查逻辑给出非零判定;失败 exit 非 0。"""
    failures = []
    for name, src, expect in SELF_TEST_CASES:
        rep = scan_files([('<self-test>', src)])
        if not _expectation(rep, expect):
            failures.append(
                f'{name}: 期望 {expect},实际 对外 '
                f'{rep.external_documented}/{rep.external_total}、内部 '
                f'{rep.internal_documented}/{rep.internal_total},missing='
                f'{rep.missing}')
    # 端到端负控制:整份"删除 docstring"后的仓库切片 → 整体必须未达标
    bad_repo = [
        ('src/a.ts', '/** d */\nexport const A = 1;\n'
                     'export const B = 2;\n'),          # B 缺 doc → 拦截
        ('src/b.ts', '/** d */\nexport function f() { return 1; }\n'),
    ]
    rep = scan_files(bad_repo)
    if rep.ok or rep.missing != ['src/a.ts:3 B']:
        failures.append(f'端到端坏仓库未被拦截: ok={rep.ok}, missing={rep.missing}')
    # 全绿仓库 → 必须达标(防门全拒)
    good_repo = [
        ('src/a.ts', '/** d */\nexport const A = 1;\n/** d */\nexport const B = 2;\n'),
    ]
    rep = scan_files(good_repo)
    if not rep.ok:
        failures.append(f'全绿仓库误报: missing={rep.missing}')
    if failures:
        for f in failures:
            print(f'SELF-TEST FAIL: {f}', file=sys.stderr)
        return 1
    print(f'self-test: {len(SELF_TEST_CASES) + 2} 项全部通过')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description='wop-typescript-sdk docstring 门检查器(统一契约)')
    parser.add_argument('--self-test', action='store_true',
                        help='负控制自测(内嵌已知坏输入)')
    parser.add_argument('--json', action='store_true',
                        help='输出 JSON 统计')
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    rep = scan_repo()
    if args.json:
        print(json.dumps({
            'ok': rep.ok,
            'external': {'total': rep.external_total,
                         'documented': rep.external_documented},
            'internal': {'total': rep.internal_total,
                         'documented': rep.internal_documented},
            'missing': rep.missing,
        }, ensure_ascii=False, indent=2))
    else:
        print(format_report(rep))
    return 0 if rep.ok else 1


if __name__ == '__main__':
    sys.exit(main())
