"""docstring_gate.py 的 pytest 测试(外部驱动,与内嵌 --self-test 互补)。

覆盖目标:行+分支覆盖 ≥95%(CLAUDE.md 变更行覆盖率硬性要求)。
被测模块为函数式脚本(``if __name__ == '__main__'`` 保护),经
importlib 按真实路径加载;Python 3.14 的 dataclass 要求先注册进
sys.modules,故有 ``sys.modules[...] = gate`` 一行。
"""
# spec:DG-1 对外 API 100% 红线 → 阈值与判定测试(见下方用例)
# spec:DG-2 内部 ≥80%(空内部集=达标) → 阈值边界测试
# spec:DG-3 docstring 归属判定(注释形态/空行/组注释不覆盖) → 判定测试
# spec:DG-4 CLI 无参 exit 0/1 + 逐符号缺失清单 + 统计 → main/CLI 测试
# spec:DG-5 --self-test 负控制(先红后绿) → self_test 测试
# spec:DG-6 扫描面 = git ls-files 枚举(反作弊) → 扫描面测试
# spec:DG-7 factory-local.json docstring_gate_cmd 禁引号/反斜杠 → 上游 test_factory_lib.py TestDocstringGateWords
# spec:DG-8 defects.json D-xx gate=docstring 击杀 → mutations/defects.json D-01/D-02 PASS
# spec:DG-10 mutations judge 门域 0/1 → 上游 test_mutations_run.py TestDocstringGateJudge


from __future__ import annotations

import importlib.util
import json
import runpy
import subprocess
import sys
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parent / 'docstring_gate.py'
_spec = importlib.util.spec_from_file_location('docstring_gate_under_test', _SCRIPT)
gate = importlib.util.module_from_spec(_spec)
sys.modules['docstring_gate_under_test'] = gate
_spec.loader.exec_module(gate)


# ── strip_noncode:词法剥离 ──────────────────────────────────────────────────

def test_strip_line_comment_and_block_comment():
    assert gate.strip_noncode('let a = 1; // note\nlet b = 2;') == \
        'let a = 1;        \nlet b = 2;'
    assert gate.strip_noncode('let a; /* c\nc2 */ let b;') == \
        'let a;     \n      let b;'


def test_strip_double_quote_with_escape():
    # 转义引号不闭合字符串:字符串整体(含定界符与转义)空格化
    assert gate.strip_noncode('const s = "a\\"b" + 1;') == 'const s =        + 1;'


def test_strip_single_quote_unclosed_by_newline():
    # 未闭合字符串按行终止(容错):换行保留
    assert gate.strip_noncode("let s = 'abc\nlet y = 2;") == 'let s =     \nlet y = 2;'


def test_strip_single_quote_unclosed_at_eof():
    # 文件结束仍未闭合:剩余按内容空格化,不抛异常
    assert gate.strip_noncode("let s = 'abc") == 'let s =     '


def test_strip_template_with_escaped_backtick():
    assert gate.strip_noncode('`a\\`b`') == '      '


def test_strip_template_interpolation_keeps_code():
    # ${...} 内部按代码处理;插值定界符 ${ 与 } 空格化,内部代码保留
    out = gate.strip_noncode('`x${ {k: 1} }y`')
    assert out == '     {k: 1}    '
    assert len(out) == len('`x${ {k: 1} }y`')


def test_strip_escape_backslash_at_eof():
    # 转义反斜杠恰为文件末字符:quote/template 两模式各自的越界容错分支
    assert gate.strip_noncode('let s = "x\\') == 'let s =    '
    assert gate.strip_noncode('`t\\') == '   '


def test_strip_nested_template():
    # 嵌套模板:内层模板内容空格化,最内插值代码保留
    assert gate.strip_noncode('`a${`b${c}d`}e`') == '        c      '


def test_strip_regex_after_return_keyword():
    assert gate.strip_noncode('function f() { return /a\\/b/g; }') == \
        'function f() { return        ; }'


def test_strip_regex_char_class_slash_does_not_close():
    # [...] 字符类内 /* 形似注释但不提前闭合正则
    out = gate.strip_noncode('function f() { return /re[/*]x/g.test(t); }')
    assert out == 'function f() { return           .test(t); }'


def test_strip_division_is_not_regex():
    assert gate.strip_noncode('const z = a / b / c;') == 'const z = a / b / c;'


def test_strip_regex_at_start_and_eof():
    # 首字符即斜杠(last_code 空 → 正则)且未闭合到 EOF:循环自然耗尽
    assert gate.strip_noncode('/x') == '  '


def test_strip_division_slash_at_eof():
    assert gate.strip_noncode('x = a /') == 'x = a /'


def test_strip_kitchen_sink_preserves_shape():
    src = (
        '// 行注释\n'
        'const a = "双引号";\n'
        '/* 块注释\n   跨行 */\n'
        'let t = `模板 ${a + "/x/"} 尾`;\n'
        'function f() { return /re[/*]x/g.test(t); }\n'
        'const div = a / 2;\n'
    )
    out = gate.strip_noncode(src)
    lines = out.split('\n')
    assert len(out) == len(src)                 # 等长
    assert out.count('\n') == src.count('\n')   # 换行对齐
    assert lines[1] == 'const a =      ;'
    assert lines[2] == '      '                 # 块注释首行整行空格化
    assert lines[3] == '        '               # 块注释续行同样空格化
    # 模板定界符/内容/插值括号全部空格化,插值内代码 a + 保留
    assert lines[4] == 'let t = ' + ' ' * 6 + 'a + ' + ' ' * 9 + ';'
    assert lines[5] == 'function f() { return           .test(t); }'
    assert lines[6] == 'const div = a / 2;'


# ── _is_regex_start / _skip_regex ───────────────────────────────────────────

def test_is_regex_start_matrix():
    assert gate._is_regex_start('', '') is True          # 无前驱(行首/起始)
    assert gate._is_regex_start('(', 'x') is True        # 运算符前驱
    assert gate._is_regex_start('n', 'return') is True   # 关键字前驱
    assert gate._is_regex_start('a', 'a') is False       # 操作数前驱 → 除号
    assert gate._is_regex_start('.', 'x') is False       # 非字母数字非运算符


def test_skip_regex_char_class_and_flags():
    # [a/b]:类内 / 不闭合;']' 后 '/' 闭合;'gi' 旗标一并消费
    assert gate._skip_regex('/[a/b]c/gi + 1', 0) == 10


def test_skip_regex_newline_fallback():
    # 跨行必非正则:遇 \n 按单斜杠容错,返回换行处下标
    assert gate._skip_regex('/ab\ncd/', 0) == 3


def test_skip_regex_unterminated_to_eof():
    assert gate._skip_regex('/x', 0) == 2


# ── parse_method ────────────────────────────────────────────────────────────

def test_parse_method_modifier_chain():
    assert gate.parse_method('public static async foo(a: number): void {') == \
        ('foo', 'method')
    assert gate.parse_method('protected foo()') == ('foo', 'method')


def test_parse_method_private_exempt():
    assert gate.parse_method('private hidden(): void {}') is None
    assert gate.parse_method('static private s() {}') is None


def test_parse_method_accessor_branches():
    # word 为 get/set:其后紧跟 name(...) 才构成存取器
    assert gate.parse_method('get url(): string { return "u"; }') is None
    assert gate.parse_method('get val') is None
    assert gate.parse_method('get (x)') == ('get', 'accessor')


def test_parse_method_reserved_and_non_method():
    assert gate.parse_method('constructor(x: number) {}') is None
    assert gate.parse_method('if (x) {') is None
    assert gate.parse_method('return foo()') is None
    assert gate.parse_method('{ baz()') is None      # 行首非标识符
    assert gate.parse_method('field: number;') is None
    assert gate.parse_method('name = (x) => 1') is None


def test_parse_method_generic():
    assert gate.parse_method('handle<T>(req: Req): Res') == ('handle', 'method')


# ── _decl_kind ──────────────────────────────────────────────────────────────

def test_decl_kind_all_keywords_and_fallback():
    assert gate._decl_kind('export function f() {}') == 'function'
    assert gate._decl_kind('export class C {}') == 'class'
    assert gate._decl_kind('export interface I {}') == 'interface'
    assert gate._decl_kind('export type T = 1') == 'type'
    assert gate._decl_kind('export enum E {}') == 'enum'
    assert gate._decl_kind('export const K = 1') == 'const'
    assert gate._decl_kind('export var x') == 'decl'


# ── has_docstring ───────────────────────────────────────────────────────────

def test_has_docstring_no_previous_line():
    assert gate.has_docstring(['export const A = 1;'], 0) is False


def test_has_docstring_blocked_by_blank_line():
    assert gate.has_docstring(['// d', '', 'const a = 1;'], 2) is False


def test_has_docstring_previous_not_comment():
    assert gate.has_docstring(['let x = 1;', 'const a = 1;'], 1) is False


def test_has_docstring_line_comment_block():
    assert gate.has_docstring(['// d', 'const a = 1;'], 1) is True


def test_has_docstring_multiline_jsdoc_walk_up():
    lines = ['/**', ' * d', ' */', 'const a = 1;']
    assert gate.has_docstring(lines, 3) is True


def test_has_docstring_plain_block_comment_rejected():
    assert gate.has_docstring(['/* d */', 'const a = 1;'], 1) is False


def test_has_docstring_walk_up_stops_at_code_line():
    lines = ['let x = 1;', '// d', 'const a = 1;']
    assert gate.has_docstring(lines, 2) is True


def test_has_docstring_walk_up_stops_at_blank_line():
    lines = ['', '// tail', '/** d */', 'const a = 1;']
    assert gate.has_docstring(lines, 3) is True


def test_has_docstring_walk_up_stops_at_file_start():
    lines = ['// only', 'const a = 1;']
    assert gate.has_docstring(lines, 1) is True


# ── Report.ok 阈值边界 ─────────────────────────────────────────────────────

def test_report_ok_external_boundary():
    assert gate.Report(external_total=2, external_documented=2).ok is True
    assert gate.Report(external_total=2, external_documented=1).ok is False


def test_report_ok_internal_vacuous_and_boundary():
    assert gate.Report().ok is True                                   # 空集达标
    assert gate.Report(internal_total=0, internal_documented=0).ok is True
    assert gate.Report(internal_total=2, internal_documented=2).ok is True
    # 恰 80%(4/5):4*100 >= 80*5 → 达标
    assert gate.Report(internal_total=5, internal_documented=4).ok is True
    # 低于 80%(3/5)→ 未达标
    assert gate.Report(internal_total=5, internal_documented=3).ok is False


# ── analyze ────────────────────────────────────────────────────────────────

def test_analyze_exported_class_members():
    src = (
        '/** doc */\n'
        'export class Client {\n'
        '  send(req: string): string { return req; }\n'
        '  get url(): string { return "u"; }\n'
        '  private hide(): void {}\n'
        '  constructor(x: number) {}\n'
        '  field: number;\n'
        '  helper<T>(x: T): T { return x; }\n'
        '}\n'
    )
    symbols = gate.analyze('src/c.ts', src)
    assert [(s.name, s.kind, s.decl, s.line) for s in symbols] == [
        ('Client', 'external', 'class', 2),
        ('Client.send', 'external', 'method', 3),
        ('Client.helper', 'external', 'method', 8),
    ]


def test_analyze_decl_kinds_and_internal():
    src = (
        '/** d */\n'
        'export default class A {}\n'
        'export declare abstract class B {}\n'
        'export async function* gen() {}\n'
        'export const K = 1;\n'
        'export enum E { X }\n'
        'interface I {}\n'
        'type T = string;\n'
        'function inner() {}\n'
    )
    symbols = gate.analyze('src/k.ts', src)
    assert [(s.name, s.kind, s.decl) for s in symbols] == [
        ('A', 'external', 'class'),
        ('B', 'external', 'class'),
        ('gen', 'external', 'function'),
        ('K', 'external', 'const'),
        ('E', 'external', 'enum'),
        ('I', 'internal', 'interface'),
        ('T', 'internal', 'type'),
        ('inner', 'internal', 'function'),
    ]


def test_analyze_interface_members_not_counted():
    src = '/** d */\nexport interface I {\n  send(r: string): Promise<string>;\n}\n'
    symbols = gate.analyze('src/i.ts', src)
    assert [(s.name, s.kind) for s in symbols] == [('I', 'external')]


def test_analyze_depth_two_ignored():
    src = (
        '/** d */\n'
        'export class C {\n'
        '  m() {\n'
        '    function nested() {}\n'
        '  }\n'
        '}\n'
    )
    assert [(s.name, s.decl) for s in gate.analyze('src/n.ts', src)] == [
        ('C', 'class'), ('C.m', 'method'),
    ]


def test_analyze_class_state_resets_at_depth_zero():
    src = (
        '/** d */\n'
        'export class A {\n'
        '  m() {}\n'
        '}\n'
        '/** d */\n'
        'export const K = 1;\n'
    )
    symbols = gate.analyze('src/r.ts', src)
    assert [s.name for s in symbols] == ['A', 'A.m', 'K']


# ── scan_files / format_report ──────────────────────────────────────────────

def test_scan_files_counts_and_missing_format():
    src = ('/** d */\nexport const A = 1;\nexport const B = 2;\n'
           'function h() {}\n')
    rep = gate.scan_files([('src/x.ts', src)])
    assert (rep.external_total, rep.external_documented) == (2, 1)
    assert (rep.internal_total, rep.internal_documented) == (1, 0)
    assert rep.missing == ['src/x.ts:3 B', 'src/x.ts:4 h']
    assert rep.ok is False


def test_scan_files_empty_input():
    rep = gate.scan_files([])
    assert rep.ok is True and rep.missing == []


def test_format_report_fail_and_pass():
    rep = gate.Report(external_total=2, external_documented=1,
                      internal_total=5, internal_documented=4,
                      missing=['src/a.ts:2 B'])
    text = gate.format_report(rep)
    assert text.splitlines()[0] == 'src/a.ts:2 B'
    assert '对外 1/2、内部 4/5' in text
    assert 'docstring gate: FAIL' in text
    ok = gate.format_report(gate.Report(external_total=1, external_documented=1))
    assert '对外 1/1、内部 0/0' in ok and 'docstring gate: PASS' in ok


# ── scan_repo(git ls-files 集成,monkeypatch 隔离)─────────────────────────

def test_scan_repo_enumerates_and_excludes_dts(monkeypatch, tmp_path):
    src_dir = tmp_path / 'src'
    src_dir.mkdir()
    (src_dir / 'a.ts').write_text('/** d */\nexport const A = 1;\n',
                                  encoding='utf-8')
    (src_dir / 'b.d.ts').write_text('declare const X: number;\n',
                                    encoding='utf-8')
    seen = {}

    def fake_run(cmd, **kwargs):
        seen['cmd'] = cmd
        seen['kwargs'] = kwargs
        return subprocess.CompletedProcess(
            cmd, 0, stdout='src/a.ts\n\nsrc/b.d.ts\n')

    monkeypatch.setattr(gate.subprocess, 'run', fake_run)
    monkeypatch.setattr(gate, 'REPO_ROOT', tmp_path)
    rep = gate.scan_repo()
    assert seen['cmd'] == ['git', 'ls-files', '--', 'src/*.ts', 'src/**/*.ts']
    assert seen['kwargs']['check'] is True
    assert (rep.external_total, rep.external_documented) == (1, 1)  # .d.ts 排除
    assert rep.ok is True


def test_scan_repo_git_failure_fail_closed(monkeypatch, capsys):
    def fake_run(cmd, **kwargs):
        raise subprocess.CalledProcessError(128, cmd)

    monkeypatch.setattr(gate.subprocess, 'run', fake_run)
    with pytest.raises(SystemExit) as excinfo:
        gate.scan_repo()
    assert excinfo.value.code == 2
    assert 'git ls-files 失败' in capsys.readouterr().err


# ── _expectation ────────────────────────────────────────────────────────────

def test_expectation_matrix():
    ok_rep = gate.Report(external_total=1, external_documented=1)
    assert gate._expectation(ok_rep, 'ok') is True
    # rep 已达标 → external_missing 判定不成立
    assert gate._expectation(ok_rep, 'external_missing') is False
    bad_ext = gate.Report(external_total=1, external_documented=0)
    assert gate._expectation(bad_ext, 'external_missing') is True
    assert gate._expectation(bad_ext, 'ok') is False
    # 内部空集 → internal_missing 不成立
    assert gate._expectation(bad_ext, 'internal_missing') is False
    bad_int = gate.Report(internal_total=5, internal_documented=3)
    assert gate._expectation(bad_int, 'internal_missing') is True
    # 恰 80% → 未低于阈值,internal_missing 不成立
    eighty = gate.Report(internal_total=5, internal_documented=4)
    assert gate._expectation(eighty, 'internal_missing') is False
    # 未知期望值 → False(保守)
    assert gate._expectation(ok_rep, 'bogus') is False


# ── self_test ───────────────────────────────────────────────────────────────

def test_self_test_passes(capsys):
    assert gate.self_test() == 0
    out = capsys.readouterr().out
    assert '全部通过' in out and str(len(gate.SELF_TEST_CASES) + 2) in out


def test_self_test_reports_broken_case(monkeypatch, capsys):
    monkeypatch.setattr(
        gate, 'SELF_TEST_CASES',
        [('broken', 'export function noDoc() {}\n', 'ok')])
    assert gate.self_test() == 1
    err = capsys.readouterr().err
    assert 'SELF-TEST FAIL: broken' in err
    assert '期望 ok' in err


def test_self_test_end_to_end_intercept_guard(monkeypatch, capsys):
    # scan_files 全部"达标" → 坏仓库未被拦截,自测必须报警
    monkeypatch.setattr(gate, 'scan_files',
                        lambda files: gate.Report(external_total=1,
                                                  external_documented=1))
    assert gate.self_test() == 1
    err = capsys.readouterr().err
    assert '端到端坏仓库未被拦截' in err


def test_self_test_false_positive_guard(monkeypatch, capsys):
    real_scan = gate.scan_files

    def fake_scan(files):
        # 仅对"全绿仓库"切片注入误报;其余走真实实现
        first_path, first_src = files[0]
        if first_path == 'src/a.ts' and first_src.count('/**') == 2:
            return gate.Report(external_total=1, external_documented=0,
                               missing=['src/a.ts:3 B'])
        return real_scan(files)

    monkeypatch.setattr(gate, 'scan_files', fake_scan)
    assert gate.self_test() == 1
    assert '全绿仓库误报' in capsys.readouterr().err


# ── main / CLI ──────────────────────────────────────────────────────────────

def _patch_argv(monkeypatch, *args):
    monkeypatch.setattr(sys, 'argv', ['docstring_gate.py', *args])


def test_main_plain_pass(monkeypatch, capsys):
    _patch_argv(monkeypatch)
    monkeypatch.setattr(gate, 'scan_repo', lambda: gate.Report(
        external_total=1, external_documented=1))
    assert gate.main() == 0
    out = capsys.readouterr().out
    assert '对外 1/1、内部 0/0' in out and 'docstring gate: PASS' in out


def test_main_plain_fail_exit_1(monkeypatch, capsys):
    _patch_argv(monkeypatch)
    monkeypatch.setattr(gate, 'scan_repo', lambda: gate.Report(
        external_total=2, external_documented=1,
        internal_total=2, internal_documented=1,
        missing=['src/a.ts:2 f']))
    assert gate.main() == 1
    out = capsys.readouterr().out
    assert out.splitlines()[0] == 'src/a.ts:2 f'
    assert 'docstring gate: FAIL' in out


def test_main_json_output(monkeypatch, capsys):
    _patch_argv(monkeypatch, '--json')
    monkeypatch.setattr(gate, 'scan_repo', lambda: gate.Report(
        external_total=2, external_documented=1, missing=['src/a.ts:2 B']))
    assert gate.main() == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload == {
        'ok': False,
        'external': {'total': 2, 'documented': 1},
        'internal': {'total': 0, 'documented': 0},
        'missing': ['src/a.ts:2 B'],
    }


def test_main_self_test_flag(monkeypatch, capsys):
    _patch_argv(monkeypatch, '--self-test')
    assert gate.main() == 0
    assert '全部通过' in capsys.readouterr().out


def test_main_unknown_argument_exits_2(monkeypatch, capsys):
    _patch_argv(monkeypatch, '--bogus')
    with pytest.raises(SystemExit) as excinfo:
        gate.main()
    assert excinfo.value.code == 2
    assert 'unrecognized arguments' in capsys.readouterr().err


def test_dunder_main_guard_executes_via_runpy(monkeypatch, capsys):
    # 以 __main__ 名义执行脚本本体:覆盖 if __name__ == '__main__' 真分支
    _patch_argv(monkeypatch, '--self-test')
    with pytest.raises(SystemExit) as excinfo:
        runpy.run_path(str(_SCRIPT), run_name='__main__')
    assert excinfo.value.code == 0
    assert '全部通过' in capsys.readouterr().out
