/**
 * Draws a small code editor onto a 2D canvas, used as the monitor's screen
 * texture. Pure canvas code so it stays independent from three.js.
 */

export interface Snippet {
  file: string;
  lang: 'C#' | 'JSON' | 'TypeScript';
  code: string;
}

export const SNIPPETS: Snippet[] = [
  {
    file: 'OrderRouter.cs',
    lang: 'C#',
    code: `// Routes incoming orders onto Service Bus
public class OrderRouter(ServiceBusSender bus)
{
    [Function("RouteOrder")]
    public async Task<IActionResult> Run(
        [HttpTrigger("post")] HttpRequest req)
    {
        var order = await req.ReadFromJsonAsync<Order>();
        if (order is null) return new BadRequestResult();

        await bus.SendMessageAsync(new(order.ToJson()));
        return new AcceptedResult();
    }
}`,
  },
  {
    file: 'workflow.json',
    lang: 'JSON',
    code: `{
  "definition": {
    "triggers": {
      "When_a_message_arrives": {
        "type": "ServiceBus",
        "inputs": { "queue": "orders-in" }
      }
    },
    "actions": {
      "Transform_to_EDI": {
        "type": "Xslt",
        "inputs": { "map": "Order_to_X12" }
      }
    }
  }
}`,
  },
  {
    file: 'useOrders.ts',
    lang: 'TypeScript',
    code: `// Live order status for the dashboard
export function useOrders(status: OrderStatus) {
  return useQuery({
    queryKey: ['orders', status],
    queryFn: async () => {
      const res = await fetch(\`/api/orders?status=\${status}\`);
      if (!res.ok) throw new Error('Failed to load orders');
      return (await res.json()) as Order[];
    },
    refetchInterval: 5_000,
  });
}`,
  },
];

const KEYWORDS = new Set([
  'public', 'private', 'class', 'async', 'await', 'return', 'var', 'new', 'if',
  'is', 'null', 'throw', 'export', 'function', 'const', 'as', 'true', 'false',
  'string', 'int', 'void', 'using', 'namespace', 'record',
]);

const C = {
  bg: '#0c0c0f',
  chrome: '#131316',
  line: '#24242a',
  gutter: '#3c3c44',
  text: '#d9d7d4',
  punct: '#8e8e96',
  keyword: '#ff2e3b',
  type: '#ffffff',
  method: '#ffc9cc',
  string: '#ff8f97',
  number: '#ff6b75',
  comment: '#5e5e68',
  key: '#ecebe9',
  signal: '#ff2e3b',
};

interface Tok { t: string; c: string; italic?: boolean }

function tokenize(line: string, lang: Snippet['lang']): Tok[] {
  const out: Tok[] = [];
  const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const [s, comment, str, num, ident, ws] = m;
    if (comment) out.push({ t: s, c: C.comment, italic: true });
    else if (str) {
      const isKey = lang === 'JSON' && /^\s*:/.test(line.slice(re.lastIndex));
      out.push({ t: s, c: isKey ? C.key : C.string });
    } else if (num) out.push({ t: s, c: C.number });
    else if (ident) {
      const next = line.slice(re.lastIndex).match(/^\s*(\S)/)?.[1];
      if (KEYWORDS.has(s)) out.push({ t: s, c: C.keyword });
      else if (next === '(') out.push({ t: s, c: C.method });
      else if (/^[A-Z]/.test(s)) out.push({ t: s, c: C.type });
      else out.push({ t: s, c: C.text });
    } else if (ws) out.push({ t: s, c: C.text });
    else out.push({ t: s, c: C.punct });
  }
  return out;
}

export interface PreparedSnippet {
  snippet: Snippet;
  lines: Tok[][];
  /** character offset where each line starts (newlines count as one character) */
  starts: number[];
  lengths: number[];
  /** total characters including one per newline */
  length: number;
}

export function prepare(snippet: Snippet): PreparedSnippet {
  const raw = snippet.code.split('\n');
  const lines = raw.map((l) => tokenize(l, snippet.lang));
  const lengths = raw.map((l) => l.length);
  const starts: number[] = [];
  let n = 0;
  for (const len of lengths) { starts.push(n); n += len + 1; }
  return { snippet, lines, starts, lengths, length: n };
}

export const SCREEN_W = 1536;
export const SCREEN_H = 968;

const TAB_H = 66;
export const STATUS_H = 46;
const FONT_SIZE = 29;
export const LINE_H = 47;
const CODE_TOP = TAB_H + 17;
const GUTTER_W = 92;
const PAD_X = 28;

const MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';

/** Top edge (canvas pixels) of the band a code line occupies */
export const lineTop = (i: number) => CODE_TOP + i * LINE_H;
export const STATUS_TOP = SCREEN_H - STATUS_H;

export function cursorAt(prep: PreparedSnippet, visible: number) {
  for (let i = prep.lines.length - 1; i >= 0; i--) {
    if (visible >= prep.starts[i]) {
      return { line: i, col: Math.min(prep.lengths[i], visible - prep.starts[i]) };
    }
  }
  return { line: 0, col: 0 };
}

/** Draw one code line into `ctx` with its band's top edge at `y` */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  prep: PreparedSnippet,
  i: number,
  visible: number,
  cursorOn: boolean,
  y = lineTop(i),
) {
  const cur = cursorAt(prep, visible);
  const isCur = i === cur.line;
  ctx.fillStyle = isCur ? '#141418' : C.bg;
  ctx.fillRect(0, y, SCREEN_W, LINE_H);
  if (i > cur.line) return;

  const base = y + 9 + FONT_SIZE;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${FONT_SIZE - 3}px ${MONO}`;
  ctx.fillStyle = isCur ? C.text : C.gutter;
  ctx.textAlign = 'right';
  ctx.fillText(String(i + 1), GUTTER_W - 18, base);
  ctx.textAlign = 'left';

  let budget = Math.max(0, Math.min(prep.lengths[i], visible - prep.starts[i]));
  let x = GUTTER_W + PAD_X;
  for (const tok of prep.lines[i]) {
    if (budget <= 0) break;
    const part = tok.t.slice(0, budget);
    budget -= part.length;
    ctx.font = `${tok.italic ? 'italic ' : ''}${tok.c === C.keyword ? 600 : 400} ${FONT_SIZE}px ${MONO}`;
    ctx.fillStyle = tok.c;
    ctx.fillText(part, x, base);
    x += ctx.measureText(part).width;
  }
  if (isCur && cursorOn) {
    ctx.fillStyle = C.signal;
    ctx.fillRect(x + 2, base - FONT_SIZE + 2, 3, FONT_SIZE + 6);
  }
}

/** Draw the status bar into `ctx` with its top edge at `y` */
export function drawStatus(ctx: CanvasRenderingContext2D, prep: PreparedSnippet, visible: number, y = STATUS_TOP) {
  const cur = cursorAt(prep, visible);
  const mid = y + STATUS_H / 2;
  ctx.fillStyle = C.chrome;
  ctx.fillRect(0, y, SCREEN_W, STATUS_H);
  ctx.fillStyle = C.signal;
  ctx.fillRect(0, y, 150, STATUS_H);
  ctx.font = `600 21px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.bg;
  ctx.fillText('main', 46, mid + 1);
  ctx.beginPath();
  ctx.arc(27, mid, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.punct;
  ctx.fillText('0 errors · build passing', 180, mid + 1);
  ctx.textAlign = 'right';
  ctx.fillText(`${prep.snippet.lang}   UTF-8   Ln ${cur.line + 1}, Col ${cur.col + 1}`, SCREEN_W - 28, mid + 1);
  ctx.textAlign = 'left';
}

/** Draw the whole editor. Used on start and when the file changes. */
export function drawScreen(ctx: CanvasRenderingContext2D, prep: PreparedSnippet, visible: number, cursorOn: boolean) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  // Tab bar
  ctx.fillStyle = C.chrome;
  ctx.fillRect(0, 0, SCREEN_W, TAB_H);
  ctx.font = `500 24px ${MONO}`;
  ctx.textBaseline = 'middle';
  let tx = 0;
  for (const s of SNIPPETS) {
    const w = ctx.measureText(s.file).width + 64;
    const active = s.file === prep.snippet.file;
    if (active) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(tx, 0, w, TAB_H);
      ctx.fillStyle = C.signal;
      ctx.fillRect(tx, 0, w, 4);
    }
    ctx.fillStyle = active ? C.key : C.gutter;
    ctx.fillText(s.file, tx + 32, TAB_H / 2 + 2);
    tx += w;
  }
  ctx.fillStyle = C.line;
  ctx.fillRect(0, TAB_H - 1, SCREEN_W, 1);

  for (let i = 0; i < prep.lines.length; i++) drawLine(ctx, prep, i, visible, cursorOn);
  drawStatus(ctx, prep, visible);
}
