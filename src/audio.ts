export type SpeechUnit = { text: string; blockIndexes: number[]; paragraphEnd: boolean };

export function joinPassages(units: SpeechUnit[], max = 1800): SpeechUnit[] {
  const result: SpeechUnit[] = [];
  for (const unit of units) {
    const last = result.at(-1);
    if (last && last.text.length + unit.text.length + 2 <= max) {
      last.text += '\n\n' + unit.text;
      last.blockIndexes = [...new Set([...last.blockIndexes, ...unit.blockIndexes])];
    }
    else result.push({ ...unit });
  }
  return result;
}

const spokenForms: [RegExp, string][] = [
  [/\bMr\.(?=\s|$)/gi, 'Mister'],
  [/\bMrs\.(?=\s|$)/gi, 'Missus'],
  [/\bMs\.(?=\s|$)/gi, 'Miss'],
  [/\bDr\.(?=\s|$)/gi, 'Doctor'],
  [/\bProf\.(?=\s|$)/gi, 'Professor'],
  [/\bRev\.(?=\s|$)/gi, 'Reverend'],
  [/\bHon\.(?=\s|$)/gi, 'Honorable'],
  [/\bCapt\.(?=\s|$)/gi, 'Captain'],
  [/\bLt\.(?=\s|$)/gi, 'Lieutenant'],
  [/\bCol\.(?=\s|$)/gi, 'Colonel'],
  [/\bGen\.(?=\s|$)/gi, 'General'],
  [/\bSgt\.(?=\s|$)/gi, 'Sergeant'],
  [/\bGov\.(?=\s|$)/gi, 'Governor'],
  [/\bPres\.(?=\s|$)/gi, 'President'],
  [/\bSen\.(?=\s|$)/gi, 'Senator'],
  [/\bRep\.(?=\s|$)/gi, 'Representative'],
  [/\bJr\.(?=\s|$)/gi, 'Junior'],
  [/\bSr\.(?=\s|$)/gi, 'Senior'],
  [/\bEsq\.(?=\s|$)/gi, 'Esquire'],
  [/\bSt\.(?=\s+[A-Z])/g, 'Saint'],
  [/\be\.g\.(?=\s|$)/gi, 'for example'],
  [/\bi\.e\.(?=\s|$)/gi, 'that is'],
  [/\betc\.(?=\s|$)/gi, 'et cetera'],
  [/\bvs\.(?=\s|$)/gi, 'versus'],
];

export function normalizeSpeechText(text: string): string {
  return spokenForms.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text)
    .replace(/\s+/g, ' ').trim();
}

// Keep coherent paragraph passages, but never exceed the Worker request limit.
export function speechChunks(text: string, max = 1800): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + word.length + 1 > max) { chunks.push(current); current = ''; }
    for (let offset = 0; offset < word.length; offset += max) {
      const part = word.slice(offset, offset + max);
      if (part.length === max) { chunks.push(part); } else current += (current ? ' ' : '') + part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function audioError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Your browser blocked audio playback. Press Listen again to allow playback.';
  if (error instanceof TypeError) return 'Could not reach the AI voice service. Check your connection and try again; Browser Natural is available.';
  return error instanceof Error ? error.message : 'Audio playback failed. Try Browser Natural.';
}

export async function requestAudio(url: string, text: string, speaker: string, reader: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Id': reader },
    body: JSON.stringify({ text, speaker }), signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    const fallback = response.status === 429 ? 'AI voice limit reached. Wait a minute, then retry. The daily AI quota may also be exhausted.' : `AI voice service returned HTTP ${response.status}. Try Browser Natural.`;
    throw new Error(body.error || fallback);
  }
  if (!response.headers.get('Content-Type')?.startsWith('audio/')) throw new Error('The voice service returned an invalid audio response.');
  const blob = await response.blob();
  if (!blob.size) throw new Error('The voice service returned empty audio.');
  return blob;
}

// Start the next request while the current passage plays; rejected prefetches are handled.
export class AudioBufferQueue {
  private entries = new Map<number, Promise<{ blob?: Blob; error?: unknown }>>();
  private load: (index: number, signal: AbortSignal) => Promise<Blob>;
  private count: number;
  readonly controller = new AbortController();
  constructor(load: (index: number, signal: AbortSignal) => Promise<Blob>, count: number) { this.load = load; this.count = count; }
  private prepare(index: number) {
    if (index >= this.count || this.entries.has(index)) return;
    this.entries.set(index, this.load(index, this.controller.signal).then(blob => ({ blob }), error => ({ error })));
  }
  async take(index: number): Promise<Blob> {
    this.prepare(index);
    const result = await this.entries.get(index)!;
    this.entries.delete(index);
    if (result.error) throw result.error;
    if (this.controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    this.prepare(index + 1);
    return result.blob!;
  }
  stop() { this.controller.abort(); this.entries.clear(); }
}
