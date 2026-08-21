import { describe, expect, it } from 'vitest';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import { omissionConfirmationInput, visualOmissionPack } from './referenceOmission';

// P0-02：省略确认只认 underlay-generation 目的的待确认 Pack。
describe('visualOmissionPack / omissionConfirmationInput', () => {
  it('只识别 underlay-generation 且仍要求确认的 Pack', () => {
    const pending = makeArtifact({ purpose: 'underlay-generation', requires_omission_confirmation: true, pack_hash: 'h-1' });
    expect(visualOmissionPack(makeProject({ artifacts: { referencePack: pending } }))?.id).toBe(pending.id);
    expect(visualOmissionPack(makeProject({ artifacts: { referencePack: makeArtifact({ purpose: 'style-resolution', requires_omission_confirmation: true }) } }))).toBeNull();
    expect(visualOmissionPack(makeProject({ artifacts: { referencePack: makeArtifact({ purpose: 'underlay-generation', requires_omission_confirmation: false }) } }))).toBeNull();
    expect(visualOmissionPack(makeProject())).toBeNull();
  });

  it('确认输入携带 Pack hash，无 Pack 时为空对象', () => {
    const pending = makeArtifact({ purpose: 'underlay-generation', requires_omission_confirmation: true, pack_hash: 'h-1' });
    expect(omissionConfirmationInput(pending)).toEqual({ confirmReferenceOmissions: true, referencePackHash: 'h-1' });
    expect(omissionConfirmationInput(null)).toEqual({});
  });
});
