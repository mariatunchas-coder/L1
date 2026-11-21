import type { NumExpr } from "./types";

/**
 * Evaluator ekspresi matematis MINIMAL dan aman untuk field numerik SculptScript.
 * Sengaja TIDAK memakai eval()/new Function() (keduanya bisa menjalankan kode
 * sembarang kalau skrip datang dari input user) — ini cuma tokenizer + parser
 * recursive-descent kecil yang hanya mengenali: angka, "$i", "$namaVar",
 * tanda kurung, dan operator + - * /.
 *
 * Context berisi variabel yang boleh dirujuk lewat "$nama" di dalam ekspresi:
 *   - "i"    -> index iterasi loop saat ini (diisi otomatis oleh RepeatInstruction)
 *   - nama lain -> variabel yang didefinisikan lewat SetInstruction ("set name=... value=...")
 */
export interface ExprContext {
  vars: Record<string, number>;
}

export class ExprError extends Error {}

export function evalExpr(expr: NumExpr, ctx: ExprContext): number {
  if (typeof expr === "number") return expr;
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, ctx, expr, false);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}

/**
 * Cek HANYA sintaks sebuah ekspresi (tokenisasi + struktur operator/kurung valid),
 * tanpa butuh nilai variabel sungguhan. Dipakai parser teks SculptScript saat
 * parse-time untuk menangkap typo ("radius=0.1+") sebelum skrip dijalankan,
 * tanpa melaporkan "variabel tidak ditemukan" yang semestinya baru relevan saat
 * instruksi itu benar-benar dieksekusi (mis. "$i" di luar sebuah repeat).
 * Melempar ExprError kalau sintaksnya tidak valid.
 */
export function validateExprSyntax(expr: string): void {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, { vars: {} }, expr, true);
  parser.parseExpression();
  parser.expectEnd();
}

type Token = { kind: "num"; value: number } | { kind: "var"; name: string } | { kind: "op"; value: string } | { kind: "lparen" } | { kind: "rparen" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if ("+-*/".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    if (c === "$") {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      const name = src.slice(i + 1, j);
      if (!name) throw new ExprError(`"$" harus diikuti nama variabel, mis. "$i" atau "$radius"`);
      tokens.push({ kind: "var", name });
      i = j;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const numStr = src.slice(i, j);
      const n = Number(numStr);
      if (isNaN(n)) throw new ExprError(`angka tidak valid: "${numStr}"`);
      tokens.push({ kind: "num", value: n });
      i = j;
      continue;
    }
    throw new ExprError(`karakter tidak dikenal: "${c}"`);
  }
  return tokens;
}

/** Recursive-descent sederhana: expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* */
class Parser {
  private pos = 0;
  /** syntaxOnly: true -> rujukan "$var" tidak dicek keberadaannya, dianggap bernilai 0 (lihat validateExprSyntax). */
  constructor(private tokens: Token[], private ctx: ExprContext, private src: string, private syntaxOnly: boolean) {}

  parseExpression(): number {
    let value = this.parseTerm();
    while (this.peekOp("+") || this.peekOp("-")) {
      const op = (this.tokens[this.pos] as { kind: "op"; value: string }).value;
      this.pos++;
      const rhs = this.parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    while (this.peekOp("*") || this.peekOp("/")) {
      const op = (this.tokens[this.pos] as { kind: "op"; value: string }).value;
      this.pos++;
      const rhs = this.parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new ExprError("pembagian dengan nol");
        value = value / rhs;
      } else {
        value = value * rhs;
      }
    }
    return value;
  }

  private parseFactor(): number {
    const t = this.tokens[this.pos];
    if (!t) throw new ExprError(`ekspresi "${this.src}" berakhir tiba-tiba, ada operand yang hilang`);
    if (t.kind === "op" && t.value === "-") {
      this.pos++;
      return -this.parseFactor();
    }
    if (t.kind === "num") {
      this.pos++;
      return t.value;
    }
    if (t.kind === "var") {
      this.pos++;
      if (this.syntaxOnly) return 0; // nilai tidak penting, kita hanya mengecek strukturnya valid
      const v = this.ctx.vars[t.name];
      if (v == null) {
        throw new ExprError(
          `variabel "$${t.name}" tidak ditemukan. Pastikan sudah didefinisikan lewat "set name=${t.name} value=..." ` +
            (t.name === "i" ? "atau ekspresi ini dipakai di dalam instruksi repeat." : "sebelum baris ini.")
        );
      }
      return v;
    }
    if (t.kind === "lparen") {
      this.pos++;
      const v = this.parseExpression();
      if (!(this.tokens[this.pos]?.kind === "rparen")) throw new ExprError(`kurung "(" tidak ditutup di ekspresi "${this.src}"`);
      this.pos++;
      return v;
    }
    throw new ExprError(`token tak terduga di ekspresi "${this.src}"`);
  }

  private peekOp(v: string): boolean {
    const t = this.tokens[this.pos];
    return !!t && t.kind === "op" && t.value === v;
  }

  expectEnd() {
    if (this.pos !== this.tokens.length) {
      throw new ExprError(`ekspresi "${this.src}" punya sisa token yang tidak terpakai`);
    }
  }
}
