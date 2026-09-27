/* dsh-liquid-glass · 安装状态自检
 *
 * 为什么需要：曾经出现过「插件不在 profile 的 bundle 列表里」的情况 ——
 * 表现是**完全没有任何反应**（不报错、不崩、样式不出现），
 * 而所有代码改动都白做。所以先查安装状态，再谈效果。
 *
 * 用法：node check-install.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const PROFILE = join(homedir(), '.dsh', 'profiles', 'desktop');
const PKG_NAME = '@local/dsh-liquid-glass';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

/* 插件根目录：默认取脚本上一级（test/ 的父目录），可用 DSHLG_ROOT 覆盖。
   这样别人 clone 到任意路径都能直接跑，不再依赖某台机器的绝对路径。 */
const PLUGIN = process.env.DSHLG_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
/* 临时目录：默认走系统 tmp，可用 DSHLG_TMP 覆盖。 */
const TMP = process.env.DSHLG_TMP || tmpdir();

let bad = 0;
const ok = (label, pass, detail) => {
  console.log((pass ? '  PASS  ' : '  FAIL  ') + label + '　' + detail);
  if (!pass) bad += 1;
};

/* ① profile 的 bundle 列表必须包含本插件 */
let profile = null;
try { profile = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8')); } catch (e) {
  ok('读取 profile/package.json', false, String(e.message));
}
if (profile) {
  const bundles = profile.dsh?.profile?.bundles ?? [];
  ok('profile 的 bundle 列表包含本插件', bundles.includes(PKG_NAME),
    'bundles = [' + bundles.join(', ') + ']');
  ok('profile 的 dependencies 有链接', Boolean(profile.dependencies?.[PKG_NAME]),
    JSON.stringify(profile.dependencies?.[PKG_NAME] ?? null));
}

/* ② 插件自身的 manifest 与客户端入口 */
const pkgPath = join(PLUGIN, 'package.json');
let pkg = null;
try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch (e) {
  ok('读取插件 package.json', false, String(e.message));
}
if (pkg) {
  ok('声明了 dsh.client（platform=web）', pkg.dsh?.client?.platform === 'web',
    JSON.stringify(pkg.dsh?.client ?? null));
  const rel = pkg.exports?.['./client'];
  const clientRel = typeof rel === 'string' ? rel : rel?.default;
  ok('exports["./client"] 是字符串', typeof clientRel === 'string', String(clientRel));
  if (clientRel) {
    const abs = join(dirname(pkgPath), clientRel);
    const exists = existsSync(abs);
    ok('客户端半体文件存在', exists, abs + (exists ? '（' + statSync(abs).size + ' 字节）' : ''));
  }
  ok('dsh.bundle.patch 已声明', typeof pkg.dsh?.bundle?.patch === 'string', String(pkg.dsh?.bundle?.patch));
}

/* ③ bundle 解析：本插件必须在 profile 的 node_modules 或链接里能找到；
      其余 bundle（dsh-base / web-app / agent-team）由 DSH 自身提供，只提示不判失败。 */
try {
  const bundles = profile?.dsh?.profile?.bundles ?? [];
  for (const b of bundles) {
    const local = join(PROFILE, 'node_modules', ...b.split('/'), 'package.json');
    const isOurs = b === PKG_NAME;
    if (existsSync(local)) ok('bundle 可解析：' + b, true, local);
    else ok('bundle 可解析：' + b, !isOurs, isOurs ? '在 profile 里找不到 —— 必须修' : '由 DSH 自身提供');
  }
} catch (e) { ok('bundle 解析检查', false, String(e.message)); }

/* ④ profile 里指向插件的 junction 能解析到同一份文件 */
const linked = join(PROFILE, 'node_modules', ...PKG_NAME.split('/'), 'client.js');
ok('profile 里能看到客户端半体（junction）', existsSync(linked), linked);
if (existsSync(linked) && existsSync(join(PLUGIN, 'client.js'))) {
  const a = statSync(linked).size;
  const b = statSync(join(PLUGIN, 'client.js')).size;
  ok('junction 指向的就是源目录那份', a === b, a + ' vs ' + b);
}

console.log(bad ? '\n✗ ' + bad + ' 项不通过 —— 先修这里，否则改代码也不会生效' : '\n✓ 安装状态正常');
process.exit(bad ? 1 : 0);
