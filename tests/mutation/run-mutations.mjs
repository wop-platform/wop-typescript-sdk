#!/usr/bin/env node
/**
 * WOP TS SDK 变异测试运行器（自研脚本：PIT/Stryker 类工具不在本项目依赖面内）。
 *
 * 原理：TypeScript AST 定位变异点 → 文本级替换写回 src → 跑 vitest 全量 → 恢复原文。
 * 击杀判定：vitest 退出码非 0（含超时 kill——行为破坏导致挂起同样是被测试资产捕获的缺陷）。
 *
 * 变异算子（12 类，覆盖条件/数学/返回值/常量四象限）：
 *   条件类   : cond-lt(边界<→<=) cond-gt(边界>→>=) eq(===→!==) neq(!==→===) not-drop(!x→x)
 *   数学类   : arith(+→-) shift(<<→>>)
 *   返回值类 : bool(true→false) stmt-del(表达式/条件语句删除)
 *   常量类   : numeric(n→n+1) string(追加后缀)
 *   逻辑类   : logic(&&→||)
 *
 * 门禁：击杀率 ≥ KILL_RATE_THRESHOLD(90%)，不达标 exit 1。
 * 安全：逐变异体立即恢复原文件；结束时字节校验 src 与初始快照一致（不一致即失败退出）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import ts from 'typescript';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SRC_DIR = path.join(ROOT, 'src');
const KILL_RATE_THRESHOLD = 0.9;
const PER_OP_PER_FILE_CAP = 8; // 每算子每文件采样上限
const MUTANT_TIMEOUT_MS = 90_000;
// 变异口径与覆盖率口径对齐：re-export 门面与纯类型声明无可执行语义
const EXCLUDE = new Set(['index.ts', 'types.ts']);

const require = createRequire(import.meta.url);
const VITEST_BIN = path.join(ROOT, 'node_modules', '.bin', 'vitest');

/** 12 类算子注册表：op → { pick(sourceFile): MutPoint[] } */
const OPERATORS = {
  'cond-lt': {
    desc: '条件边界 a < b → a <= b',
    pick: collectBinary(['<'], (t) => '<='),
  },
  'cond-gt': {
    desc: '条件边界 a > b → a >= b',
    pick: collectBinary(['>'], (t) => '>='),
  },
  'arith-plus': {
    desc: '数学 a + b → a - b',
    pick: collectBinary(['+'], (t) => '-'),
  },
  'shift': {
    desc: '位移 a << b → a >> b',
    pick: collectBinary(['<<'], (t) => '>>'),
  },
  'logic-and': {
    desc: '逻辑 a && b → a || b',
    pick: collectBinary(['&&'], (t) => '||'),
  },
  eq: {
    desc: '相等 a === b → a !== b',
    pick: collectBinary(['==='], (t) => '!=='),
  },
  neq: {
    desc: '不等 a !== b → a === b',
    pick: collectBinary(['!=='], (t) => '==='),
  },
  bool: {
    desc: '布尔常量 true → false（返回值/配置表污染）',
    pick: (sf) => keywordPoints(sf, ts.SyntaxKind.TrueKeyword, 'false'),
  },
  'not-drop': {
    desc: '一元取反删除 !x → x',
    pick: (sf) => {
      const out = [];
      visit(sf, (n) => {
        if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
          out.push({ start: n.getStart(sf), end: n.operand.getStart(sf), replacement: '' });
        }
      });
      return out;
    },
  },
  numeric: {
    desc: '数值常量 n → n+1',
    pick: (sf) => {
      const out = [];
      visit(sf, (n) => {
        if (
          ts.isNumericLiteral(n) &&
          !/[^0-9.]/.test(n.text) &&
          Number(n.text) >= 2 &&
          !insideTypeNode(n)
        ) {
          out.push({
            start: n.getStart(sf),
            end: n.end,
            replacement: String(Number(n.text) + 1),
          });
        }
      });
      return out;
    },
  },
  string: {
    desc: '字符串常量追加后缀（错误文案/协议名污染）',
    pick: (sf) => {
      const headerRanges = sf.statements
        .filter((s) => ts.isImportDeclaration(s) || ts.isExportDeclaration(s))
        .map((s) => [s.getStart(sf), s.end]);
      const out = [];
      visit(sf, (n) => {
        if (!ts.isStringLiteral(n) || n.text.length < 4 || insideTypeNode(n)) return;
        const start = n.getStart(sf);
        if (headerRanges.some(([a, b]) => start >= a && start < b)) return; // 不动 import/export 说明符
        const raw = sf.text.slice(start, n.end);
        const quote = raw[0];
        out.push({ start: n.end - 1, end: n.end, replacement: quote === "'" ? "@mut'" : '"@mut"' });
      });
      return out;
    },
  },
  'stmt-del': {
    desc: '语句删除（表达式语句 / if 分支，返回值与控制流污染）',
    pick: (sf) => {
      const out = [];
      visit(sf, (n) => {
        if (ts.isExpressionStatement(n) || ts.isIfStatement(n)) {
          // 保留结构完整性：不删带 else 的 if，不删含 return/throw 的语句
          if (ts.isIfStatement(n) && n.elseStatement) return;
          if (
            ts.isExpressionStatement(n) &&
            (ts.isReturnStatement(n.expression) || ts.isThrowStatement(n.expression))
          )
            return;
          out.push({ start: n.getStart(sf), end: n.end, replacement: '' });
        }
      });
      return out;
    },
  },
};

// ---------- AST 工具 ----------

function collectBinary(ops, render) {
  return (sf) => {
    const out = [];
    visit(sf, (n) => {
      if (!ts.isBinaryExpression(n)) return;
      if (!ops.includes(n.operatorToken.getText(sf))) return;
      out.push({
        start: n.operatorToken.getStart(sf),
        end: n.operatorToken.end,
        replacement: render(n.operatorToken.getText(sf)),
      });
    });
    return out;
  };
}

/** 类型位置（LiteralTypeNode / IndexedAccessType 等）的字面量无运行时语义，跳过 */
function insideTypeNode(n) {
  let p = n.parent;
  while (p) {
    if (ts.isTypeNode(p)) return true;
    p = p.parent;
  }
  return false;
}

function keywordPoints(sf, kind, replacement) {
  const out = [];
  visit(sf, (n) => {
    if (n.kind === kind && !insideTypeNode(n)) out.push({ start: n.getStart(sf), end: n.end, replacement });
  });
  return out;
}

function visit(node, fn) {
  fn(node);
  node.forEachChild((c) => visit(c, fn));
}

// ---------- 主流程 ----------

function listSrcFiles() {
  const files = [];
  for (const entry of fs.readdirSync(SRC_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const f of fs.readdirSync(path.join(SRC_DIR, entry.name))) {
        if (f.endsWith('.ts') && !EXCLUDE.has(f)) files.push(path.join(SRC_DIR, entry.name, f));
      }
    } else if (entry.name.endsWith('.ts') && !EXCLUDE.has(entry.name)) {
      files.push(path.join(SRC_DIR, entry.name));
    }
  }
  return files;
}

function runVitest(label) {
  const r = spawnSync(VITEST_BIN, ['run', '--reporter=dot', '--silent'], {
    cwd: ROOT,
    timeout: MUTANT_TIMEOUT_MS,
    encoding: 'utf8',
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { killed: true, detail: 'timeout' };
  return { killed: r.status !== 0, detail: `exit=${r.status}` };
}

function main() {
  const files = listSrcFiles();
  const originals = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));

  // 1. 收集并采样变异点
  const mutants = [];
  for (const file of files) {
    const sf = ts.createSourceFile(file, originals.get(file), ts.ScriptTarget.ES2022, true);
    for (const [op, def] of Object.entries(OPERATORS)) {
      let pts = [];
      try {
        pts = def.pick(sf);
      } catch (e) {
        console.error(`[warn] ${op} 采集失败 ${path.basename(file)}: ${e.message}`);
        continue;
      }
      if (pts.length > PER_OP_PER_FILE_CAP) {
        const stride = pts.length / PER_OP_PER_FILE_CAP;
        pts = Array.from({ length: PER_OP_PER_FILE_CAP }, (_, i) => pts[Math.floor(i * stride)]);
      }
      for (const p of pts) {
        mutants.push({
          id: `${path.basename(file)}:${sf.getLineAndCharacterOfPosition(p.start).line + 1}`,
          op,
          file,
          ...p,
        });
      }
    }
  }
  console.log(`变异点采样完成：${mutants.length} 个变异体 / ${Object.keys(OPERATORS).length} 类算子 / ${files.length} 个源文件\n`);

  // 2. 基线：未变异套件必须全绿，否则变异结果无意义
  const baseline = runVitest('baseline');
  if (baseline.killed) {
    console.error(`基线 vitest 失败（${baseline.detail}），中止：先修测试再变异`);
    process.exit(2);
  }

  // 3. 逐变异体：写入 → 跑 → 恢复
  const results = [];
  let done = 0;
  for (const m of mutants) {
    const src = originals.get(m.file);
    const mutated = src.slice(0, m.start) + m.replacement + src.slice(m.end);
    try {
      fs.writeFileSync(m.file, mutated);
      const { killed, detail } = runVitest(m.id);
      results.push({ ...m, killed, detail });
    } finally {
      fs.writeFileSync(m.file, src); // 立即恢复
    }
    done += 1;
    if (done % 10 === 0) console.log(`  … ${done}/${mutants.length}`);
  }

  // 4. 字节级校验恢复完整性
  for (const [f, content] of originals) {
    if (fs.readFileSync(f, 'utf8') !== content) {
      console.error(`恢复校验失败：${f} 与初始快照不一致`);
      process.exit(2);
    }
  }

  // 5. 报告
  const byOp = {};
  for (const r of results) {
    byOp[r.op] ??= { total: 0, killed: 0 };
    byOp[r.op].total += 1;
    if (r.killed) byOp[r.op].killed += 1;
  }
  const killed = results.filter((r) => r.killed).length;
  const score = results.length ? killed / results.length : 0;

  console.log('\n=== 变异测试报告（vitest 套件为击杀资产）===');
  console.log('算子                击杀/总数');
  for (const [op, s] of Object.entries(byOp).sort()) {
    const pct = ((s.killed / s.total) * 100).toFixed(0).padStart(3);
    console.log(`${op.padEnd(20)} ${String(s.killed).padStart(3)}/${String(s.total).padEnd(4)} ${pct}%  ${OPERATORS[op].desc}`);
  }
  console.log(`\n总变异体 ${results.length}，击杀 ${killed}，击杀率 ${(score * 100).toFixed(2)}%（门禁 ${(KILL_RATE_THRESHOLD * 100).toFixed(0)}%）`);

  const survivors = results.filter((r) => !r.killed);
  if (survivors.length) {
    console.log(`\n幸存变异体 ${survivors.length} 个：`);
    for (const s of survivors) console.log(`  [SURVIVED] ${s.id} [${s.op}] ${s.detail}`);
  }

  fs.writeFileSync(
    path.join(ROOT, 'tests/mutation/report.json'),
    JSON.stringify({ total: results.length, killed, score, byOp, survivors }, null, 2),
  );

  process.exit(score >= KILL_RATE_THRESHOLD ? 0 : 1);
}

main();
