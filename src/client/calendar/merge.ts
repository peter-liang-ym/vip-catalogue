/**
 * Busy_Block merging (Requirement 14.13).
 *
 * One recurrence can produce several blocks on the same weekday, and several
 * recurrences can describe one continuous busy stretch. Blocks sharing a weekday
 * collapse into one whenever their intervals overlap or merely touch — one's
 * `endMinute` equalling another's `startMinute` — spanning the least start to the
 * greatest end and carrying every contributing summary, deduplicated in first-seen
 * order.
 *
 * Touching intervals merge here even though touching intervals are not a conflict
 * (Requirement 15.3): merging is about representing the same continuous stretch
 * once, while conflict is about whether a meeting actually intersects it.
 */

import { WEEKDAYS, type BusyBlock, type Weekday } from '../../shared/types';

const weekdayRank = new Map<Weekday, number>(
  WEEKDAYS.map((weekday, index) => [weekday, index]),
);

/**
 * The blocks with every same-weekday overlapping or touching group replaced by one
 * block, in canonical order: weekday Monday..Sunday, then `startMinute` ascending.
 *
 * Returning canonical order is what makes the function idempotent — the merged
 * list is a fixed point — and it is the order the block cap is applied over.
 */
export function mergeBusyBlocks(
  blocks: readonly BusyBlock[],
): readonly BusyBlock[] {
  const ordered = [...blocks].sort(
    (a, b) =>
      (weekdayRank.get(a.weekday) ?? WEEKDAYS.length) -
        (weekdayRank.get(b.weekday) ?? WEEKDAYS.length) ||
      a.startMinute - b.startMinute ||
      a.endMinute - b.endMinute,
  );

  const merged: BusyBlock[] = [];
  let open: { block: BusyBlock; summaries: Set<string> } | null = null;

  for (const block of ordered) {
    // The sort guarantees a non-decreasing start within a weekday, so a block
    // touches or overlaps the open stretch exactly when it starts no later than
    // the stretch's end.
    if (
      open !== null &&
      open.block.weekday === block.weekday &&
      block.startMinute <= open.block.endMinute
    ) {
      for (const summary of block.summaries) open.summaries.add(summary);
      open.block = {
        ...open.block,
        endMinute: Math.max(open.block.endMinute, block.endMinute),
        summaries: [...open.summaries],
      };
      merged[merged.length - 1] = open.block;
      continue;
    }

    const summaries = new Set(block.summaries);
    const started: BusyBlock = { ...block, summaries: [...summaries] };
    open = { block: started, summaries };
    merged.push(started);
  }

  return merged;
}
