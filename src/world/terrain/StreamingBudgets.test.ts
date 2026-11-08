import { describe, expect, it } from 'vitest';
import {
  MEASURE_BUDGET_MS,
  streamingBudgets,
  WARMUP_BUILDS_PER_FRAME,
  WARMUP_MEASURE_BUDGET_MS,
  WARMUP_UPLOADS_PER_FRAME,
} from './StreamingBudgets';

describe('streamingBudgets', () => {
  it('uses the preset budgets in flight', () => {
    expect(streamingBudgets(false, 3, 1)).toEqual({ buildsPerFrame: 3, uploadsPerFrame: 1, measureMs: MEASURE_BUDGET_MS });
    expect(streamingBudgets(false, 12, 2)).toEqual({ buildsPerFrame: 12, uploadsPerFrame: 2, measureMs: MEASURE_BUDGET_MS });
  });

  it('lifts the budgets during the countdown whatever the preset says', () => {
    expect(streamingBudgets(true, 3, 1)).toEqual({
      buildsPerFrame: WARMUP_BUILDS_PER_FRAME,
      uploadsPerFrame: WARMUP_UPLOADS_PER_FRAME,
      measureMs: WARMUP_MEASURE_BUDGET_MS,
    });
    expect(WARMUP_BUILDS_PER_FRAME).toBeGreaterThan(12);
    expect(WARMUP_UPLOADS_PER_FRAME).toBeGreaterThan(2);
  });

  it('never lowers a budget that is already larger than the warm-up one', () => {
    expect(streamingBudgets(true, 100, 20)).toMatchObject({ buildsPerFrame: 100, uploadsPerFrame: 20 });
  });
});
