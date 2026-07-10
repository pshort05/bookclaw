export interface InterviewSeeds {
  heat: 'sweet' | 'spicy';
  storyArc: string;
  characters: string;
  setting: string;
  chapterCount: number;
  wordsPerChapter: number;
  councilSelection: 'auto' | 'propose';
}
export interface TurnMessage { role: 'user' | 'assistant'; content: string; }
export interface TurnResult { reply: string; done: boolean; seeds?: InterviewSeeds; }

// Injected dependencies — identical shapes to premise-intake.ts (decoupled from router internals):
export type AiComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; thinking?: 'low' | 'medium' | 'high' }) => Promise<{ text: string }>;
export type AiSelectProvider = (taskType: string) => { id: string };

const INTERVIEW_SYSTEM = `You are a warm, perceptive romance-writing interviewer. Through a natural back-and-forth, draw out the story the author wants to write until you can confidently fill EVERY field of this seed contract:
- heat: 'sweet' (closed-door / fade-to-black) or 'spicy' (open-door / explicit)
- storyArc: the central couple, the core romantic conflict, the tropes, the HEA/HFN promise
- characters: the two leads plus key supporting cast
- setting: place, time and sensory texture (real-world grounded — locations, buildings, seasons)
- chapterCount: a number
- wordsPerChapter: a number
- councilSelection: 'auto' (let the AI pick the single best base story) or 'propose' (show ranked options to choose from)

Rules:
- Ask ONE focused question per turn. Build on what the author has already said; never re-ask something they answered.
- Preserve the author's own words and canon — you are drawing the story out, not inventing it.
- When (and ONLY when) you can confidently fill all seven fields, set done=true and return the full seeds. Until then done=false and omit seeds.
Output ONE JSON object and nothing else:
{"reply":"<your next question OR a short closing confirmation>","done":<true|false>,"seeds":{"heat","storyArc","characters","setting","chapterCount","wordsPerChapter","councilSelection"} | null}`;

// Non-throwing JSON extraction — a malformed turn must NOT abort the interview.
function tryExtractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const raw = fenced ? fenced[1] : (start >= 0 && end > start ? text.slice(start, end + 1) : '');
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class RomanceInterviewService {
  constructor(private aiComplete: AiComplete, private aiSelectProvider: AiSelectProvider) {}

  async turn(messages: TurnMessage[]): Promise<TurnResult> {
    // Client holds the transcript; on the opening turn there is nothing yet, so seed a kickoff
    // user turn (some providers reject an all-system message list).
    const convo: TurnMessage[] = messages.length
      ? messages
      : [{ role: 'user', content: 'Let us begin. Ask your first question to start drawing out my romance story.' }];

    const provider = this.aiSelectProvider('editor_chat').id;
    const { text } = await this.aiComplete({ provider, system: INTERVIEW_SYSTEM, messages: convo, maxTokens: 4000, thinking: 'low' });

    const j = tryExtractJson(text);
    if (!j || typeof j !== 'object') {
      // Graceful degradation: no parseable JSON — surface the model's prose as the next
      // question so the interview keeps moving instead of dead-ending.
      return { reply: text.trim() || 'Tell me more about the story you want to write.', done: false };
    }

    const done = j.done === true;
    const reply = str(j.reply) || (done ? 'Great — I have everything I need to build your story.' : 'Tell me more.');
    if (!done) return { reply, done: false };

    const s = j.seeds ?? {};
    const seeds: InterviewSeeds = {
      heat: s.heat === 'spicy' ? 'spicy' : 'sweet',
      storyArc: str(s.storyArc),
      characters: str(s.characters),
      setting: str(s.setting),
      chapterCount: num(s.chapterCount, 40),
      wordsPerChapter: num(s.wordsPerChapter, 2500),
      councilSelection: s.councilSelection === 'propose' ? 'propose' : 'auto',
    };
    return { reply, done: true, seeds };
  }
}
