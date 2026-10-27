import { addDays, parseIsoDate, type IsoDate } from './dates';

export const BLOCK_WEEKS = 4;

export interface BlockRange {
  number: number;
  startsOn: IsoDate;
  endsOn: IsoDate;
}

/**
 * Blocks are 4 weeks counted from the term start, the same for the whole academy.
 * The last block is cut at the term end, so it can be shorter.
 */
export function generateBlocks(termStartsOn: IsoDate, termEndsOn: IsoDate): BlockRange[] {
  if (parseIsoDate(termEndsOn) < parseIsoDate(termStartsOn)) {
    throw new Error('Term ends before it starts');
  }
  const blocks: BlockRange[] = [];
  let start = termStartsOn;
  for (let number = 1; parseIsoDate(start) <= parseIsoDate(termEndsOn); number++) {
    const fullEnd = addDays(start, BLOCK_WEEKS * 7 - 1);
    const endsOn = parseIsoDate(fullEnd) > parseIsoDate(termEndsOn) ? termEndsOn : fullEnd;
    blocks.push({ number, startsOn: start, endsOn });
    start = addDays(fullEnd, 1);
  }
  return blocks;
}

export function blockForDate(blocks: BlockRange[], date: IsoDate): BlockRange | undefined {
  const t = parseIsoDate(date);
  return blocks.find((b) => parseIsoDate(b.startsOn) <= t && t <= parseIsoDate(b.endsOn));
}
