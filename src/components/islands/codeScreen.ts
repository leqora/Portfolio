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
  /** total characters including one per newline */
  length: number;
}

export function prepare(snippet: Snippet): PreparedSnippet {
  const raw = snippet.code.split('\n');
  const lines = raw.map((l) => tokenize(l, snippet.lang));
  const length = raw.reduce((n, l) => n + l.length + 1, 0);
  return { snippet, lines, length };
}

export const SCREEN_W = 1536;
export const SCREEN_H = 968;

const TAB_H = 66;
const STATUS_H = 46;
const FONT_SIZE = 29;
const LINE_H = 47;
const GUTTER_W = 92;
const PAD_X = 28;

const MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';

/**
 * Render the editor with the first `visible` characters of the snippet typed.
 * Returns nothing; the caller flags the texture for upload.
 */
export function drawScreen(
  ctx: CanvasRenderingContext2D,
  prep: PreparedSnippet,
  visible: number,
  cursorOn: boolean,
) {
  const { snippet, lines } = prep;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  // Tab bar
  ctx.fillStyle = C.chrome;
  ctx.fillRect(0, 0, SCREEN_W, TAB_H);
  ctx.font = `500 24px ${MONO}`;
  ctx.textBaseline = 'middle';
  let tx = 0;
  for (const s of SNIPPETS) {
    const label = s.file;
    const w = ctx.measureText(label).width + 64;
    const active = s.file === snippet.file;
    if (active) {
      ctx.fillStyle = C.bg;
      ctx.fillRect(tx, 0, w, TAB_H);
      ctx.fillStyle = C.signal;
      ctx.fillRect(tx, 0, w, 4);
    }
    ctx.fillStyle = active ? C.key : C.gutter;
    ctx.fillText(label, tx + 32, TAB_H / 2 + 2);
    tx += w;
  }
  ctx.fillStyle = C.line;
  ctx.fillRect(0, TAB_H - 1, SCREEN_W, 1);

  // Work out where the cursor is
  let remaining = visible;
  let curLine = 0;
  let curCol = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].reduce((n, t) => n + t.t.length, 0);
    if (remaining <= len) { curLine = i; curCol = remaining; break; }
    remaining -= len + 1;
    curLine = i + 1;
    curCol = 0;
  }
  curLine = Math.min(curLine, lines.length - 1);

  // Code
  const top = TAB_H + 26;
  ctx.textBaseline = 'alphabetic';
  let budget = visible;
  for (let i = 0; i < lines.length; i++) {
    const y = top + i * LINE_H + FONT_SIZE;
    if (i === curLine) {
      ctx.fillStyle = '#141418';
      ctx.fillRect(0, y - FONT_SIZE - 9, SCREEN_W, LINE_H);
    }
    ctx.font = `400 ${FONT_SIZE - 3}px ${MONO}`;
    ctx.fillStyle = i === curLine ? C.text : C.gutter;
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), GUTTER_W - 18, y);
    ctx.textAlign = 'left';

    let x = GUTTER_W + PAD_X;
    for (const tok of lines[i]) {
      if (budget <= 0) break;
      const part = tok.t.slice(0, budget);
      budget -= part.length;
      ctx.font = `${tok.italic ? 'italic ' : ''}${tok.c === C.keyword ? 600 : 400} ${FONT_SIZE}px ${MONO}`;
      ctx.fillStyle = tok.c;
      ctx.fillText(part, x, y);
      x += ctx.measureText(part).width;
    }
    if (i === curLine && cursorOn) {
      ctx.fillStyle = C.signal;
      ctx.fillRect(x + 2, y - FONT_SIZE + 2, 3, FONT_SIZE + 6);
    }
    budget -= 1; // newline
    if (budget < 0 && i >= curLine) break;
  }

  // Status bar
  const sy = SCREEN_H - STATUS_H;
  ctx.fillStyle = C.chrome;
  ctx.fillRect(0, sy, SCREEN_W, STATUS_H);
  ctx.fillStyle = C.signal;
  ctx.fillRect(0, sy, 150, STATUS_H);
  ctx.font = `600 21px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.bg;
  ctx.fillText('main', 46, sy + STATUS_H / 2 + 1);
  ctx.beginPath();
  ctx.arc(27, sy + STATUS_H / 2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.punct;
  ctx.fillText('0 errors · build passing', 180, sy + STATUS_H / 2 + 1);
  ctx.textAlign = 'right';
  ctx.fillText(`${snippet.lang}   UTF-8   Ln ${curLine + 1}, Col ${curCol + 1}`, SCREEN_W - 28, sy + STATUS_H / 2 + 1);
  ctx.textAlign = 'left';

  // Soft vignette so the panel reads as a lit screen, not a flat image
  const g = ctx.createRadialGradient(SCREEN_W / 2, SCREEN_H / 2, SCREEN_H * 0.35, SCREEN_W / 2, SCREEN_H / 2, SCREEN_W * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}
