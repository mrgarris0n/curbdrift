// Builds reuse production's snapshot only when it has the same version (scripts/snapshots.mjs),
// and the version includes each source's SNAPSHOT_FORMAT. So when toSnapshot's output changes,
// the format number must change too, or a build could ship old-format data to new code.
// This pins each source's output for fixed rows. If it fails: bump that source's SNAPSHOT_FORMAT,
// then record the new format and hash here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SOURCES } from '../scripts/snapshots.mjs';

const NOW = new Date('2026-11-06T12:00:00Z');
const ROWS = {
  'nyc sheds': [
    { bin: '1001', job_filing_number: 'J1', house_no: '1', street_name: 'MAIN STREET', work_type: 'Sidewalk Shed', issued_date: '2026-01-01T00:00:00.000', expired_date: '2027-01-01T00:00:00.000', permit_status: 'Permit Issued', latitude: '40.7', longitude: '-73.9', owner_business_name: 'OWNER LLC', applicant_business_name: 'SCAFFOLD CO' },
  ],
  'chicago sheds': [
    { permit_: 'P1', permit_type: 'PERMIT - SCAFFOLDING', issue_date: '2026-03-01T00:00:00.000', permit_status: 'ACTIVE', street_number: '1', street_direction: 'N', street_name: 'STATE ST', latitude: '41.88', longitude: '-87.63', contact_1_type: 'OWNER', contact_1_name: 'OWNER LLC' },
  ],
  'nyc complaints': [
    { unique_key: '1', complaint_type: 'Sewer', descriptor: 'Street Flooding (SJ)', created_date: '2026-10-01T10:00:00.000', status: 'Open', incident_address: '1 MAIN STREET', latitude: '40.7', longitude: '-73.9' },
    { unique_key: '2', complaint_type: 'Sidewalk Condition', descriptor: 'Broken Sidewalk', created_date: '2026-10-02T10:00:00.000', status: 'Closed', incident_address: '2 MAIN STREET', latitude: '40.70001', longitude: '-73.90001' },
  ],
  'chicago complaints': [
    { sr_number: 'SR1', sr_type: 'Water On Street Complaint', created_date: '2026-10-01T10:00:00.000', status: 'Open', street_address: '1 N STATE ST', latitude: '41.88', longitude: '-87.63' },
    { sr_number: 'SR2', sr_type: 'Sidewalk Inspection Request', created_date: '2026-10-02T10:00:00.000', status: 'Completed', street_address: '2 N STATE ST', latitude: '41.88001', longitude: '-87.63001' },
  ],
};
const RECORDED = {
  'nyc sheds': { format: 1, hash: '7f412dc2e61d398d' },
  'chicago sheds': { format: 1, hash: 'c9c2d39eee90689c' },
  'nyc complaints': { format: 1, hash: '595cc9e238e92059' },
  'chicago complaints': { format: 1, hash: '2236961f635d21d6' },
};

for (const source of SOURCES) {
  test(`${source.id}: snapshot output matches its recorded format ${RECORDED[source.id]?.format}`, () => {
    const snapshot = source.toSnapshot(ROWS[source.id], NOW);
    assert.ok(source.count(snapshot) > 0, 'the fixture rows produce items');
    const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
    assert.deepEqual({ format: source.format, hash }, RECORDED[source.id],
      'toSnapshot output changed: bump this source\'s SNAPSHOT_FORMAT, then record the new format and hash here');
  });
}
