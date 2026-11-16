import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ElectronProcessRunner } from './harness/electron-runner.js';

interface GuiFlowResult {
  readonly error?: string;
  readonly overviewHasStack: boolean;
  readonly overviewHasTriad: boolean;
  readonly overviewHasD1ToD4: boolean;
  readonly all7ChartsPresent: boolean;
  readonly inlineStyleCountInBatch744: number;
  readonly filteredCardCount: number;
  readonly screenshotThumbLoaded: boolean;
  readonly modalOpened: boolean;
  readonly restoredCardCount: number;
  readonly simpleHidesRawEvidence: boolean;
  readonly simpleCardCount: number;
  readonly technicalShowsRawEvidence: boolean;
  readonly technicalCardCount: number;
  readonly shellDirAr: string | null;
  readonly shellLangAr: string | null;
  readonly arabicHeadingsPresent: boolean;
  readonly shellDirEn: string | null;
  readonly staleScan1Isolated: boolean;
}

describe('Phase 7.4.4 Part D — Live Electron Desktop GUI Verification', () => {
  let runner: ElectronProcessRunner;

  beforeAll(async () => {
    runner = new ElectronProcessRunner();
    await runner.start(25000);
  }, 30000);

  afterAll(async () => {
    if (runner) {
      await runner.stop(5000);
    }
  }, 10000);

  it('verifies interactive dashboard, 7 SVG charts, findings search/filter/screenshot modal, EN/AR RTL, Simple/Technical/Dual modes, and stale-scan isolation in real Electron 44', async () => {
    const res = await runner.executeScenario<GuiFlowResult>(
      'TEST_BATCH_7_4_4_GUI_FLOW',
      undefined,
      20000,
    );

    expect(res.error).toBeUndefined();
    expect(res.overviewHasTriad).toBe(true);
    expect(res.overviewHasD1ToD4).toBe(true);
    expect(res.overviewHasStack).toBe(true);
    expect(res.all7ChartsPresent).toBe(true);
    expect(res.inlineStyleCountInBatch744).toBe(0);

    expect(res.filteredCardCount).toBe(1);
    expect(res.screenshotThumbLoaded).toBe(true);
    expect(res.modalOpened).toBe(true);
    expect(res.restoredCardCount).toBe(4);

    expect(res.simpleHidesRawEvidence).toBe(true);
    expect(res.simpleCardCount).toBe(4);
    expect(res.technicalShowsRawEvidence).toBe(true);
    expect(res.technicalCardCount).toBe(4);

    expect(res.shellDirAr).toBe('rtl');
    expect(res.shellLangAr).toBe('ar');
    expect(res.arabicHeadingsPresent).toBe(true);
    expect(res.shellDirEn).toBe('ltr');

    expect(res.staleScan1Isolated).toBe(true);
  }, 25000);
});
