import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Portão contra a falha que derrubou a prod em 2026-07-22 (e antes disso em
 * outra ordem): `UndefinedDependencyException` no boot por import circular.
 *
 * A mecânica: com `emitDecoratorMetadata`, o tsc grava `design:paramtypes` como
 * uma REFERÊNCIA às classes dos parâmetros, avaliada quando o corpo do módulo
 * roda. Se, nesse instante, o arquivo que declara o tipo do parâmetro ainda
 * está no meio da própria avaliação (back-edge para um módulo na pilha de
 * require), o binding está vazio → o metadata grava `undefined` PRA SEMPRE na
 * definição da classe → o Nest não resolve a dependência e o app não sobe.
 *
 * O que torna isso traiçoeiro é que **o ciclo sozinho não quebra nada**. Ele
 * quebra quando a ORDEM DE CARGA muda — um PR que só acrescenta um import num
 * módulo distante pode detonar uma mina que estava lá há meses. Foi exatamente
 * o que aconteceu: o ciclo já existia, e um merge mudou a ordem.
 *
 * Por que um teste e não o boot: `nest build` passa, os ~800 testes passam e
 * até um smoke com Postgres passa — nada disso avalia os módulos na ordem real
 * do `main.ts`. Só o boot pega, e o boot só acontece no deploy. Este spec faz a
 * mesma conta em ~1s, sem docker e sem banco.
 *
 * Como funciona: parseia a árvore de imports a partir do `main.ts` e simula a
 * avaliação CommonJS (requires no topo na ordem escrita, corpo depois). Acusa
 * todo parâmetro de construtor cujo tipo esteja "em avaliação" no momento em que
 * a classe é declarada e que NÃO esteja protegido por `@Inject(...)`.
 *
 * Quando quebrar: envolva o parâmetro acusado em
 * `@Inject(forwardRef(() => Tipo))` — com o `forwardRef` correspondente entre os
 * módulos. O token deixa de vir do paramtypes e o `undefined` deixa de importar.
 */

const SRC = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(SRC, 'main.ts');
const repoRel = (f: string) => path.relative(path.join(SRC, '..'), f);

interface ParamInfo {
  type: string | null;
  /** Tem `@Inject(...)` → token explícito, imune ao paramtypes vazio. */
  guarded: boolean;
  declFile: string | null;
}
interface ClassInfo {
  name: string;
  params: ParamInfo[];
}
interface ModuleInfo {
  /** Imports de valor, na ordem escrita (`import type` não vira require). */
  imports: string[];
  classes: ClassInfo[];
}

const cache = new Map<string, ModuleInfo>();

/** Resolve um specifier relativo para um arquivo real do projeto. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // pacote externo: fora do grafo
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function parseModule(file: string): ModuleInfo {
  const cached = cache.get(file);
  if (cached) return cached;

  const src = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  const imports: string[] = [];
  const importedFrom = new Map<string, string>();

  src.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const target = resolveImport(file, node.moduleSpecifier.text);
    if (!target) return;
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return; // `import type` some no build
    imports.push(target);
    if (clause.name) importedFrom.set(clause.name.text, target);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        if (el.isTypeOnly) continue;
        importedFrom.set(el.name.text, target);
      }
    }
  });

  const classes: ClassInfo[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const ctor = node.members.find(ts.isConstructorDeclaration);
      if (ctor && ctor.parameters.length) {
        classes.push({
          name: node.name.text,
          params: ctor.parameters.map((p) => {
            const type =
              p.type && ts.isTypeReferenceNode(p.type)
                ? p.type.typeName.getText()
                : null;
            const deco = (ts.getDecorators(p) ?? [])
              .map((d) => d.getText())
              .join(' ');
            return {
              type,
              guarded: /@Inject\s*\(/.test(deco),
              declFile: type ? (importedFrom.get(type) ?? null) : null,
            };
          }),
        });
      }
    }
    node.forEachChild(visit);
  };
  src.forEachChild(visit);

  const info: ModuleInfo = { imports, classes };
  cache.set(file, info);
  return info;
}

interface Finding {
  cls: string;
  index: number;
  type: string;
  clsFile: string;
  typeFile: string;
  guarded: boolean;
}

/** Simula a avaliação CommonJS a partir do entrypoint. */
function simulate(entry: string): Finding[] {
  const done = new Set<string>();
  const inProgress = new Set<string>();
  const findings: Finding[] = [];

  const evaluate = (file: string) => {
    if (done.has(file) || inProgress.has(file)) return;
    inProgress.add(file);
    const mod = parseModule(file);

    // 1. requires do topo, na ordem escrita
    for (const dep of mod.imports) evaluate(dep);

    // 2. corpo do módulo: as declarações de classe gravam design:paramtypes
    for (const cls of mod.classes) {
      cls.params.forEach((p, index) => {
        if (!p.declFile || !p.type || p.declFile === file) return;
        // Binding vazio == módulo do tipo ainda na pilha de avaliação.
        if (!inProgress.has(p.declFile)) return;
        findings.push({
          cls: cls.name,
          index,
          type: p.type,
          clsFile: file,
          typeFile: p.declFile,
          guarded: p.guarded,
        });
      });
    }

    inProgress.delete(file);
    done.add(file);
  };

  evaluate(entry);
  return findings;
}

describe('guarda de DI circular (design:paramtypes)', () => {
  const findings = simulate(ENTRY);

  it('nenhum parâmetro de construtor recebe undefined na ordem de carga atual', () => {
    const fatal = findings.filter((f) => !f.guarded);

    // Lista formatada em vez de contagem: quando quebra, o diff do jest mostra
    // a mina exata e o fix, em vez de "esperava 0, recebeu 2".
    const offenders = fatal.map(
      (f) =>
        `${f.cls}[${f.index}]: ${f.type} recebe undefined ` +
        `(${repoRel(f.clsFile)} → ${repoRel(f.typeFile)} ainda em avaliação). ` +
        `Fix: @Inject(forwardRef(() => ${f.type})) no parâmetro.`,
    );

    expect(offenders).toEqual([]);
  });

  it('encontra o entrypoint e percorre a árvore de módulos', () => {
    // Sanidade: se o parse falhar silenciosamente, o teste acima passa à toa.
    expect(fs.existsSync(ENTRY)).toBe(true);
    expect(cache.size).toBeGreaterThan(100);
  });
});
